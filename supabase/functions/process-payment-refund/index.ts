import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@22.3.0";

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
    const authHeader = req.headers.get("Authorization") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const expectedAuth = `Bearer ${serviceKey}`;

    if (authHeader !== expectedAuth) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: service role key required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceKey
    );

    const {
      booking_id,
      payment_transaction_id,
      cancellation_id,
      partial_cancellation_id,
      amount,
      currency,
      requested_by = "admin_override",
      created_by_user_id,
    } = await req.json();

    // ============================================================
    // Validation: payment_transaction_id is now MANDATORY
    // ============================================================
    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id es requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!payment_transaction_id) {
      return new Response(JSON.stringify({
        error: "payment_transaction_id es requerido. Usa el endpoint de lineas reembolsables para obtenerlo.",
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!amount || amount <= 0) {
      return new Response(JSON.stringify({ error: "amount debe ser mayor a 0" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validRequestedBy = ["traveler_default", "traveler_profeco_request", "admin_override"];
    if (!validRequestedBy.includes(requested_by)) {
      return new Response(JSON.stringify({ error: `requested_by debe ser uno de: ${validRequestedBy.join(", ")}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============================================================
    // Paso 1: Lookup the SPECIFIC transaction (no more order+limit fallback)
    // ============================================================
    const { data: tx } = await supabase
      .from("payment_transactions")
      .select("id, booking_id, payment_processor, stripe_payment_intent_id, paypal_capture_id, mercadopago_payment_id, amount, payment_method_type, processor_fee, charge_context, charge_reference_id")
      .eq("id", payment_transaction_id)
      .maybeSingle();

    if (!tx) {
      return new Response(
        JSON.stringify({ error: "La transaccion especificada no existe." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (tx.booking_id !== booking_id) {
      return new Response(
        JSON.stringify({ error: "La transaccion no pertenece a la reserva indicada." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const processor = tx.payment_processor;
    if (!processor) {
      return new Response(
        JSON.stringify({ error: "No se pudo determinar el procesador de pago original. Usa Transferencia o ToursRed Cash." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (tx.payment_method_type === "OXXO" || tx.payment_method_type === "Transferencia Bancaria") {
      return new Response(
        JSON.stringify({ error: `Los pagos via ${tx.payment_method_type} no son reembolsables a metodo original. Usa Transferencia o ToursRed Cash.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let processorOriginalReference: string | null = null;
    if (processor === "stripe") {
      processorOriginalReference = tx.stripe_payment_intent_id;
    } else if (processor === "paypal") {
      processorOriginalReference = tx.paypal_capture_id;
    } else if (processor === "mercadopago") {
      processorOriginalReference = tx.mercadopago_payment_id;
    }

    if (!processorOriginalReference) {
      return new Response(
        JSON.stringify({ error: `Falta la referencia del procesador (${processor}) en la transaccion. Usa Transferencia o ToursRed Cash.` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============================================================
    // Paso 2: Validate amount against THIS specific transaction
    // ============================================================
    const originalAmount = parseFloat(tx.amount);
    const { data: priorRefunds } = await supabase
      .from("payment_refunds")
      .select("requested_amount")
      .eq("payment_transaction_id", tx.id)
      .in("status", ["succeeded", "processing", "pending"]);

    const alreadyRefunded = (priorRefunds || []).reduce((sum: number, r: any) => sum + parseFloat(r.requested_amount), 0);
    const maxRefundable = originalAmount - alreadyRefunded;

    if (amount > maxRefundable) {
      return new Response(
        JSON.stringify({
          error: `El monto solicitado (${amount}) excede el maximo reembolsable para esta linea (${maxRefundable.toFixed(2)}). Ya reembolsado: ${alreadyRefunded.toFixed(2)}.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============================================================
    // Paso 3: Idempotency — check for active refund on THIS transaction
    // ============================================================
    const { data: existingActiveRefund } = await supabase
      .from("payment_refunds")
      .select("id, status")
      .eq("payment_transaction_id", tx.id)
      .in("status", ["pending", "processing"])
      .maybeSingle();

    if (existingActiveRefund) {
      return new Response(
        JSON.stringify({
          error: "Ya existe un reembolso en proceso para esta linea de pago.",
          existing_refund_id: existingActiveRefund.id,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============================================================
    // Paso 4: Insert payment_refunds
    // ============================================================
    const idempotencyKey = `${tx.id}_${cancellation_id || partial_cancellation_id || "admin"}_${Date.now()}`;

    const { data: refundRecord, error: refundInsertError } = await supabase
      .from("payment_refunds")
      .insert({
        booking_id,
        cancellation_id: cancellation_id || null,
        partial_cancellation_id: partial_cancellation_id || null,
        payment_transaction_id: tx.id,
        refund_method: "original_payment_method",
        payment_processor: processor,
        processor_original_reference: processorOriginalReference,
        requested_amount: amount,
        currency: currency || "mxn",
        status: "pending",
        idempotency_key: idempotencyKey,
        requested_by: requested_by,
        created_by_user_id: created_by_user_id || null,
      })
      .select("id")
      .single();

    if (refundInsertError || !refundRecord) {
      console.error("Error inserting payment_refunds:", refundInsertError);
      return new Response(
        JSON.stringify({ error: "Error al crear el registro de reembolso" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const refundId = refundRecord.id;

    // ============================================================
    // Paso 5: Processor adapter
    // ============================================================
    let processorRefundId: string | null = null;
    let processorFeeLost = 0;

    try {
      if (processor === "stripe") {
        const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
        if (!stripeSecretKey) throw new Error("STRIPE_SECRET_KEY no configurado");
        const stripe = new Stripe(stripeSecretKey, { apiVersion: "2026-06-24.dahlia" });

        const refund = await stripe.refunds.create({
          payment_intent: processorOriginalReference,
          amount: Math.round(amount * 100),
          reason: "requested_by_customer",
          metadata: {
            booking_id,
            toursred_refund_id: refundId,
            toursred_payment_transaction_id: tx.id,
          },
        }, {
          idempotencyKey,
        });

        processorRefundId = refund.id;
        const originalFee = parseFloat(tx.processor_fee) || 0;
        processorFeeLost = originalAmount > 0
          ? Math.round((originalFee * (amount / originalAmount)) * 100) / 100
          : 0;

      } else if (processor === "paypal") {
        const paypalClientId = Deno.env.get("PAYPAL_CLIENT_ID");
        let paypalClientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");
        let isSandbox = Deno.env.get("PAYPAL_SANDBOX") === "true";

        const { data: settings } = await supabase
          .from("platform_settings")
          .select("paypal_client_id, paypal_client_secret, paypal_sandbox")
          .maybeSingle();
        if (!paypalClientId && settings?.paypal_client_id) paypalClientId = settings.paypal_client_id;
        if (!paypalClientSecret && settings?.paypal_client_secret) paypalClientSecret = settings.paypal_client_secret;
        if (settings?.paypal_sandbox !== undefined && settings?.paypal_sandbox !== null) isSandbox = settings.paypal_sandbox;

        if (!paypalClientId || !paypalClientSecret) throw new Error("PayPal no configurado");

        const base = isSandbox ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
        const credentials = btoa(`${paypalClientId}:${paypalClientSecret}`);
        const tokenResponse = await fetch(`${base}/v1/oauth2/token`, {
          method: "POST",
          headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: "grant_type=client_credentials",
        });
        if (!tokenResponse.ok) throw new Error("Failed to get PayPal access token");
        const tokenData = await tokenResponse.json();

        const refundResponse = await fetch(`${base}/v2/payments/captures/${processorOriginalReference}/refund`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${tokenData.access_token}`,
            "PayPal-Request-Id": idempotencyKey,
          },
          body: JSON.stringify({
            amount: { value: amount.toFixed(2), currency_code: (currency || "MXN").toUpperCase() },
            note_to_payer: "Reembolso ToursRed",
          }),
        });

        if (!refundResponse.ok) {
          const errorBody = await refundResponse.text();
          throw new Error(`PayPal refund failed: ${errorBody}`);
        }

        const refundData = await refundResponse.json();
        processorRefundId = refundData.id || refundData.purchase_unit?.payments?.refunds?.[0]?.id || null;

        const originalFee = parseFloat(tx.processor_fee) || 0;
        processorFeeLost = originalAmount > 0
          ? Math.round((originalFee * (amount / originalAmount)) * 100) / 100
          : 0;

      } else if (processor === "mercadopago") {
        let mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
        if (!mpAccessToken) {
          const { data: settings } = await supabase
            .from("platform_settings")
            .select("mercadopago_access_token")
            .maybeSingle();
          if (settings?.mercadopago_access_token) mpAccessToken = settings.mercadopago_access_token;
        }
        if (!mpAccessToken) throw new Error("MercadoPago no configurado");

        const refundResponse = await fetch(`https://api.mercadopago.com/v1/payments/${processorOriginalReference}/refunds`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${mpAccessToken}`,
            "X-Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({ amount }),
        });

        if (!refundResponse.ok) {
          const errorBody = await refundResponse.text();
          throw new Error(`MercadoPago refund failed: ${errorBody}`);
        }

        const refundData = await refundResponse.json();
        processorRefundId = refundData.id ? String(refundData.id) : null;
        processorFeeLost = 0;
      }

      // ============================================================
      // Paso 6: Update payment_refunds with processor result
      // ============================================================
      await supabase
        .from("payment_refunds")
        .update({
          processor_refund_id: processorRefundId,
          processor_fee_lost: processorFeeLost,
          status: "processing",
          processed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", refundId);

      return new Response(
        JSON.stringify({
          success: true,
          payment_refund_id: refundId,
          payment_transaction_id: tx.id,
          charge_context: tx.charge_context,
          status: "processing",
          processor_refund_id: processorRefundId,
          processor_fee_lost: processorFeeLost,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } catch (processorError: any) {
      await supabase
        .from("payment_refunds")
        .update({
          status: "failed",
          failure_reason: processorError.message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", refundId);

      EdgeRuntime.waitUntil(
        fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-ops-refund-failed`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ payment_refund_id: refundId }),
        }).catch((err) => console.error("Error calling notify-ops-refund-failed:", err))
      );

      return new Response(
        JSON.stringify({
          success: false,
          payment_refund_id: refundId,
          status: "failed",
          error: processorError.message,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (err: any) {
    console.error("Error in process-payment-refund:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
