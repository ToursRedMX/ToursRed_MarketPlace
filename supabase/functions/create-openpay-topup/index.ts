import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";
import {
  isConfigured,
  createOrReuseCustomer,
  createSpeiCharge,
  createCodiCharge,
} from "../_shared/openpay.ts";
import * as Sentry from "npm:@sentry/deno@9";

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    tracesSampleRate: 0.1,
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MIN_AMOUNT = 500;
const MAX_AMOUNT = 50000;

interface CreateTopupRequest {
  amount: number;
  payment_method_type: "spei";
}

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
    if (!isConfigured()) {
      return new Response(
        JSON.stringify({ error: "OpenPay no está configurado. Contacta al administrador." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    const userId = user.id;

    // ── Validate input ────────────────────────────────────
    const { amount, payment_method_type }: CreateTopupRequest = await req.json();

    if (typeof amount !== "number" || !isFinite(amount) || amount <= 0) {
      return new Response(
        JSON.stringify({ error: "El monto debe ser un número válido mayor a cero" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check max 2 decimals
    const rounded = Math.round(amount * 100) / 100;
    if (Math.abs(amount - rounded) > 0.001) {
      return new Response(
        JSON.stringify({ error: "El monto no puede tener más de dos decimales" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (amount < MIN_AMOUNT) {
      return new Response(
        JSON.stringify({ error: `El monto mínimo de recarga es $${MIN_AMOUNT} MXN` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (amount > MAX_AMOUNT) {
      return new Response(
        JSON.stringify({ error: `El monto máximo de recarga es $${MAX_AMOUNT} MXN` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Must be multiple of 100
    if (amount % 100 !== 0) {
      return new Response(
        JSON.stringify({ error: "El monto debe ser múltiplo de $100 MXN" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (payment_method_type === "codi") {
      return new Response(
        JSON.stringify({ error: "CoDi ya no está disponible como método de recarga. Usa SPEI." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (payment_method_type !== "spei") {
      return new Response(
        JSON.stringify({ error: "Método de pago no válido. Use 'spei'." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Service role client for DB operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Verify user is a traveler ──────────────────────────
    const { data: userRecord, error: userError } = await supabase
      .from("users")
      .select("id, role, first_name, last_name, email, phone_number, openpay_customer_id")
      .eq("id", userId)
      .maybeSingle();

    if (userError || !userRecord) {
      return new Response(
        JSON.stringify({ error: "Usuario no encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (userRecord.role !== "traveler") {
      return new Response(
        JSON.stringify({ error: "Solo los viajeros pueden recargar su monedero" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Create local topup record (pending) ───────────────
    const topupId = crypto.randomUUID();
    const orderId = `TOPUP_${topupId.replace(/-/g, "")}`;
    const description = "Recarga ToursRed Cash";

    const { error: insertError } = await supabase.from("openpay_wallet_topups").insert({
      id: topupId,
      user_id: userId,
      amount: rounded,
      currency: "MXN",
      payment_method_type,
      order_id: orderId,
      status: "pending",
    });

    if (insertError) {
      console.error("Error creating topup record:", insertError);
      return new Response(
        JSON.stringify({ error: "Error al crear la solicitud de recarga" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Create or reuse OpenPay customer ──────────────────
    let customerId: string;
    try {
      customerId = await createOrReuseCustomer(supabase, userId, {
        first_name: userRecord.first_name,
        last_name: userRecord.last_name,
        email: userRecord.email,
        phone_number: userRecord.phone_number,
      });
    } catch (err) {
      await supabase.from("openpay_wallet_topups").update({
        status: "failed",
        error_message: err.message,
      }).eq("id", topupId);

      return new Response(
        JSON.stringify({ error: err.message }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Create charge in OpenPay ──────────────────────────
    try {
      let charge;
      if (payment_method_type === "spei") {
        charge = await createSpeiCharge(customerId, rounded, orderId, description);
      } else {
        charge = await createCodiCharge(customerId, rounded, orderId, description);
      }

      // Save charge details
      await supabase.from("openpay_wallet_topups").update({
        openpay_customer_id: customerId,
        provider_charge_id: charge.id,
        payment_method_response: charge.payment_method,
        provider_response: charge,
        status: "awaiting_transfer",
      }).eq("id", topupId);

      // Return only what the frontend needs
      const responseData: Record<string, any> = {
        topup_id: topupId,
        order_id: orderId,
        amount: rounded,
        currency: "MXN",
        status: "awaiting_transfer",
        payment_method_type,
        payment_method: charge.payment_method,
      };

      // SPEI PDF receipt URL
      if (payment_method_type === "spei") {
        const env = Deno.env.get("OPENPAY_ENV") || "sandbox";
        const dashboardBase = env === "production"
          ? "https://dashboard.openpay.mx"
          : "https://sandbox-dashboard.openpay.mx";
        const merchantId = Deno.env.get("OPENPAY_MERCHANT_ID");
        responseData.spei_pdf_url = `${dashboardBase}/spei-pdf/${merchantId}/${charge.id}`;
      }

      return new Response(
        JSON.stringify(responseData),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      await supabase.from("openpay_wallet_topups").update({
        openpay_customer_id: customerId,
        status: "failed",
        error_message: err.message,
      }).eq("id", topupId);

      return new Response(
        JSON.stringify({ error: err.message }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (err) {
    console.error("Unexpected error in create-openpay-topup:", err);
    if (sentryDsn) {
      Sentry.captureException(err, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
