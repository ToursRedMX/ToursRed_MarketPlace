import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkAal2Required, aal2Response } from "../_shared/aal2Check.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string, status = 400) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Admin auth verification (same pattern as admin-cancel-booking) ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return err("No authorization header", 401);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return err("Token inválido", 401);

    const { data: adminUser } = await supabase
      .from("users")
      .select("id, role, email, is_super_admin")
      .eq("id", user.id)
      .maybeSingle();

    if (!adminUser || !["super_admin", "admin"].includes(adminUser.role)) {
      return err("Permisos insuficientes", 403);
    }

    // AAL2 (MFA) check — blocks the action if MFA is required but not completed
    const aal2 = await checkAal2Required(supabase);
    if (!aal2.allowed) {
      return aal2Response(aal2.reason || "Se requiere autenticacion de dos factores");
    }

    const {
      topup_id,
      user_id,
      amount,
      payment_method_type,
      provider_charge_id,
      order_id,
      description,
      idempotency_key,
    } = await req.json();

    if (!user_id) return err("user_id es requerido");
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0)
      return err("amount debe ser un número positivo");

    const transactionType = payment_method_type === "codi" ? "topup_codi" : "topup_spei";
    const referenceType = payment_method_type === "codi"
      ? "openpay_codi_topup"
      : "openpay_spei_topup";
    const idemKey = idempotency_key || provider_charge_id || `manual_${topup_id || Date.now()}`;

    // ── Credit wallet via service role (bypasses auth.uid() guard) ──
    const { data: walletResult, error: creditError } = await supabase.rpc("update_wallet_balance", {
      p_user_id: user_id,
      p_amount: Number(amount),
      p_type: transactionType,
      p_description: description || "Recarga acreditada por admin",
      p_reference_id: topup_id || null,
      p_reference_type: referenceType,
      p_idempotency_key: idemKey,
    });

    if (creditError) {
      if (creditError.message?.includes("idempotency")) {
        return ok({ success: true, idempotent_replay: true, message: "Ya fue acreditada anteriormente" });
      }
      return err("Error: " + creditError.message);
    }

    // ── Update topup status if topup_id provided ──
    if (topup_id) {
      await supabase
        .from("openpay_wallet_topups")
        .update({
          status: "completed",
          credited_at: new Date().toISOString(),
          conciliation_status: "resuelto_acreditado",
        })
        .eq("id", topup_id);

      // Create accounting entry (non-blocking)
      try {
        await supabase.rpc("create_accounting_entry_for_wallet_topup", { p_topup_id: topup_id });
      } catch (e) {
        console.error("Error creating accounting entry:", e);
      }
    }

    return ok({
      success: true,
      wallet_result: walletResult,
    });
  } catch (e: any) {
    console.error("admin-credit-wallet-topup error:", e);
    return err(e.message || "Error interno", 500);
  }
});
