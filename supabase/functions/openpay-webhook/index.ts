import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";
import { isConfigured, getCharge } from "../_shared/openpay.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // ── Step 1: Log raw payload immediately ──────────────────────
  let rawBody: any = null;
  try {
    rawBody = await req.json();
  } catch {
    // Non-JSON body, still log it
    const text = await req.text().catch(() => "");
    rawBody = { raw_text: text };
  }

  let webhookEventId: string | null = null;

  try {
    const eventType = rawBody?.type || "unknown";
    const transactionId = rawBody?.transaction?.id || null;
    const orderId = rawBody?.transaction?.order_id || null;

    const { data: logData } = await supabase.from("openpay_webhook_events").insert({
      event_type: eventType,
      transaction_id: transactionId,
      order_id: orderId,
      raw_payload: rawBody,
      processing_status: "received",
    }).select("id").single();

    webhookEventId = logData?.id || null;
  } catch (logError) {
    console.error("Failed to log webhook event:", logError);
    // Still return 200 so OpenPay doesn't retry
  }

  // Respond 200 immediately after logging — even if processing fails later
  // OpenPay requires 200 to stop retrying

  // ── Step 2: Handle by event type ─────────────────────────────
  const eventType = (rawBody?.type || "").toUpperCase();

  // Verification event — log and return
  if (eventType === "VERIFICATION") {
    const verificationCode = rawBody?.verification_code;
    console.log("OpenPay webhook verification code:", verificationCode);
    if (webhookEventId) {
      await supabase.from("openpay_webhook_events").update({
        processing_status: "processed",
        processing_result: `Verification code: ${verificationCode}`,
        processed_at: new Date().toISOString(),
      }).eq("id", webhookEventId);
    }
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  // Only charge.succeeded triggers credit — all other events are logged and ignored
  if (eventType !== "CHARGE.SUCCEEDED") {
    if (webhookEventId) {
      await supabase.from("openpay_webhook_events").update({
        processing_status: "ignored",
        processing_result: `Event type ${eventType} — no action needed`,
        processed_at: new Date().toISOString(),
      }).eq("id", webhookEventId);
    }
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  // ── Step 3: Process charge.succeeded ─────────────────────────
  try {
    if (!isConfigured()) {
      console.error("OpenPay not configured — cannot verify charge");
      if (webhookEventId) {
        await supabase.from("openpay_webhook_events").update({
          processing_status: "error",
          processing_error: "OpenPay credentials not configured",
          processed_at: new Date().toISOString(),
        }).eq("id", webhookEventId);
      }
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    const transaction = rawBody?.transaction;
    if (!transaction || !transaction.id) {
      if (webhookEventId) {
        await supabase.from("openpay_webhook_events").update({
          processing_status: "no_reconocido",
          processing_error: "No transaction.id in payload",
          processed_at: new Date().toISOString(),
        }).eq("id", webhookEventId);
      }
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // Find the topup by provider_charge_id (fallback: order_id)
    let topupQuery = supabase
      .from("openpay_wallet_topups")
      .select("*")
      .eq("provider_charge_id", transaction.id);

    const { data: topupByChargeId, error: topupError } = await topupQuery.maybeSingle();

    let topup = topupByChargeId;

    // Fallback: search by order_id
    if (!topup && transaction.order_id) {
      const { data: topupByOrder } = await supabase
        .from("openpay_wallet_topups")
        .select("*")
        .eq("order_id", transaction.order_id)
        .maybeSingle();
      topup = topupByOrder;
    }

    if (!topup) {
      // No matching topup — mark for conciliation
      if (webhookEventId) {
        await supabase.from("openpay_webhook_events").update({
          processing_status: "no_reconocido",
          processing_result: `No topup found for charge ${transaction.id}`,
          processed_at: new Date().toISOString(),
        }).eq("id", webhookEventId);
      }
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // Already completed — idempotent return
    if (topup.status === "completed" && topup.credited_at) {
      if (webhookEventId) {
        await supabase.from("openpay_webhook_events").update({
          processing_status: "processed",
          processing_result: "Already credited — idempotent skip",
          processed_at: new Date().toISOString(),
        }).eq("id", webhookEventId);
      }
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // ── Step 4: Verify charge against OpenPay API ────────────
    const customerId = topup.openpay_customer_id;
    if (!customerId) {
      if (webhookEventId) {
        await supabase.from("openpay_webhook_events").update({
          processing_status: "requiere_conciliacion_manual",
          processing_error: "No openpay_customer_id on topup record",
          processed_at: new Date().toISOString(),
        }).eq("id", webhookEventId);
      }
      await supabase.from("openpay_wallet_topups").update({
        conciliation_status: "requiere_conciliacion_manual",
      }).eq("id", topup.id);
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    let verifiedCharge;
    try {
      verifiedCharge = await getCharge(customerId, topup.provider_charge_id);
    } catch (verifyErr) {
      console.error("Failed to verify charge with OpenPay:", verifyErr);
      if (webhookEventId) {
        await supabase.from("openpay_webhook_events").update({
          processing_status: "requiere_conciliacion_manual",
          processing_error: `API verification failed: ${verifyErr.message}`,
          processed_at: new Date().toISOString(),
        }).eq("id", webhookEventId);
      }
      await supabase.from("openpay_wallet_topups").update({
        conciliation_status: "requiere_conciliacion_manual",
      }).eq("id", topup.id);
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // ── Step 5: Validate all fields match ────────────────────
    const validations: { label: string; pass: boolean; detail?: string }[] = [
      {
        label: "charge_id",
        pass: verifiedCharge.id === topup.provider_charge_id,
        detail: `${verifiedCharge.id} vs ${topup.provider_charge_id}`,
      },
      {
        label: "order_id",
        pass: verifiedCharge.order_id === topup.order_id,
        detail: `${verifiedCharge.order_id} vs ${topup.order_id}`,
      },
      {
        label: "method",
        pass: verifiedCharge.method === "bank_account" || verifiedCharge.method === "codi",
        detail: verifiedCharge.method,
      },
      {
        label: "status",
        pass: verifiedCharge.status === "completed",
        detail: verifiedCharge.status,
      },
      {
        label: "amount",
        pass: Number(verifiedCharge.amount) === Number(topup.amount),
        detail: `${verifiedCharge.amount} vs ${topup.amount}`,
      },
    ];

    const allValid = validations.every(v => v.pass);

    if (!allValid) {
      const failed = validations.filter(v => !v.pass);
      const errorMsg = failed.map(f => `${f.label}: ${f.detail}`).join("; ");

      if (webhookEventId) {
        await supabase.from("openpay_webhook_events").update({
          processing_status: "requiere_conciliacion_manual",
          processing_error: `Validation failed — ${errorMsg}`,
          processed_at: new Date().toISOString(),
        }).eq("id", webhookEventId);
      }
      await supabase.from("openpay_wallet_topups").update({
        conciliation_status: "requiere_conciliacion_manual",
      }).eq("id", topup.id);
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // ── Step 6: Credit wallet via update_wallet_balance ──────
    const transactionType = topup.payment_method_type === "codi" ? "topup_codi" : "topup_spei";
    const referenceType = topup.payment_method_type === "codi"
      ? "openpay_codi_topup"
      : "openpay_spei_topup";

    const { data: creditResult, error: creditError } = await supabase.rpc(
      "update_wallet_balance",
      {
        p_user_id: topup.user_id,
        p_amount: topup.amount,
        p_type: transactionType,
        p_description: topup.payment_method_type === "codi"
          ? "Recarga de ToursRed Cash mediante CoDi"
          : "Recarga de ToursRed Cash mediante SPEI",
        p_reference_id: topup.id,
        p_reference_type: referenceType,
        p_idempotency_key: topup.provider_charge_id,
      }
    );

    if (creditError) {
      console.error("Wallet credit error:", creditError);
      // Check if it was an idempotency conflict (already credited)
      if (creditError.message && creditError.message.includes("idempotency")) {
        // Already credited — mark as processed
        await supabase.from("openpay_wallet_topups").update({
          status: "completed",
          credited_at: new Date().toISOString(),
          conciliation_status: null,
        }).eq("id", topup.id);

        if (webhookEventId) {
          await supabase.from("openpay_webhook_events").update({
            processing_status: "processed",
            processing_result: "Already credited (idempotency conflict resolved)",
            processed_at: new Date().toISOString(),
          }).eq("id", webhookEventId);
        }
        return new Response("OK", { status: 200, headers: corsHeaders });
      }

      // Real error — mark for conciliation
      if (webhookEventId) {
        await supabase.from("openpay_webhook_events").update({
          processing_status: "requiere_conciliacion_manual",
          processing_error: `Wallet credit failed: ${creditError.message}`,
          processed_at: new Date().toISOString(),
        }).eq("id", webhookEventId);
      }
      await supabase.from("openpay_wallet_topups").update({
        conciliation_status: "requiere_conciliacion_manual",
      }).eq("id", topup.id);
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // ── Step 7: Mark topup as completed ──────────────────────
    await supabase.from("openpay_wallet_topups").update({
      status: "completed",
      credited_at: new Date().toISOString(),
      conciliation_status: null,
    }).eq("id", topup.id);

    // ── Step 7b: Create accounting entry (non-blocking) ──────
    try {
      const { error: acctError } = await supabase.rpc(
        "create_accounting_entry_for_wallet_topup",
        { p_topup_id: topup.id }
      );
      if (acctError) {
        console.error("Accounting entry failed for topup", topup.id, ":", acctError.message);
      }
    } catch (acctErr) {
      console.error("Accounting entry exception for topup", topup.id, ":", acctErr.message);
    }

    if (webhookEventId) {
      await supabase.from("openpay_webhook_events").update({
        processing_status: "processed",
        processing_result: `Acreditado: ${topup.amount} MXN via ${topup.payment_method_type}`,
        processed_at: new Date().toISOString(),
      }).eq("id", webhookEventId);
    }

    return new Response("OK", { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("Unexpected error processing charge.succeeded:", err);
    if (webhookEventId) {
      await supabase.from("openpay_webhook_events").update({
        processing_status: "error",
        processing_error: `Unexpected error: ${err.message}`,
        processed_at: new Date().toISOString(),
      }).eq("id", webhookEventId);
    }
    // Still return 200 to prevent OpenPay retries that would hit the same error
    return new Response("OK", { status: 200, headers: corsHeaders });
  }
});
