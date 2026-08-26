import { createClient } from "npm:@supabase/supabase-js@2.108.2";
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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    let giftCardId: string | null = null;

    if (req.method === "GET") {
      const url = new URL(req.url);
      giftCardId = url.searchParams.get("gift_card_id");
    } else if (req.method === "POST") {
      const body = await req.json();
      giftCardId = body.gift_card_id;
    }

    if (!giftCardId) {
      return new Response(
        JSON.stringify({ error: "gift_card_id es requerido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: gc, error: gcError } = await supabase
      .from("gift_cards")
      .select("id, amount, discount_amount, currency, status, payment_status, payment_provider, recipient_name")
      .eq("id", giftCardId)
      .maybeSingle();

    if (gcError) {
      return new Response(
        JSON.stringify({ error: "Error al consultar la tarjeta de regalo" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!gc) {
      return new Response(
        JSON.stringify({ error: "Tarjeta de regalo no encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result: Record<string, any> = {
      id: gc.id,
      amount: Number(gc.amount) || 0,
      discount_amount: Number(gc.discount_amount) || 0,
      currency: gc.currency || "MXN",
      status: gc.status,
      payment_status: gc.payment_status,
      payment_provider: gc.payment_provider,
      recipient_name: gc.recipient_name || null,
      payment_instructions: null,
    };

    // If payment is not yet completed, fetch OpenPay instructions from payment_transactions metadata
    if (gc.payment_status !== "paid") {
      const { data: tx } = await supabase
        .from("payment_transactions")
        .select("metadata, status, amount, payment_processor")
        .eq("charge_context", "gift_card")
        .eq("charge_reference_id", giftCardId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (tx?.metadata) {
        const meta = tx.metadata as Record<string, any>;
        result.payment_instructions = {
          openpay_method: meta.openpay_method || null,
          openpay_status: meta.openpay_status || null,
          clabe: meta.clabe || null,
          bank: meta.bank || null,
          reference: meta.reference || null,
          store: meta.store || null,
          expiry_date: meta.expiry_date || null,
          barcode_url: meta.barcode_url || null,
          spei_pdf_url: meta.spei_pdf_url || null,
          cash_pdf_url: meta.cash_pdf_url || null,
        };
        result.tx_status = tx.status;
        result.tx_amount = Number(tx.amount) || 0;
      }
    }

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
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
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
