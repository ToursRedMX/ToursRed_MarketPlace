import { createClient } from "npm:@supabase/supabase-js@2.108.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface CheckoutRequest {
  bookingId: string;
  amount: number;
  description: string;
  context: "booking" | "supplement" | "gift_card";
  customerEmail?: string;
  customerName?: string;
  redirectUrl?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openpayMerchantId = Deno.env.get("OPENPAY_MERCHANT_ID");
    const openpayApiKey = Deno.env.get("OPENPAY_API_KEY");
    const openpaySandbox = Deno.env.get("OPENPAY_SANDBOX") === "true";

    if (!openpayMerchantId || !openpayApiKey) {
      return new Response(
        JSON.stringify({ error: "Openpay no esta configurado" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: CheckoutRequest = await req.json();
    const { bookingId, amount, description, context, customerEmail, customerName } = body;

    if (!bookingId || !amount || amount <= 0) {
      return new Response(
        JSON.stringify({ error: "Faltan parametros requeridos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseUrl = openpaySandbox
      ? "https://sandbox-api.openpay.mx"
      : "https://api.openpay.mx";

    const siteUrl = Deno.env.get("SITE_URL") || "https://toursred.com";
    const successUrl = context === "gift_card"
      ? `${siteUrl}/gift-card-success`
      : context === "supplement"
      ? `${siteUrl}/supplement-success`
      : `${siteUrl}/success`;

    const chargePayload: Record<string, unknown> = {
      method: "card",
      amount: Math.round(amount * 100) / 100,
      currency: "MXN",
      description,
      order_id: `${context}_${bookingId}_${Date.now()}`,
      confirm: false,
      redirect_url: successUrl,
    };

    if (customerEmail) chargePayload.customer = { email: customerEmail, name: customerName || undefined };

    const auth = btoa(`${openpayApiKey}:`);
    const response = await fetch(
      `${baseUrl}/v1/${openpayMerchantId}/charges`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Basic ${auth}`,
        },
        body: JSON.stringify(chargePayload),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error("Openpay error:", JSON.stringify(result));
      return new Response(
        JSON.stringify({ error: result.description || result.error_message || "Error al crear cargo en Openpay" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (context === "booking" || context === "supplement") {
      await supabase
        .from("payment_transactions")
        .insert({
          booking_id: bookingId,
          payment_processor: "openpay",
          amount: amount,
          currency: "mxn",
          status: "pending",
          net_amount: amount,
          charge_context: context,
          charge_reference_id: bookingId,
        });
    }

    const checkoutUrl = result.payment_method?.url || result.checkout_url;

    return new Response(
      JSON.stringify({
        success: true,
        url: checkoutUrl,
        chargeId: result.id,
        openpayChargeId: result.id,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error in create-openpay-checkout:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Error interno del servidor" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
