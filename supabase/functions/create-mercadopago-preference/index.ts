import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

    const { bookingId, supplementId, customerEmail, amount, description, context } = await req.json();

    if (!amount) {
      return new Response(JSON.stringify({ error: "Datos incompletos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (context !== "supplement" && !bookingId) {
      return new Response(JSON.stringify({ error: "Datos incompletos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");

    const { data: platformSettings } = await supabase
      .from("platform_settings")
      .select("mercadopago_access_token, mercadopago_public_key, platform_url")
      .maybeSingle();

    if (!mpAccessToken && platformSettings?.mercadopago_access_token) {
      mpAccessToken = platformSettings.mercadopago_access_token;
    }

    if (!mpAccessToken) {
      return new Response(JSON.stringify({ error: "MercadoPago no configurado" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Always use the configured platform URL for back_urls so MercadoPago receives
    // a valid public HTTPS domain instead of the local dev/webcontainer URL.
    const origin = platformSettings?.platform_url?.replace(/\/$/, "") || "https://toursred.com";

    let items: any[] = [];
    let successUrl = "";
    let cancelUrl = "";

    if (context === "gift_card") {
      items = [
        {
          id: bookingId,
          title: description || "Tarjeta de Regalo ToursRed",
          description: "Tarjeta de regalo valida por 1 ano",
          quantity: 1,
          unit_price: Math.round(amount * 100) / 100,
          currency_id: "MXN",
        },
      ];
      successUrl = `${origin}/gift-card/success?gift_card_id=${bookingId}&provider=mercadopago`;
      cancelUrl = `${origin}/gift-cards`;
    } else if (context === "supplement") {
      items = [
        {
          id: supplementId,
          title: description || "Suplemento - ToursRed",
          description: "Pago de suplemento para reserva",
          quantity: 1,
          unit_price: Math.round(amount * 100) / 100,
          currency_id: "MXN",
        },
      ];
      successUrl = `${origin}/payment-return?provider=mercadopago&booking_supplement_id=${supplementId}&tr_status=success`;
      cancelUrl = `${origin}/traveler/bookings`;
    } else {
      items = [
        {
          id: bookingId,
          title: description || "Deposito de Reserva - ToursRed",
          description: "Deposito para reserva de tour",
          quantity: 1,
          unit_price: Math.round(amount * 100) / 100,
          currency_id: "MXN",
        },
      ];
      successUrl = `${origin}/payment-return?provider=mercadopago&booking_id=${bookingId}&tr_status=success`;
      cancelUrl = `${origin}/payment-return?provider=mercadopago&booking_id=${bookingId}&tr_status=cancel`;
    }

    let mpPublicKey = Deno.env.get("MERCADOPAGO_PUBLIC_KEY");
    if (!mpPublicKey && platformSettings?.mercadopago_public_key) {
      mpPublicKey = platformSettings.mercadopago_public_key;
    }

    const externalReference = context === "supplement" ? supplementId : bookingId;
    const pendingUrl = context === "supplement"
      ? `${origin}/payment-return?provider=mercadopago&booking_supplement_id=${supplementId}&tr_status=pending`
      : `${origin}/payment-return?provider=mercadopago&booking_id=${bookingId}&tr_status=pending`;

    const preferencePayload = {
      items,
      payer: customerEmail ? { email: customerEmail } : undefined,
      back_urls: {
        success: successUrl,
        failure: cancelUrl,
        pending: pendingUrl,
      },
      auto_return: "approved",
      external_reference: externalReference,
      notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mercadopago-webhook`,
      statement_descriptor: "TOURSRED",
      binary_mode: false,
      payment_methods: {
        excluded_payment_types: [{ id: "ticket" }],
      },
    };

    const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mpAccessToken}`,
      },
      body: JSON.stringify(preferencePayload),
    });

    if (!mpResponse.ok) {
      const errorBody = await mpResponse.text();
      console.error("MercadoPago API error:", errorBody);
      return new Response(JSON.stringify({ error: "Error al crear preferencia de MercadoPago" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const preference = await mpResponse.json();

    return new Response(
      JSON.stringify({
        success: true,
        url: preference.init_point,
        preference_id: preference.id,
        public_key: mpPublicKey || null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Error in create-mercadopago-preference:", err);
    return new Response(JSON.stringify({ error: err.message || "Error interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
