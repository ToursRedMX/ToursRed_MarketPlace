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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "No autorizado" }, 401);
    }

    const { data: { user }, error: userErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userErr || !user) {
      return jsonResponse({ error: "No autorizado" }, 401);
    }

    const { booking_id, amount, description } = await req.json();

    if (!amount || amount <= 0) {
      return jsonResponse({ error: "Se requiere un monto válido para el checkout de tokenización" }, 400);
    }

    const { data: userProfile } = await supabase
      .from("users")
      .select("first_name, last_name")
      .maybeSingle();

    const customerName = `${userProfile?.first_name || ""} ${userProfile?.last_name || ""}`.trim() || "Cliente";
    const customerEmail = user.email || "no-email@toursred.com";

    const conektaPrivateKey = Deno.env.get("CONEKTA_PRIVATE_KEY");
    if (!conektaPrivateKey) {
      return jsonResponse({ error: "Conekta no configurado" }, 500);
    }

    const amountInCents = Math.round(amount * 100);

    // Create a preliminary Integration checkout for card tokenization
    const orderPayload = {
      currency: "MXN",
      amount: amountInCents,
      customer_info: {
        name: customerName,
        email: customerEmail,
      },
      line_items: [
        {
          name: description || "Tokenización de tarjeta",
          unit_price: amountInCents,
          quantity: 1,
        },
      ],
      checkout: {
        type: "Integration",
        allowed_payment_methods: ["card"],
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      },
      metadata: {
        booking_id: booking_id || null,
        purpose: "card_tokenization",
      },
    };

    const conektaApiBase = Deno.env.get("CONEKTA_API_BASE") || "https://api.conekta.io";
    const apiResponse = await fetch(`${conektaApiBase}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/vnd.conekta-v2.2.0+json",
        "Authorization": `Bearer ${conektaPrivateKey}`,
        "X-Conekta-Client-Info": '{"name":"toursred","version":"1.0.0"}',
      },
      body: JSON.stringify(orderPayload),
    });

    if (!apiResponse.ok) {
      const errorBody = await apiResponse.text();
      console.error("Conekta API error (tokenization checkout):", errorBody);
      let errorMsg = "Error al crear checkout de tokenización";
      try {
        const parsed = JSON.parse(errorBody);
        errorMsg = parsed?.details?.[0]?.message || parsed?.message || errorMsg;
      } catch {}
      return jsonResponse({ error: errorMsg }, 500);
    }

    const order = await apiResponse.json();
    const checkoutId = order.checkout?.id;

    if (!checkoutId) {
      console.error("Conekta response missing checkout id:", JSON.stringify(order));
      return jsonResponse({ error: "No se recibió el ID de checkout de Conekta" }, 500);
    }

    return jsonResponse({
      success: true,
      checkout_id: checkoutId,
      order_id: order.id,
    });
  } catch (err: any) {
    console.error("Error in create-conekta-tokenization-checkout:", err);
    return jsonResponse({ error: err.message || "Error interno" }, 500);
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
