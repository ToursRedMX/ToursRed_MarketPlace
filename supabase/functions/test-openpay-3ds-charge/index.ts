import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  isConfigured,
  getBaseUrl,
  getMerchantId,
  getAuthHeader,
  getChargeMerchant,
} from "../_shared/openpay.ts";
import * as Sentry from "npm:@sentry/deno@9";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    tracesSampleRate: 0.1,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (!isConfigured()) {
      return new Response(
        JSON.stringify({ error: "OpenPay no está configurado. Contacta al administrador." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // GET — return merchant_id so the frontend can initialize OpenPay.js
    if (req.method === "GET") {
      const merchantId = getMerchantId();
      return new Response(
        JSON.stringify({ merchant_id: merchantId }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Método no permitido" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // POST — create a test 3DS charge
    const body = await req.json();
    const { source_id, device_session_id, amount, charge_id, use_3d_secure } = body as {
      source_id?: string;
      device_session_id?: string;
      amount?: number;
      charge_id?: string;
      use_3d_secure?: boolean;
    };

    // If charge_id is provided, query the charge status instead
    if (charge_id) {
      const charge = await getChargeMerchant(charge_id);
      return new Response(
        JSON.stringify(charge),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!source_id || !device_session_id) {
      return new Response(
        JSON.stringify({ error: "Faltan source_id y device_session_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const testAmount = amount ?? 10;
    const baseUrl = getBaseUrl();
    const merchantId = getMerchantId();
    const auth = getAuthHeader();

    const origin = req.headers.get("Origin") || req.headers.get("Referer") || "https://toursred.com";
    const redirectUrl = `${origin}/test-openpay-3ds?result=return`;
    const orderId = `test3ds_${Date.now()}`;

    const chargePayload = {
      method: "card",
      source_id,
      device_session_id,
      amount: Math.round(testAmount * 100) / 100,
      currency: "MXN",
      description: "PRUEBA 3DS - temporal",
      order_id: orderId,
      use_3d_secure: use_3d_secure === true,
      redirect_url: redirectUrl,
      customer: {
        name: "Prueba",
        last_name: "3DS Openpay",
        email: "test-3ds-openpay@toursred.com",
        phone_number: "5555555555",
      },
    };

    const response = await fetch(`${baseUrl}/${merchantId}/charges`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chargePayload),
    });

    const charge = await response.json();

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: charge.description || charge.error_message || "Error en OpenPay", raw: charge }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify(charge),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("test-openpay-3ds-charge error:", err);
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
      JSON.stringify({ error: err.message || "Error interno del servidor" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
