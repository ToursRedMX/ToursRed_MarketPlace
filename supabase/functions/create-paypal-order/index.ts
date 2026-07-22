import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function getPayPalAccessToken(clientId: string, clientSecret: string, sandbox: boolean): Promise<string> {
  const base = sandbox
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("PayPal token error:", errorBody);
    throw new Error("Failed to get PayPal access token");
  }

  const data = await response.json();
  return data.access_token;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    const { bookingId, amount, description, context, extrasBody } = await req.json();

    if (context !== "gift_card") {
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "No autorizado" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: { user }, error: userError } = await supabase.auth.getUser(
        authHeader.replace("Bearer ", "")
      );
      if (userError || !user) {
        return new Response(JSON.stringify({ error: "No autorizado" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (!bookingId || !amount) {
      return new Response(JSON.stringify({ error: "Datos incompletos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let paypalClientId = Deno.env.get("PAYPAL_CLIENT_ID");
    let paypalClientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");
    let isSandbox = Deno.env.get("PAYPAL_SANDBOX") === "true";

    const { data: settings } = await supabase
      .from("platform_settings")
      .select("paypal_client_id, paypal_client_secret, paypal_sandbox")
      .maybeSingle();

    if (!paypalClientId && settings?.paypal_client_id) paypalClientId = settings.paypal_client_id;
    if (!paypalClientSecret && settings?.paypal_client_secret) paypalClientSecret = settings.paypal_client_secret;
    if (settings?.paypal_sandbox !== undefined && settings?.paypal_sandbox !== null) {
      isSandbox = settings.paypal_sandbox;
    }

    if (!paypalClientId || !paypalClientSecret) {
      return new Response(JSON.stringify({ error: "PayPal no configurado" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const origin = req.headers.get("origin") || "https://toursred.com";
    const base = isSandbox
      ? "https://api-m.sandbox.paypal.com"
      : "https://api-m.paypal.com";

    let returnUrl = "";
    let cancelUrl = "";

    if (context === "gift_card") {
      returnUrl = `${origin}/payment-return?provider=paypal&gift_card_id=${bookingId}&status=success`;
      cancelUrl = `${origin}/gift-cards`;
    } else if (context === "supplement") {
      returnUrl = `${origin}/payment-return?provider=paypal&booking_supplement_id=${bookingId}&status=success`;
      cancelUrl = `${origin}/traveler/bookings`;
    } else if (context === 'extras') {
      const extraType = extrasBody?.type || 'insurance';
      let returnParams = `provider=paypal&booking_id=${bookingId}&extra_type=${extraType}&tr_status=success`;
      if (extraType === 'optional_service' && extrasBody?.tour_optional_service_id) {
        returnParams += `&tour_optional_service_id=${extrasBody.tour_optional_service_id}&quantity=${extrasBody.quantity || 1}`;
      }
      returnUrl = `${origin}/payment-return?${returnParams}`;
      cancelUrl = `${origin}/traveler/bookings`;
    } else {
      returnUrl = `${origin}/payment-return?provider=paypal&booking_id=${bookingId}&tr_status=success`;
      cancelUrl = `${origin}/payment-return?provider=paypal&booking_id=${bookingId}&tr_status=cancel`;
    }

    const accessToken = await getPayPalAccessToken(paypalClientId, paypalClientSecret, isSandbox);

    const orderPayload = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: bookingId,
          description: description || "ToursRed",
          amount: {
            currency_code: "MXN",
            value: (Math.round(amount * 100) / 100).toFixed(2),
          },
        },
      ],
      application_context: {
        brand_name: "ToursRed",
        locale: "es-MX",
        landing_page: "BILLING",
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    };

    const orderResponse = await fetch(`${base}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(orderPayload),
    });

    if (!orderResponse.ok) {
      const errorBody = await orderResponse.text();
      console.error("PayPal API error:", errorBody);
      return new Response(JSON.stringify({ error: "Error al crear orden de PayPal" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const order = await orderResponse.json();
    const approveLink = order.links?.find((l: any) => l.rel === "approve")?.href;

    if (!approveLink) {
      return new Response(JSON.stringify({ error: "No se pudo obtener URL de PayPal" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (context === "gift_card") {
      await supabase
        .from("gift_cards")
        .update({ paypal_order_id: order.id })
        .eq("id", bookingId);
    } else if (context !== "supplement" && context !== "extras") {
      await supabase
        .from("bookings")
        .update({ paypal_order_id: order.id })
        .eq("id", bookingId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        url: approveLink,
        order_id: order.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Error in create-paypal-order:", err);
    return new Response(JSON.stringify({ error: err.message || "Error interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
