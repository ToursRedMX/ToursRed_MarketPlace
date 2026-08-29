import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
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
    // --- Autorizacion ---
    // Esta funcion crea cargos 3DS REALES en OpenPay con el monto que venga en
    // el body, y hasta el 29-ago corria con verify_jwt = false: cualquiera con
    // la URL podia dispararla. Es una utilidad de pruebas de cobro, no algo que
    // un viajero o una agencia deba poder tocar, asi que exige admin.
    //
    // Mismo patron que generate-booking-cfdi: se acepta el service role para
    // llamadas internas, y cualquier otro llamador tiene que ser admin.
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.replace("Bearer ", "").trim();
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const isServiceRole = bearer.length > 0 && bearer === serviceRoleKey;

    if (!isServiceRole) {
      if (!bearer) {
        return new Response(
          JSON.stringify({ error: "No autorizado" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        serviceRoleKey,
      );

      const { data: { user: caller }, error: callerErr } = await supabase.auth.getUser(bearer);
      if (callerErr || !caller) {
        return new Response(
          JSON.stringify({ error: "No autorizado" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: callerProfile } = await supabase
        .from("users")
        .select("role")
        .eq("id", caller.id)
        .maybeSingle();

      const isAdmin = callerProfile?.role === "admin" || callerProfile?.role === "super_admin";
      if (!isAdmin) {
        console.warn(
          `test-openpay-3ds-charge denegada: usuario ${caller.id} rol ${callerProfile?.role ?? "desconocido"}`,
        );
        return new Response(
          JSON.stringify({ error: "Solo un administrador puede usar esta utilidad de pruebas" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

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
