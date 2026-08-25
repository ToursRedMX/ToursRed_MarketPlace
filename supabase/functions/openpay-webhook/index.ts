import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";
import { isConfigured, getCharge, getChargeMerchant } from "../_shared/openpay.ts";
import * as Sentry from "npm:@sentry/deno@9";

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    tracesSampleRate: 0.1,
  });
}

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
    const topupQuery = supabase
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
      // Check if this is a booking/supplement/gift_card charge (not a wallet topup)
      const chargeContext = transaction.metadata?.charge_context || transaction.metadata?.context;
      const chargeReferenceId = transaction.metadata?.charge_reference_id || transaction.metadata?.booking_id;

      if (chargeContext && chargeReferenceId) {
        // ── Corrección 3: Verify charge against OpenPay API before acting ──
        // 1) Fetch the charge fresh from the OpenPay API (no trusted webhook payload fields)
        // 2) Call getCharge() / getChargeMerchant() to verify the cargo
        // 3) Check payment_transactions.status for idempotency before CFDI/confirmation/accounting

        let verifiedApiCharge;
        try {
          let customerIdForVerification: string | null = null;

          if (chargeContext === "booking_deposit" || chargeContext === "booking") {
            const { data: bk } = await supabase.from("bookings").select("user_id").eq("id", chargeReferenceId).maybeSingle();
            if (bk?.user_id) {
              const { data: usr } = await supabase.from("users").select("openpay_customer_id").eq("id", bk.user_id).maybeSingle();
              customerIdForVerification = usr?.openpay_customer_id || null;
            }
          } else if (chargeContext === "supplement") {
            const { data: supp } = await supabase.from("booking_supplements").select("booking_id").eq("id", chargeReferenceId).maybeSingle();
            if (supp?.booking_id) {
              const { data: bk2 } = await supabase.from("bookings").select("user_id").eq("id", supp.booking_id).maybeSingle();
              if (bk2?.user_id) {
                const { data: usr2 } = await supabase.from("users").select("openpay_customer_id").eq("id", bk2.user_id).maybeSingle();
                customerIdForVerification = usr2?.openpay_customer_id || null;
              }
            }
          }
          // gift_card no tiene cliente asociado — customerIdForVerification queda null y cae correctamente a getChargeMerchant

          if (customerIdForVerification) {
            verifiedApiCharge = await getCharge(customerIdForVerification, transaction.id);
          } else {
            verifiedApiCharge = await getChargeMerchant(transaction.id);
          }
        } catch (verifyErr) {
          console.error("Failed to verify charge with OpenPay API:", verifyErr);
          if (webhookEventId) {
            await supabase.from("openpay_webhook_events").update({
              processing_status: "requiere_conciliacion_manual",
              processing_error: `API verification failed: ${verifyErr.message}`,
              processed_at: new Date().toISOString(),
            }).eq("id", webhookEventId);
          }
          return new Response("OK", { status: 200, headers: corsHeaders });
        }

        // Validate the API-verified charge
        if (verifiedApiCharge.status !== "completed" && verifiedApiCharge.status !== "success") {
          console.warn(`OpenPay charge ${transaction.id} status is "${verifiedApiCharge.status}", not completed. Skipping.`);
          if (webhookEventId) {
            await supabase.from("openpay_webhook_events").update({
              processing_status: "requiere_conciliacion_manual",
              processing_error: `Charge status from API: ${verifiedApiCharge.status} (not completed)`,
              processed_at: new Date().toISOString(),
            }).eq("id", webhookEventId);
          }
          return new Response("OK", { status: 200, headers: corsHeaders });
        }

        const feeDetails = verifiedApiCharge.fee_details || [];
        const processorFee = Array.isArray(feeDetails)
          ? feeDetails.reduce((sum: number, fd: any) => sum + parseFloat(fd.amount || "0"), 0)
          : 0;
        const feeBase = Array.isArray(feeDetails)
          ? feeDetails.filter((fd: any) => fd.type !== "tax").reduce((sum: number, fd: any) => sum + parseFloat(fd.amount || "0"), 0)
          : 0;
        const feeIva = Array.isArray(feeDetails)
          ? feeDetails.filter((fd: any) => fd.type === "tax").reduce((sum: number, fd: any) => sum + parseFloat(fd.amount || "0"), 0)
          : 0;
        const chargeAmount = parseFloat(verifiedApiCharge.amount || "0");
        const paymentMethodType = verifiedApiCharge.method || "card";

        // Determine payment_form for CFDI
        const paymentForm = paymentMethodType === "card" ? "04" : paymentMethodType === "bank_account" ? "03" : "01";

        if (chargeContext === "booking_deposit" || chargeContext === "booking") {
          const bookingId = chargeReferenceId;

          // ── Idempotency check: skip if this exact charge was already processed ──
          const { data: existingPt } = await supabase
            .from("payment_transactions")
            .select("id, status")
            .eq("booking_id", bookingId)
            .eq("payment_processor", "openpay")
            .eq("charge_context", "booking_deposit")
            .eq("openpay_charge_id", transaction.id)
            .maybeSingle();

          if (existingPt?.status === "succeeded") {
            console.log(`Booking ${bookingId} charge ${transaction.id} already succeeded — idempotent skip`);
            if (webhookEventId) {
              await supabase.from("openpay_webhook_events").update({
                processing_status: "processed",
                processing_result: "Booking payment already succeeded — idempotent skip",
                processed_at: new Date().toISOString(),
              }).eq("id", webhookEventId);
            }
            return new Response("OK", { status: 200, headers: corsHeaders });
          }

          // Update the specific pending payment_transaction for this charge
          await supabase
            .from("payment_transactions")
            .update({
              status: "succeeded",
              processor_fee: processorFee,
              processor_fee_base: feeBase,
              processor_fee_iva: feeIva,
              net_amount: chargeAmount - processorFee,
              openpay_charge_id: transaction.id,
            })
            .eq("booking_id", bookingId)
            .eq("payment_processor", "openpay")
            .eq("charge_context", "booking_deposit")
            .eq("status", "pending");

          // Soporte de pago incremental: sumar TODOS los pagos succeeded de cualquier
          // procesador para este booking_deposit antes de confirmar la reserva —
          // mismo patrón que ya usan stripe-webhook y conekta-webhook.
          const { data: allTx } = await supabase
            .from("payment_transactions")
            .select("amount, status")
            .eq("booking_id", bookingId)
            .eq("charge_context", "booking_deposit")
            .eq("status", "succeeded");

          const totalPaid = (allTx || []).reduce((sum: number, t: any) => sum + Number(t.amount), 0);

          const { data: booking } = await supabase
            .from("bookings")
            .select("amount_due_now, deposit_amount, total_price, user_payment, payment_status, status")
            .eq("id", bookingId)
            .maybeSingle();

          if (booking) {
            // Confirmar contra el exigible real. Con deposit_amount se confirmaba la
            // reserva cobrando de menos (quedaban fuera cargo por servicio y extras).
            const requiredAmount = Number(booking.amount_due_now)
              || Number(booking.deposit_amount)
              || Number(booking.total_price)
              || 0;
            const newUserPayment = Math.max(0, Number(booking.user_payment || 0) - chargeAmount);

            if (totalPaid >= requiredAmount) {
              await supabase
                .from("bookings")
                .update({
                  payment_status: "succeeded",
                  payment_provider: "openpay",
                  // Se escribia en booking_optional_services pero no aqui, asi que
                  // bookings.payment_method quedaba NULL y la pantalla de exito no
                  // tenia de donde sacar la etiqueta. Mismo valor que escriben los
                  // webhooks de MercadoPago, PayPal y Conekta.
                  payment_method: "openpay",
                  user_payment: newUserPayment,
                  paid_at: new Date().toISOString(),
                  status: "confirmed",
                })
                .eq("id", bookingId);

              console.log(`Booking ${bookingId} confirmed (Openpay) — total paid: ${totalPaid}/${requiredAmount}`);

              // Marcar como pagados los extras que venian en el pago inicial. Openpay
              // solo lo hacia para extras comprados por separado (chargeContext ===
              // "optional_service"), asi que los del checkout quedaban con paid_at NULL:
              // el CFDI los excluia y calculate_booking_financial_breakdown dejaba a la
              // agencia sin cobrar optional_services_agency_net.
              //
              // A diferencia de Stripe y PayPal, aqui NO se recalcula service_charge ni
              // se vuelve a llamar apply_membership_service_fee_exemption: esa RPC muta
              // memberships, y create_booking_atomic ya aplico la exencion y guardo el
              // service_charge neto al crear la reserva. Repetirlo consumiria dos veces
              // el tope mensual del socio.
              //
              // Va ANTES de disparar el CFDI: generate-booking-cfdi filtra los extras por
              // paid_at IS NOT NULL, asi que si se marcan despues quedan fuera del
              // comprobante.
              try {
                const { error: optErr } = await supabase
                  .from("booking_optional_services")
                  .update({
                    paid_at: new Date().toISOString(),
                    payment_method: "openpay",
                    updated_at: new Date().toISOString(),
                  })
                  .eq("booking_id", bookingId)
                  .eq("is_cancelled", false)
                  .is("paid_at", null);
                if (optErr) {
                  console.error("Error marcando extras pagados (Openpay):", optErr);
                }
              } catch (e) {
                console.error("Error marcando extras pagados (Openpay):", e);
              }

              const cfdiSettingsRes = await supabase
                .from("platform_settings")
                .select("pac_provider")
                .maybeSingle();
              const cfdiSecretsRes = await supabase
                .from("platform_secrets")
                .select("pac_api_key_encrypted")
                .maybeSingle();
              const cfdiSettings = { pac_provider: cfdiSettingsRes?.data?.pac_provider, pac_api_key_encrypted: cfdiSecretsRes?.data?.pac_api_key_encrypted };

              if (cfdiSettings?.pac_provider && cfdiSettings.pac_provider !== "none") {
                EdgeRuntime.waitUntil(
                  fetch(`${supabaseUrl}/functions/v1/generate-booking-cfdi`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
                    body: JSON.stringify({ booking_id: bookingId, payment_form: paymentForm }),
                  }).catch((e) => console.error("Error triggering booking CFDI (Openpay):", e))
                );
              }

              EdgeRuntime.waitUntil(
                fetch(`${supabaseUrl}/functions/v1/send-booking-confirmation`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
                  body: JSON.stringify({ booking_id: bookingId }),
                }).catch((e) => console.error("Error sending booking confirmation (Openpay):", e))
              );

              EdgeRuntime.waitUntil(
                fetch(`${supabaseUrl}/functions/v1/sync-booking-to-accounting`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
                  body: JSON.stringify({ booking_id: bookingId }),
                }).catch((e) => console.error("Error syncing booking to accounting (Openpay):", e))
              );
            } else {
              await supabase
                .from("bookings")
                .update({
                  user_payment: newUserPayment,
                  payment_provider: "openpay",
                  payment_status: "processing",
                })
                .eq("id", bookingId);

              console.log(`Booking ${bookingId} partial payment (Openpay) — paid: ${totalPaid}/${requiredAmount}`);
            }
          }

        } else if (chargeContext === "supplement" && chargeReferenceId) {
          // ── Idempotency check: skip if payment_transaction already succeeded ──
          const { data: existingPt } = await supabase
            .from("payment_transactions")
            .select("id, status")
            .eq("charge_context", "supplement")
            .eq("charge_reference_id", chargeReferenceId)
            .eq("payment_processor", "openpay")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (existingPt?.status === "succeeded") {
            console.log(`Supplement ${chargeReferenceId} payment_transaction already succeeded — idempotent skip`);
            if (webhookEventId) {
              await supabase.from("openpay_webhook_events").update({
                processing_status: "processed",
                processing_result: "Supplement payment already succeeded — idempotent skip",
                processed_at: new Date().toISOString(),
              }).eq("id", webhookEventId);
            }
            return new Response("OK", { status: 200, headers: corsHeaders });
          }

          await supabase
            .from("booking_supplements")
            .update({ status: "paid", paid_at: new Date().toISOString() })
            .eq("id", chargeReferenceId);

          await supabase
            .from("payment_transactions")
            .update({
              status: "succeeded",
              processor_fee: processorFee,
              processor_fee_base: feeBase,
              processor_fee_iva: feeIva,
              net_amount: chargeAmount - processorFee,
              openpay_charge_id: transaction.id,
            })
            .eq("charge_context", "supplement")
            .eq("charge_reference_id", chargeReferenceId)
            .eq("payment_processor", "openpay");

          const cfdiSettingsRes2 = await supabase
            .from("platform_settings")
            .select("pac_provider")
            .maybeSingle();
          const cfdiSecretsRes2 = await supabase
            .from("platform_secrets")
            .select("pac_api_key_encrypted")
            .maybeSingle();
          const cfdiSettings = { pac_provider: cfdiSettingsRes2?.data?.pac_provider, pac_api_key_encrypted: cfdiSecretsRes2?.data?.pac_api_key_encrypted };

          if (cfdiSettings?.pac_provider && cfdiSettings.pac_provider !== "none") {
            EdgeRuntime.waitUntil(
              fetch(`${supabaseUrl}/functions/v1/generate-supplement-cfdi`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
                body: JSON.stringify({ booking_supplement_id: chargeReferenceId, payment_form: paymentForm }),
              }).catch((e) => console.error("Error triggering supplement CFDI (Openpay):", e))
            );
          }

          // Accounting entry for supplement (fire and forget)
          supabase.rpc("create_accounting_entry_for_supplement", { p_supplement_id: chargeReferenceId })
            .catch((e) => console.error("Error creating supplement accounting entry (Openpay):", e));

        } else if (chargeContext === "gift_card" && chargeReferenceId) {
          // ── Idempotency check: skip if payment_transaction already succeeded ──
          const { data: existingPt } = await supabase
            .from("payment_transactions")
            .select("id, status")
            .eq("charge_context", "gift_card")
            .eq("charge_reference_id", chargeReferenceId)
            .eq("payment_processor", "openpay")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (existingPt?.status === "succeeded") {
            console.log(`Gift card ${chargeReferenceId} payment_transaction already succeeded — idempotent skip`);
            if (webhookEventId) {
              await supabase.from("openpay_webhook_events").update({
                processing_status: "processed",
                processing_result: "Gift card payment already succeeded — idempotent skip",
                processed_at: new Date().toISOString(),
              }).eq("id", webhookEventId);
            }
            return new Response("OK", { status: 200, headers: corsHeaders });
          }

          await supabase
            .from("gift_cards")
            .update({
              status: "active",
              payment_status: "paid",
              payment_provider: "openpay",
              purchased_at: new Date().toISOString(),
            })
            .eq("id", chargeReferenceId);

          // Mark payment_transaction as succeeded
          await supabase
            .from("payment_transactions")
            .update({
              status: "succeeded",
              processor_fee: processorFee,
              processor_fee_base: feeBase,
              processor_fee_iva: feeIva,
              net_amount: chargeAmount - processorFee,
              openpay_charge_id: transaction.id,
            })
            .eq("charge_context", "gift_card")
            .eq("charge_reference_id", chargeReferenceId)
            .eq("payment_processor", "openpay");

          EdgeRuntime.waitUntil(
            fetch(`${supabaseUrl}/functions/v1/send-gift-card-email`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
              body: JSON.stringify({ giftCardId: chargeReferenceId }),
            }).catch((e) => console.error("Error sending gift card email (Openpay):", e))
          );

          // Accounting entry for gift card sale (fire and forget)
          supabase.rpc("create_accounting_entry_for_gift_card_sale", { p_gift_card_id: chargeReferenceId })
            .catch((e) => console.error("Error creating gift card accounting entry (Openpay):", e));

        } else if (chargeContext === "insurance" && chargeReferenceId) {
          const extraSubtotal = parseFloat(transaction.metadata?.extra_subtotal || String(chargeAmount));
          await supabase.from("bookings").update({
            travel_insurance_included: true,
            travel_insurance_cost: extraSubtotal,
            updated_at: new Date().toISOString(),
          }).eq("id", chargeReferenceId);

          await supabase.from("payment_transactions").update({
            status: "succeeded", processor_fee: processorFee, processor_fee_base: feeBase,
            processor_fee_iva: feeIva, net_amount: chargeAmount - processorFee, openpay_charge_id: transaction.id,
          }).eq("charge_context", "insurance").eq("charge_reference_id", chargeReferenceId).eq("payment_processor", "openpay");

          await awardExtraPointsOpenpay(supabase, chargeReferenceId, extraSubtotal, chargeReferenceId, "insurance_payment", "Puntos por seguro (Openpay)");

          const cfdiSettingsInsRes = await supabase.from("platform_settings").select("pac_provider").maybeSingle();
          const cfdiSecretsInsRes = await supabase.from("platform_secrets").select("pac_api_key_encrypted").maybeSingle();
          const cfdiSettingsIns = { pac_provider: cfdiSettingsInsRes?.data?.pac_provider, pac_api_key_encrypted: cfdiSecretsInsRes?.data?.pac_api_key_encrypted };
          if (cfdiSettingsIns?.pac_provider && cfdiSettingsIns.pac_provider !== "none") {
            EdgeRuntime.waitUntil(
              fetch(`${supabaseUrl}/functions/v1/generate-post-booking-insurance-cfdi`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
                body: JSON.stringify({ booking_id: chargeReferenceId, payment_form: paymentForm }),
              }).catch((e) => console.error("Error triggering insurance CFDI (Openpay):", e))
            );
          }

          // Accounting entry for insurance purchase (fire and forget)
          supabase.rpc("create_accounting_entry_for_insurance_purchase", { p_booking_id: chargeReferenceId })
            .catch((e) => console.error("Error creating insurance accounting entry (Openpay):", e));

        } else if (chargeContext === "optional_service" && chargeReferenceId) {
          const { data: bosRowOp } = await supabase.from("booking_optional_services").select("subtotal, booking_id").eq("id", chargeReferenceId).maybeSingle();
          const extraSubtotalOs = Number(bosRowOp?.subtotal) || parseFloat(transaction.metadata?.extra_subtotal || String(chargeAmount));

          await supabase.from("booking_optional_services").update({
            paid_at: new Date().toISOString(), payment_method: "openpay", updated_at: new Date().toISOString(),
          }).eq("id", chargeReferenceId);

          await supabase.from("payment_transactions").update({
            status: "succeeded", processor_fee: processorFee, processor_fee_base: feeBase,
            processor_fee_iva: feeIva, net_amount: chargeAmount - processorFee, openpay_charge_id: transaction.id,
          }).eq("charge_context", "optional_service").eq("charge_reference_id", chargeReferenceId).eq("payment_processor", "openpay");

          if (bosRowOp?.booking_id) {
            await awardExtraPointsOpenpay(supabase, bosRowOp.booking_id, extraSubtotalOs, chargeReferenceId, "optional_service_payment", "Puntos por extra: servicio opcional (Openpay)");
          }

          const cfdiSettingsOsRes = await supabase.from("platform_settings").select("pac_provider").maybeSingle();
          const cfdiSecretsOsRes = await supabase.from("platform_secrets").select("pac_api_key_encrypted").maybeSingle();
          const cfdiSettingsOs = { pac_provider: cfdiSettingsOsRes?.data?.pac_provider, pac_api_key_encrypted: cfdiSecretsOsRes?.data?.pac_api_key_encrypted };
          if (cfdiSettingsOs?.pac_provider && cfdiSettingsOs.pac_provider !== "none") {
            EdgeRuntime.waitUntil(
              fetch(`${supabaseUrl}/functions/v1/generate-optional-service-cfdi`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
                body: JSON.stringify({ booking_optional_service_id: chargeReferenceId, payment_form: paymentForm }),
              }).catch((e) => console.error("Error triggering optional service CFDI (Openpay):", e))
            );
          }

          // Accounting entry for optional service (fire and forget)
          supabase.rpc("create_accounting_entry_for_optional_service", { p_bos_id: chargeReferenceId })
            .catch((e) => console.error("Error creating optional service accounting entry (Openpay):", e));

        } else if (chargeContext === "payment_plan_installment" && chargeReferenceId) {
          const planId = chargeReferenceId;

          const { data: planRow } = await supabase.from("booking_payment_plans").select("booking_id").eq("id", planId).maybeSingle();
          let planUserId: string | null = null;
          if (planRow) {
            const { data: bookingRow } = await supabase.from("bookings").select("user_id").eq("id", planRow.booking_id).maybeSingle();
            planUserId = bookingRow?.user_id || null;
          }

          const metaEffectiveAmount = transaction.metadata?.effective_amount;
          const metaNetServiceCharge = transaction.metadata?.net_service_charge;
          const metaGrossServiceCharge = transaction.metadata?.gross_service_charge;
          const metaExemptionApplied = transaction.metadata?.membership_exemption_applied === "true";

          const effectiveAmountPp = metaEffectiveAmount != null ? parseFloat(metaEffectiveAmount) : chargeAmount;
          const serviceChargePp = metaNetServiceCharge != null ? parseFloat(metaNetServiceCharge) : 0;
          const grossServiceChargePp = metaGrossServiceCharge != null ? parseFloat(metaGrossServiceCharge) : 0;
          const membershipExemptionUsedPp = metaEffectiveAmount != null ? metaExemptionApplied : false;

          const { error: allocError } = await supabase.rpc("allocate_payment_plan_installment", {
            p_plan_id: planId, p_amount: effectiveAmountPp, p_provider: "openpay",
            p_service_charge: serviceChargePp, p_gross_service_charge: grossServiceChargePp,
            p_provider_transaction_id: transaction.id, p_user_id: planUserId,
            p_membership_exemption_used: membershipExemptionUsedPp, p_is_wallet_payment: false,
          });

          if (allocError) {
            console.error(`Error allocating payment plan installment (Openpay) for plan ${planId}:`, allocError.message);
          }

          await supabase.from("payment_transactions").update({
            status: "succeeded", processor_fee: processorFee, processor_fee_base: feeBase,
            processor_fee_iva: feeIva, net_amount: chargeAmount - processorFee, openpay_charge_id: transaction.id,
          }).eq("charge_context", "payment_plan_installment").eq("charge_reference_id", planId).eq("payment_processor", "openpay");

          // Accounting entry for payment plan installment (fire and forget)
          const { data: planTxRecord } = await supabase.from("booking_payment_plan_transactions")
            .select("id").eq("plan_id", planId).eq("payment_provider", "openpay")
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
          if (planTxRecord?.id) {
            supabase.rpc("create_accounting_entry_for_payment_plan_installment", { p_installment_tx_id: planTxRecord.id })
              .catch((e) => console.error("Error creating payment plan installment accounting entry (Openpay):", e));
          }

        } else if (chargeContext === "featured_slot" && chargeReferenceId) {
          const { data: slotOp } = await supabase.from("featured_tour_slots").select("id, pending_payment_metadata").eq("id", chargeReferenceId).maybeSingle();

          if (slotOp) {
            const { error: confirmErrOp } = await supabase.rpc("confirm_featured_slot_payment", {
              p_slot_id: slotOp.id, p_payment_id: transaction.id, p_payment_provider: "openpay", p_total: chargeAmount,
            });

            if (confirmErrOp) {
              console.error(`Error confirming featured slot ${slotOp.id} (Openpay):`, confirmErrOp.message);
            } else {
              const existingMeta = (slotOp.pending_payment_metadata as Record<string, any>) || {};
              await supabase.from("featured_tour_slots").update({
                pending_payment_metadata: { ...existingMeta, openpay_status: "completed" },
              }).eq("id", slotOp.id);

              EdgeRuntime.waitUntil(
                fetch(`${supabaseUrl}/functions/v1/generate-featured-slot-cfdi`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
                  body: JSON.stringify({ slot_id: slotOp.id }),
                }).catch((e) => console.error("Error triggering featured slot CFDI (Openpay):", e))
              );
            }
          }

        }

        if (webhookEventId) {
          await supabase.from("openpay_webhook_events").update({
            processing_status: "processed",
            processing_result: `Charge ${chargeContext} ${chargeReferenceId} confirmed: ${chargeAmount} MXN`,
            processed_at: new Date().toISOString(),
          }).eq("id", webhookEventId);
        }
        return new Response("OK", { status: 200, headers: corsHeaders });
      }

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
    if (sentryDsn) {
      Sentry.captureException(err, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
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

async function awardExtraPointsOpenpay(supabase: any, bookingId: string, subtotal: number, referenceId: string, referenceType: string, description: string) {
  try {
    const { data: booking } = await supabase.from("bookings").select("user_id").eq("id", bookingId).maybeSingle();
    if (!booking?.user_id || subtotal <= 0) return;
    const { data: activeMembership } = await supabase.from("memberships").select("id")
      .eq("user_id", booking.user_id).eq("status", "active").gt("current_period_end", new Date().toISOString()).maybeSingle();
    if (!activeMembership) return;
    const pointsEarned = Math.floor(subtotal);
    if (pointsEarned <= 0) return;
    const { data: walletId } = await supabase.rpc("get_or_create_points_wallet", { p_user_id: booking.user_id });
    if (!walletId) return;
    const { data: pWallet } = await supabase.from("toursred_points_wallets").select("id, balance, total_earned").eq("id", walletId).maybeSingle();
    if (!pWallet) return;
    const newBalance = pWallet.balance + pointsEarned;
    await supabase.from("toursred_points_transactions").insert({
      wallet_id: walletId, user_id: booking.user_id, amount: pointsEarned, balance_after: newBalance,
      type: "earned", description, reference_id: referenceId, reference_type: referenceType,
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await supabase.from("toursred_points_wallets").update({ balance: newBalance, total_earned: pWallet.total_earned + pointsEarned }).eq("id", walletId);
  } catch (e) { console.error("Error awarding extra points (Openpay):", e); }
}
