import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";
import { isConfigured, getCharge } from "../_shared/openpay.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Método no permitido" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ── Auth ──────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Autenticación requerida" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseAuth = createClient(supabaseUrl, supabaseServiceKey);
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Sesión no válida" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { topup_id } = await req.json();
    if (!topup_id) {
      return new Response(
        JSON.stringify({ error: "topup_id es requerido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Get topup, verify ownership ────────────────────────
    const { data: topup, error: topupError } = await supabase
      .from("openpay_wallet_topups")
      .select("*")
      .eq("id", topup_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (topupError || !topup) {
      return new Response(
        JSON.stringify({ error: "Recarga no encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If already completed, return current state
    if (topup.status === "completed") {
      return new Response(
        JSON.stringify({
          topup_id: topup.id,
          status: "completed",
          amount: topup.amount,
          credited_at: topup.credited_at,
          payment_method_type: topup.payment_method_type,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If failed/cancelled/expired, return without calling OpenPay
    if (["failed", "cancelled", "expired"].includes(topup.status)) {
      return new Response(
        JSON.stringify({
          topup_id: topup.id,
          status: topup.status,
          amount: topup.amount,
          error_message: topup.error_message,
          payment_method_type: topup.payment_method_type,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── If awaiting_transfer, check OpenPay ────────────────
    if (topup.status === "awaiting_transfer" && isConfigured() && topup.openpay_customer_id && topup.provider_charge_id) {
      try {
        const charge = await getCharge(topup.openpay_customer_id, topup.provider_charge_id);

        // If OpenPay says completed, trigger credit
        if (charge.status === "completed") {
          // Verify all fields match before crediting
          const fieldsMatch =
            charge.id === topup.provider_charge_id &&
            charge.order_id === topup.order_id &&
            (charge.method === "bank_account" || charge.method === "codi") &&
            Number(charge.amount) === Number(topup.amount);

          if (fieldsMatch) {
            const transactionType = topup.payment_method_type === "codi" ? "topup_codi" : "topup_spei";
            const referenceType = topup.payment_method_type === "codi"
              ? "openpay_codi_topup"
              : "openpay_spei_topup";

            const { error: creditError } = await supabase.rpc("update_wallet_balance", {
              p_user_id: topup.user_id,
              p_amount: topup.amount,
              p_type: transactionType,
              p_description: topup.payment_method_type === "codi"
                ? "Recarga de ToursRed Cash mediante CoDi"
                : "Recarga de ToursRed Cash mediante SPEI",
              p_reference_id: topup.id,
              p_reference_type: referenceType,
              p_idempotency_key: topup.provider_charge_id,
            });

            if (!creditError || (creditError.message && creditError.message.includes("idempotency"))) {
              await supabase.from("openpay_wallet_topups").update({
                status: "completed",
                credited_at: new Date().toISOString(),
                conciliation_status: null,
              }).eq("id", topup.id);

              return new Response(
                JSON.stringify({
                  topup_id: topup.id,
                  status: "completed",
                  amount: topup.amount,
                  credited_at: new Date().toISOString(),
                  payment_method_type: topup.payment_method_type,
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
          }
        }

        // Return current status from OpenPay
        return new Response(
          JSON.stringify({
            topup_id: topup.id,
            status: topup.status,
            openpay_status: charge.status,
            amount: topup.amount,
            payment_method_type: topup.payment_method_type,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        // OpenPay API error — return local status without crashing
        return new Response(
          JSON.stringify({
            topup_id: topup.id,
            status: topup.status,
            amount: topup.amount,
            payment_method_type: topup.payment_method_type,
            message: "No se pudo consultar OpenPay en este momento",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Default: return local status
    return new Response(
      JSON.stringify({
        topup_id: topup.id,
        status: topup.status,
        amount: topup.amount,
        payment_method_type: topup.payment_method_type,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error in check-openpay-topup-status:", err);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
