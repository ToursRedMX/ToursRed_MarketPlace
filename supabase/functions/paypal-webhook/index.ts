import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function getPayPalAccessToken(supabase: any): Promise<{ token: string; base: string }> {
  let paypalClientId = Deno.env.get("PAYPAL_CLIENT_ID");
  let paypalClientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");
  let isSandbox = Deno.env.get("PAYPAL_SANDBOX") === "true";

  const { data: settings } = await supabase
    .from("platform_settings")
    .select("paypal_client_id, paypal_client_secret, paypal_sandbox")
    .maybeSingle();

  if (!paypalClientId && settings?.paypal_client_id) paypalClientId = settings.paypal_client_id;
  if (!paypalClientSecret && settings?.paypal_client_secret) paypalClientSecret = settings.paypal_client_secret;
  if (settings?.paypal_sandbox !== undefined && settings?.paypal_sandbox !== null) isSandbox = settings.paypal_sandbox;

  if (!paypalClientId || !paypalClientSecret) throw new Error("PayPal credentials not configured");

  const base = isSandbox ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
  const credentials = btoa(`${paypalClientId}:${paypalClientSecret}`);
  const response = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) throw new Error("Failed to get PayPal access token");
  const data = await response.json();
  return { token: data.access_token, base };
}

async function verifyWebhookSignature(
  base: string,
  accessToken: string,
  webhookId: string,
  headers: Headers,
  rawBody: string
): Promise<boolean> {
  const transmissionId = headers.get("PAYPAL-TRANSMISSION-ID");
  const transmissionTime = headers.get("PAYPAL-TRANSMISSION-TIME");
  const transmissionSig = headers.get("PAYPAL-TRANSMISSION-SIG");
  const certUrl = headers.get("PAYPAL-CERT-URL");
  const authAlgo = headers.get("PAYPAL-AUTH-ALGO");

  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
    console.error("Missing PayPal webhook signature headers");
    return false;
  }

  const verifyResponse = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      auth_algo: authAlgo,
      cert_url: certUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSig,
      transmission_time: transmissionTime,
      webhook_id: webhookId,
      webhook_event: JSON.parse(rawBody),
    }),
  });

  if (!verifyResponse.ok) {
    console.error("PayPal verify-webhook-signature HTTP error:", verifyResponse.status);
    return false;
  }

  const verifyData = await verifyResponse.json();
  return verifyData.verification_status === "SUCCESS";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const rawBody = await req.text();
    const webhookId = Deno.env.get("PAYPAL_WEBHOOK_ID");

    // CRITICAL: Reject all events if PAYPAL_WEBHOOK_ID is not configured.
    // This forces the correct deployment order:
    // 1. Deploy this function → get public URL
    // 2. Register webhook in PayPal Developer Dashboard
    // 3. Configure PAYPAL_WEBHOOK_ID as secret
    // 4. Only then can events be processed
    if (!webhookId) {
      console.error("PAYPAL_WEBHOOK_ID not configured — rejecting event. Register the webhook URL in PayPal Developer Dashboard and set the PAYPAL_WEBHOOK_ID secret.");
      return new Response(
        JSON.stringify({ error: "PAYPAL_WEBHOOK_ID no configurado. Registra el webhook en PayPal Developer Dashboard y configura el secret antes de recibir eventos." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify webhook signature
    const { token: accessToken, base } = await getPayPalAccessToken(supabase);
    const isValid = await verifyWebhookSignature(base, accessToken, webhookId, req.headers, rawBody);

    if (!isValid) {
      console.error("PayPal webhook signature verification failed");
      return new Response(
        JSON.stringify({ error: "Webhook signature verification failed" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`PayPal webhook received: ${event.event_type}`);

    // Log webhook event
    try {
      await supabase.from("webhook_logs").insert({
        event_type: `paypal.${event.event_type}`,
        event_id: event.id,
        payload: event,
      });
    } catch (logErr) {
      console.error("Error logging webhook event:", logErr);
    }

    const eventType = event.event_type;
    const resource = event.resource;

    switch (eventType) {
      // ============================================================
      // PAYMENT.CAPTURE.REFUNDED — refund succeeded
      // ============================================================
      case "PAYMENT.CAPTURE.REFUNDED": {
        const refundId = resource?.id || resource?.purchase_units?.[0]?.payments?.refunds?.[0]?.id;
        if (!refundId) {
          console.error("No refund ID in PAYMENT.CAPTURE.REFUNDED event");
          break;
        }

        // Look up payment_refunds by processor_refund_id
        const { data: refundRecord } = await supabase
          .from("payment_refunds")
          .select("id, processor_fee_lost, payment_processor")
          .eq("processor_refund_id", refundId)
          .maybeSingle();

        if (!refundRecord) {
          // Try lookup by metadata — the refund ID might be in a different field
          const captureId = resource?.links?.find((l: any) => l.rel === "up")?.href?.split("/").pop();
          if (captureId) {
            const { data: byCapture } = await supabase
              .from("payment_refunds")
              .select("id, processor_fee_lost, payment_processor")
              .eq("processor_original_reference", captureId)
              .eq("payment_processor", "paypal")
              .maybeSingle();
            if (byCapture) {
              await confirmPayPalRefund(supabase, byCapture, refundId, event);
              break;
            }
          }
          console.error(`No payment_refunds record found for PayPal refund ID: ${refundId}`);
          break;
        }

        await confirmPayPalRefund(supabase, refundRecord, refundId, event);
        break;
      }

      // ============================================================
      // PAYMENT.CAPTURE.REVERSED — requires manual review
      // ============================================================
      case "PAYMENT.CAPTURE.REVERSED": {
        const captureId = resource?.id;
        if (!captureId) {
          console.error("No capture ID in PAYMENT.CAPTURE.REVERSED event");
          break;
        }

        const { data: refundRecords } = await supabase
          .from("payment_refunds")
          .select("id")
          .eq("processor_original_reference", captureId)
          .eq("payment_processor", "paypal");

        for (const rec of refundRecords || []) {
          await supabase
            .from("payment_refunds")
            .update({
              status: "requires_action",
              webhook_last_event: eventType,
              webhook_last_payload: event,
              updated_at: new Date().toISOString(),
            })
            .eq("id", rec.id);

          EdgeRuntime.waitUntil(
            fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-ops-refund-failed`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              },
              body: JSON.stringify({ payment_refund_id: rec.id }),
            }).catch((err) => console.error("Error calling notify-ops-refund-failed:", err))
          );
        }
        break;
      }

      // ============================================================
      // PAYMENT.CAPTURE.COMPLETED — backfill payment_transactions if missing
      // ============================================================
      case "PAYMENT.CAPTURE.COMPLETED": {
        const captureId = resource?.id;
        if (!captureId) break;

        const { data: existingTx } = await supabase
          .from("payment_transactions")
          .select("id")
          .eq("paypal_capture_id", captureId)
          .maybeSingle();

        if (existingTx) {
          // Transaction already exists, nothing to do
          break;
        }

        // Try to find the booking by paypal_transaction_id on bookings table
        const { data: booking } = await supabase
          .from("bookings")
          .select("id")
          .eq("paypal_transaction_id", captureId)
          .maybeSingle();

        if (booking) {
          const amount = parseFloat(resource?.amount?.value || "0");
          const paypalFee = parseFloat(
            resource?.seller_receivable_breakdown?.paypal_fee?.value || "0"
          );

          await supabase.from("payment_transactions").insert({
            booking_id: booking.id,
            paypal_capture_id: captureId,
            payment_processor: "paypal",
            amount,
            currency: (resource?.amount?.currency_code || "MXN").toLowerCase(),
            status: "succeeded",
            payment_method_type: "Tarjeta",
            processor_fee: paypalFee,
            net_amount: amount - paypalFee,
            metadata: { event, source: "paypal_webhook_backfill" },
          });
          console.log(`Backfilled payment_transactions for capture ${captureId}`);
        }
        break;
      }

      // ============================================================
      // CUSTOMER.DISPUTE.CREATED / RESOLVED — log for manual review
      // ============================================================
      case "CUSTOMER.DISPUTE.CREATED":
      case "CUSTOMER.DISPUTE.RESOLVED": {
        console.warn(`PayPal dispute event: ${eventType}`, JSON.stringify(resource));
        break;
      }

      default:
        console.log(`Unhandled PayPal webhook event type: ${eventType}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Error in paypal-webhook:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function confirmPayPalRefund(supabase: any, refundRecord: any, processorRefundId: string, event: any) {
  await supabase
    .from("payment_refunds")
    .update({
      status: "succeeded",
      confirmed_at: new Date().toISOString(),
      webhook_last_event: event.event_type,
      webhook_last_payload: event,
      updated_at: new Date().toISOString(),
    })
    .eq("id", refundRecord.id);

  // Create accounting entry for non-recoverable processor fee
  if (parseFloat(refundRecord.processor_fee_lost) > 0) {
    try {
      await createRefundFeeAccountingEntry(supabase, refundRecord.id, parseFloat(refundRecord.processor_fee_lost), "paypal");
    } catch (acctErr) {
      console.error("Error creating accounting entry for PayPal refund fee:", acctErr);
    }
  }

  // Claw back loyalty points for the refunded charge
  try {
    const { data: refundDetail } = await supabase
      .from("payment_refunds")
      .select("payment_transaction_id, requested_amount")
      .eq("id", refundRecord.id)
      .maybeSingle();

    if (refundDetail?.payment_transaction_id) {
      const { data: ptx } = await supabase
        .from("payment_transactions")
        .select("charge_context, charge_reference_id, booking_id")
        .eq("id", refundDetail.payment_transaction_id)
        .maybeSingle();

      if (ptx?.charge_reference_id) {
        const { data: booking } = await supabase
          .from("bookings")
          .select("user_id")
          .eq("id", ptx.booking_id)
          .maybeSingle();

        if (booking?.user_id) {
          const referenceTypeMap: Record<string, string> = {
            'payment_plan_installment': 'payment_plan',
            'supplement': 'supplement',
            'insurance': 'insurance_payment',
            'optional_service': 'optional_service_payment',
            'booking_deposit': 'booking',
          };
          const refType = referenceTypeMap[ptx.charge_context] || 'booking';
          const { error: clawbackError } = await supabase.rpc("claw_back_points_for_refund", {
            p_user_id: booking.user_id,
            p_reference_id: ptx.charge_reference_id,
            p_reference_type: refType,
            p_refund_id: refundRecord.id,
            p_amount: Math.floor(parseFloat(refundDetail.requested_amount)),
          });
          if (clawbackError) {
            console.error(`Error clawing back points for PayPal refund ${refundRecord.id}: ${clawbackError.message}`);
          } else {
            console.log(`Points clawback processed for PayPal refund ${refundRecord.id}`);
          }
        }
      }
    }
  } catch (clawbackErr) {
    console.error("Error during points clawback (PayPal):", clawbackErr);
  }

  console.log(`PayPal refund ${processorRefundId} confirmed for payment_refund ${refundRecord.id}`);
}

async function createRefundFeeAccountingEntry(supabase: any, refundId: string, feeAmount: number, processor: string) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;

  // Generate entry number
  const { data: entryCount } = await supabase
    .from("accounting_entries")
    .select("id", { count: "exact", head: true })
    .eq("period_year", year)
    .eq("period_month", month);

  const entryNumber = `AS-${year}${String(month).padStart(2, "0")}-${String((entryCount || 0) + 1).padStart(5, "0")}`;

  // Create the entry
  const { data: entry, error: entryError } = await supabase
    .from("accounting_entries")
    .insert({
      entry_number: entryNumber,
      entry_type: "pago",
      entry_date: today.toISOString().split("T")[0],
      period_year: year,
      period_month: month,
      description: `Comision no recuperable de ${processor} por reembolso (refund: ${refundId})`,
      source_type: "payment_refund",
      source_id: refundId,
      is_posted: true,
      posted_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (entryError || !entry) {
    console.error("Error creating accounting entry:", entryError);
    return;
  }

  // Determine the processor liability account code
  const processorAccountCode = processor === "stripe" ? "102.03" : processor === "paypal" ? "102.03" : "102.03";

  // Create two lines: debit (expense) + credit (processor liability)
  await supabase.from("accounting_entry_lines").insert([
    {
      entry_id: entry.id,
      line_number: 1,
      account_code: "606.02",
      description: `Comision no recuperable - ${processor}`,
      debit: feeAmount,
      credit: 0,
    },
    {
      entry_id: entry.id,
      line_number: 2,
      account_code: processorAccountCode,
      description: `Reduccion de saldo - ${processor}`,
      debit: 0,
      credit: feeAmount,
    },
  ]);
}
