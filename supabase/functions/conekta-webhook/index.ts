import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as Sentry from "npm:@sentry/deno@9";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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

function pemToArrayBuffer(pem: string): ArrayBuffer {
  // Strip PEM headers/footers and whitespace, decode base64 to ArrayBuffer
  const b64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/-----BEGIN RSA PUBLIC KEY-----/g, "")
    .replace(/-----END RSA PUBLIC KEY-----/g, "")
    .replace(/\s/g, "");
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

async function verifyConektaSignature(
  rawBody: string,
  digestHeader: string | null,
  signingKeyPem: string
): Promise<boolean> {
  if (!signingKeyPem) return false;
  if (!digestHeader) return false;

  try {
    // Decode the base64 signature from the digest header
    const signatureB64 = digestHeader.replace(/\s/g, "");
    const sigBinary = atob(signatureB64);
    const signatureBytes = new Uint8Array(sigBinary.length);
    for (let i = 0; i < sigBinary.length; i++) {
      signatureBytes[i] = sigBinary.charCodeAt(i);
    }

    // Import the RSA public key (PEM format → SPKI ArrayBuffer)
    const keyBuffer = pemToArrayBuffer(signingKeyPem);
    const publicKey = await crypto.subtle.importKey(
      "spki",
      keyBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );

    // Verify the signature against the raw request body (UTF-8)
    const rawBodyBytes = new TextEncoder().encode(rawBody);
    const isValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      signatureBytes,
      rawBodyBytes
    );

    return isValid;
  } catch (err) {
    console.error("Error verifying Conekta RSA signature:", err);
    return false;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const rawBody = await req.text();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    // Conekta uses RSA-SHA256 signing (not HMAC). The public key is not secret — it's
    // designed to be shared. We embed it directly so verification works even if the
    // CONEKTA_WEBHOOK_SIGNING_KEY env var is missing or holds a stale HMAC value.
    const CONEKTA_WEBHOOK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAlcnbdNdXlwl8CE5peF4Y
+MX1JgwQx8q1GLkXB5FyAGzhMC+BKpx39WC+5u4eg11XeBKHo/gP/VxPZLFYGYjK
H53USd5UYP178z2gHTZVMjIUHGvwf8sCAqICOCOWfivMuReqhnHHaae7whW2vDm0
ZSj55evrN3zzdlh0Usx/1xgdbLZlgyaHTe63wCPDKuLb9L90tv0lcpyWkgI/TAq7
Cry7hm9NuMeo95Vm5fqBtsQum9AwT9I8Qk0uVUvA9cgeNrdaUXAgHHhk0YwkbOQk
zYCOsxIEAZSRKUhId1xG67KNn0m1ZvOCC7ftNEC6xy7CItO3FWF3ZbAZx0PfUZAd
FwIDAQAB
-----END PUBLIC KEY-----`;

    const signingKey = Deno.env.get("CONEKTA_WEBHOOK_SIGNING_KEY") || CONEKTA_WEBHOOK_PUBLIC_KEY;
    // Conekta sends the RSA-SHA256 signature (base64) in the digest header
    const digestHeader = req.headers.get("digest");

    const isValid = await verifyConektaSignature(rawBody, digestHeader, signingKey);
    if (!isValid) {
      console.error("Invalid Conekta webhook signature");
      return jsonResponse({ error: "Invalid signature" }, 401);
    }

    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const eventType: string = body.type || body.event_type || "";
    const eventData = body.data?.object || body.data || {};
    const eventId: string = body.id || body.event_id || "";
    const orderId: string = eventData.id || body.data?.id || "";

    console.log(`Conekta webhook: type=${eventType}, order=${orderId}, event=${eventId}`);

    if (!orderId) {
      console.log("No order ID in webhook, ignoring");
      return jsonResponse({ received: true });
    }

    // Find the payment_transaction for this Conekta order
    const { data: tx, error: txErr } = await supabase
      .from("payment_transactions")
      .select("*")
      .eq("conekta_order_id", orderId)
      .maybeSingle();

    if (txErr || !tx) {
      // Fallback: los tours destacados no tienen payment_transactions (booking_id es NOT NULL
      // y featured slots no están ligados a una reserva). Se rastrean vía featured_tour_slots.payment_id.
      const { data: slot } = await supabase
        .from("featured_tour_slots")
        .select("id, status")
        .eq("payment_id", orderId)
        .eq("payment_provider", "conekta")
        .maybeSingle();

      if (slot && eventType === "order.paid") {
        const conektaApiBaseFs = Deno.env.get("CONEKTA_API_BASE") || "https://api.conekta.io";
        const conektaPrivateKeyFs = Deno.env.get("CONEKTA_PRIVATE_KEY");
        let conektaOrderFs: any = null;
        if (conektaPrivateKeyFs) {
          const orderRespFs = await fetch(`${conektaApiBaseFs}/orders/${orderId}`, {
            headers: { "Accept": "application/vnd.conekta-v2.2.0+json", "Authorization": `Bearer ${conektaPrivateKeyFs}` },
          });
          if (orderRespFs.ok) conektaOrderFs = await orderRespFs.json();
        }
        const totalPaidFs = (conektaOrderFs?.amount ?? 0) / 100;

        const { error: confirmErr } = await supabase.rpc("confirm_featured_slot_payment", {
          p_slot_id: slot.id,
          p_payment_id: orderId,
          p_payment_provider: "conekta",
          p_total: totalPaidFs,
        });

        if (confirmErr) {
          console.error(`Error confirming featured slot ${slot.id}:`, confirmErr.message);
        } else {
          EdgeRuntime.waitUntil(
            fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-featured-slot-cfdi`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
              body: JSON.stringify({ slot_id: slot.id }),
            }).catch((e) => console.error("Error triggering featured slot CFDI:", e))
          );
        }
        return jsonResponse({ received: true });
      }

      console.error(`No payment_transaction found for Conekta order ${orderId}`);
      return jsonResponse({ received: true });
    }

    // Fast-path idempotency check: skip if we definitely already processed this event.
    // The real atomic gate is the conditional status UPDATE below (per event type) —
    // this SELECT-based check only avoids redundant Conekta API calls for known duplicates.
    const processedEvents = (tx.metadata?.processed_webhook_events as string[]) || [];
    if (eventId && processedEvents.includes(eventId)) {
      console.log(`Event ${eventId} already processed for order ${orderId}, skipping`);
      return jsonResponse({ received: true });
    }

    // Fetch the full order from Conekta API to get authoritative state
    const conektaPrivateKey = Deno.env.get("CONEKTA_PRIVATE_KEY");
    const conektaApiBase = Deno.env.get("CONEKTA_API_BASE") || "https://api.conekta.io";

    let conektaOrder: any = null;
    if (conektaPrivateKey) {
      const orderResp = await fetch(`${conektaApiBase}/orders/${orderId}`, {
        headers: {
          "Accept": "application/vnd.conekta-v2.2.0+json",
          "Authorization": `Bearer ${conektaPrivateKey}`,
        },
      });
      if (orderResp.ok) {
        conektaOrder = await orderResp.json();
      }
    }

    const orderStatus: string = conektaOrder?.payment_status || eventData.payment_status || "";
    const bookingId: string = tx.booking_id;
    const paymentMethodType: string = tx.payment_method_type || "";
    const chargeContext: string = tx.charge_context || "booking_deposit";
    const chargeReferenceId: string | null = tx.charge_reference_id;

    // ─── order.paid ─────────────────────────────────────────────────
    // Only confirm on the actual order.paid event, not on orderStatus fallback —
    // Conekta sends order.created, order.pending_payment, and order.paid in rapid
    // succession, and querying the live order status may already return "paid" by
    // the time earlier events are processed, causing duplicate confirmations.
    if (eventType === "order.paid") {
      // Atomic idempotency gate: only transition to "succeeded" if not already succeeded.
      // If 0 rows updated, another concurrent execution already claimed this event —
      // skip all downstream logic (booking confirmation, CFDI, email) to avoid duplication.
      const { data: claimed, error: claimErr } = await supabase
        .from("payment_transactions")
        .update({
          status: "succeeded",
          updated_at: new Date().toISOString(),
        })
        .eq("id", tx.id)
        .neq("status", "succeeded")
        .select("id");

      if (claimErr || !claimed || claimed.length === 0) {
        console.log(`Transaction ${tx.id} already succeeded (race won by another execution), skipping`);
        return jsonResponse({ received: true });
      }

      // Capture the real Conekta fee from the paid charge (fee is in centavos)
      if (conektaOrder) {
        const charge = conektaOrder.charges?.data?.[0] || conektaOrder.charges?.[0];
        const feeCentavos = charge?.fee;
        if (feeCentavos != null) {
          const conektaFee = Number(feeCentavos) / 100;
          const txAmount = Number(tx.amount) || 0;
          await supabase
            .from("payment_transactions")
            .update({
              processor_fee: conektaFee,
              net_amount: txAmount - conektaFee,
            })
            .eq("id", tx.id);
        }
      }

      // Sync the real BNPL product_type from the paid order (Conekta's Hosted Checkout
      // lets the user pick the financier there, so we don't know it until the order is paid)
      if (paymentMethodType === "bnpl" && conektaOrder) {
        const realProductType =
          conektaOrder.charges?.data?.[0]?.payment_method?.product_type ||
          conektaOrder.charges?.[0]?.payment_method?.product_type ||
          null;

        if (realProductType) {
          await supabase
            .from("payment_transactions")
            .update({ bnpl_product_type: realProductType })
            .eq("id", tx.id);

          if (bookingId) {
            await supabase
              .from("bookings")
              .update({ bnpl_product_type: realProductType })
              .eq("id", bookingId);
          }
        }
      }

      // Update sub-charge records if this was a split order
      if (conektaOrder?.charges?.data && Array.isArray(conektaOrder.charges.data)) {
        for (const charge of conektaOrder.charges.data) {
          if (charge.payment_method?.type) {
            const chargeMethod = charge.payment_method.type === "card" ? "card"
              : charge.payment_method.type === "cash" ? "cash"
              : charge.payment_method.type === "spei" ? "spei"
              : charge.payment_method.type;

            await supabase
              .from("payment_transaction_charges")
              .update({
                conekta_charge_id: charge.id,
                status: charge.status === "paid" ? "paid" : "pending",
                paid_at: charge.paid_at ? new Date(charge.paid_at * 1000).toISOString() : new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("payment_transaction_id", tx.id)
              .eq("payment_method_type", chargeMethod);
          }
        }
      } else if (conektaOrder?.charges && Array.isArray(conektaOrder.charges)) {
        for (const charge of conektaOrder.charges) {
          if (charge.payment_method?.type) {
            const chargeMethod = charge.payment_method.type === "card" ? "card"
              : charge.payment_method.type === "cash" ? "cash"
              : charge.payment_method.type === "spei" ? "spei"
              : charge.payment_method.type;

            await supabase
              .from("payment_transaction_charges")
              .update({
                conekta_charge_id: charge.id,
                status: charge.status === "paid" ? "paid" : "pending",
                paid_at: charge.paid_at ? new Date(charge.paid_at * 1000).toISOString() : new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("payment_transaction_id", tx.id)
              .eq("payment_method_type", chargeMethod);
          }
        }
      }

      // Confirm the booking if this is a booking_deposit context
      if (chargeContext === "booking_deposit") {
        // Check if the full required amount has been paid (incremental payment support)
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
          const newUserPayment = Math.max(0, Number(booking.user_payment || 0) - Number(tx.amount));

          if (totalPaid >= requiredAmount) {
            // Full deposit paid — confirm the booking
            await supabase
              .from("bookings")
              .update({
                payment_status: "succeeded",
                payment_provider: "conekta",
                user_payment: newUserPayment,
                paid_at: new Date().toISOString(),
                status: "confirmed",
              })
              .eq("id", bookingId);

            console.log(`Booking ${bookingId} confirmed — total paid: ${totalPaid}/${requiredAmount}`);

            // Send confirmation email (idempotent — checks confirmation_email_sent flag)
            try {
              const { data: bookingCheck } = await supabase
                .from("bookings")
                .select("confirmation_email_sent")
                .eq("id", bookingId)
                .maybeSingle();

              if (!bookingCheck?.confirmation_email_sent) {
                await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-booking-confirmation`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                  },
                  body: JSON.stringify({ booking_id: bookingId }),
                }).catch((e) => console.error("Error sending confirmation email:", e));
              }
            } catch (emailErr) {
              console.error("Error triggering confirmation email:", emailErr);
            }

            // Trigger CFDI generation
            try {
              const { data: cfdiSettings } = await supabase
                .from("platform_settings")
                .select("pac_provider")
                .maybeSingle();

              const { data: secrets } = await supabase
                .from("platform_secrets")
                .select("pac_api_key_encrypted")
                .maybeSingle();

              if (cfdiSettings?.pac_provider && cfdiSettings.pac_provider !== "none" && secrets?.pac_api_key_encrypted) {
                // Determine payment_form based on payment_method_type
                const paymentForm = getPaymentFormForConekta(paymentMethodType, conektaOrder);

                EdgeRuntime.waitUntil(
                  fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-booking-cfdi`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                    },
                    body: JSON.stringify({
                      booking_id: bookingId,
                      payment_form: paymentForm,
                    }),
                  }).catch((e) => console.error("Error triggering CFDI:", e))
                );
              }
            } catch (cfdiErr) {
              console.error("Error triggering CFDI generation:", cfdiErr);
            }

            // Sync booking to accounting (fire and forget)
            EdgeRuntime.waitUntil(
              fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-booking-to-accounting`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
                body: JSON.stringify({ booking_id: bookingId }),
              }).catch((e) => console.error("Error syncing booking to accounting (Conekta):", e))
            );
          } else {
            // Partial payment — update user_payment but keep booking pending
            await supabase
              .from("bookings")
              .update({
                user_payment: newUserPayment,
                payment_provider: "conekta",
                payment_status: "processing",
                status: booking.status === "payment_pending_bnpl" ? "pending" : booking.status,
              })
              .eq("id", bookingId);

            console.log(`Booking ${bookingId} partial payment — paid: ${totalPaid}/${requiredAmount}`);
          }
        }
      } else if (chargeContext === "supplement" && chargeReferenceId) {
        await supabase
          .from("booking_supplements")
          .update({
            status: "paid",
            payment_provider: "conekta",
            paid_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", chargeReferenceId);

        const { data: suppRow } = await supabase
          .from("booking_supplements")
          .select("unit_price, quantity")
          .eq("id", chargeReferenceId)
          .maybeSingle();
        const suppSubtotal = suppRow ? Number(suppRow.unit_price) * Number(suppRow.quantity) : 0;
        await awardExtraPoints(supabase, bookingId, suppSubtotal, chargeReferenceId, "supplement", `Puntos por suplemento (Conekta)`);

        // Trigger supplement CFDI
        try {
          const { data: cfdiSettings } = await supabase
            .from("platform_settings")
            .select("pac_provider")
            .maybeSingle();

          if (cfdiSettings?.pac_provider && cfdiSettings.pac_provider !== "none") {
            const paymentForm = getPaymentFormForConekta(paymentMethodType, conektaOrder);
            EdgeRuntime.waitUntil(
              fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-supplement-cfdi`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                },
                body: JSON.stringify({
                  booking_supplement_id: chargeReferenceId,
                  payment_form: paymentForm,
                }),
              }).catch((e) => console.error("Error triggering supplement CFDI:", e))
            );
          }
        } catch (cfdiErr) {
          console.error("Error triggering supplement CFDI:", cfdiErr);
        }

        // Accounting entry for supplement (fire and forget)
        supabase.rpc("create_accounting_entry_for_supplement", { p_supplement_id: chargeReferenceId })
          .catch((e) => console.error("Error creating supplement accounting entry (Conekta):", e));
      } else if (chargeContext === "insurance" && chargeReferenceId) {
        const extraSubtotal = parseFloat(conektaOrder?.metadata?.extra_subtotal || String(tx.amount));
        const insuranceDaysMeta = conektaOrder?.metadata?.insurance_days ? Number(conektaOrder.metadata.insurance_days) : null;

        const insuranceUpdate: Record<string, unknown> = {
          travel_insurance_included: true,
          travel_insurance_cost: extraSubtotal,
          updated_at: new Date().toISOString(),
        };
        if (insuranceDaysMeta) insuranceUpdate.insurance_days = insuranceDaysMeta;

        const { error: insuranceUpdateErr } = await supabase.from("bookings").update(insuranceUpdate).eq("id", bookingId);
        if (insuranceUpdateErr) console.error(`Error activando seguro para booking ${bookingId}:`, insuranceUpdateErr.message);

        await awardExtraPoints(supabase, bookingId, extraSubtotal, chargeReferenceId, "insurance_payment", `Puntos por seguro (Conekta)`);

        try {
          const { data: cfdiSettings } = await supabase
            .from("platform_settings")
            .select("pac_provider")
            .maybeSingle();

          if (cfdiSettings?.pac_provider && cfdiSettings.pac_provider !== "none") {
            const paymentForm = getPaymentFormForConekta(paymentMethodType, conektaOrder);
            EdgeRuntime.waitUntil(
              fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-post-booking-insurance-cfdi`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                },
                body: JSON.stringify({
                  booking_id: bookingId,
                  payment_form: paymentForm,
                }),
              }).catch((e) => console.error("Error triggering insurance CFDI:", e))
            );
          }
        } catch (cfdiErr) {
          console.error("Error triggering insurance CFDI:", cfdiErr);
        }

        // Accounting entry for insurance purchase (fire and forget)
        supabase.rpc("create_accounting_entry_for_insurance_purchase", { p_booking_id: bookingId })
          .catch((e) => console.error("Error creating insurance accounting entry (Conekta):", e));
      } else if (chargeContext === "optional_service" && chargeReferenceId) {
        const { data: bosRow } = await supabase.from("booking_optional_services").select("subtotal").eq("id", chargeReferenceId).maybeSingle();
        const extraSubtotal = Number(bosRow?.subtotal) || parseFloat(conektaOrder?.metadata?.extra_subtotal || String(tx.amount));

        const { error: optServiceUpdateErr } = await supabase.from("booking_optional_services").update({
          paid_at: new Date().toISOString(), payment_method: "conekta", updated_at: new Date().toISOString(),
        }).eq("id", chargeReferenceId);
        if (optServiceUpdateErr) console.error(`Error marcando optional_service ${chargeReferenceId} como pagado:`, optServiceUpdateErr.message);

        await awardExtraPoints(supabase, bookingId, extraSubtotal, chargeReferenceId, "optional_service_payment", `Puntos por extra: servicio opcional (Conekta)`);

        try {
          const { data: cfdiSettings } = await supabase
            .from("platform_settings")
            .select("pac_provider")
            .maybeSingle();

          if (cfdiSettings?.pac_provider && cfdiSettings.pac_provider !== "none") {
            const paymentForm = getPaymentFormForConekta(paymentMethodType, conektaOrder);
            EdgeRuntime.waitUntil(
              fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-optional-service-cfdi`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                },
                body: JSON.stringify({
                  booking_optional_service_id: chargeReferenceId,
                  payment_form: paymentForm,
                }),
              }).catch((e) => console.error("Error triggering optional service CFDI:", e))
            );
          }
        } catch (cfdiErr) {
          console.error("Error triggering optional service CFDI:", cfdiErr);
        }

        // Accounting entry for optional service (fire and forget)
        supabase.rpc("create_accounting_entry_for_optional_service", { p_bos_id: chargeReferenceId })
          .catch((e) => console.error("Error creating optional service accounting entry (Conekta):", e));
      } else if (chargeContext === "gift_card" && chargeReferenceId) {
        await supabase
          .from("gift_cards")
          .update({
            status: "active",
            payment_status: "paid",
            payment_provider: "conekta",
            purchased_at: new Date().toISOString(),
          })
          .eq("id", chargeReferenceId);

        EdgeRuntime.waitUntil(
          fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-gift-card-email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ giftCardId: chargeReferenceId }),
          }).catch((e) => console.error("Error sending gift card email:", e))
        );

        // Accounting entry for gift card sale (fire and forget)
        supabase.rpc("create_accounting_entry_for_gift_card_sale", { p_gift_card_id: chargeReferenceId })
          .catch((e) => console.error("Error creating gift card accounting entry (Conekta):", e));
      } else if (chargeContext === "payment_plan_installment" && chargeReferenceId) {
        // chargeReferenceId is the plan_id (set by process-payment-plan-installment)
        const planId = chargeReferenceId;

        // Look up the plan to get the booking's user_id
        const { data: planRow } = await supabase
          .from("booking_payment_plans")
          .select("booking_id")
          .eq("id", planId)
          .maybeSingle();

        let planUserId: string | null = null;
        if (planRow) {
          const { data: bookingRow } = await supabase
            .from("bookings")
            .select("user_id")
            .eq("id", planRow.booking_id)
            .maybeSingle();
          planUserId = bookingRow?.user_id || null;
        }

        // Look up the original payment to get effectiveAmount and service charge
        // The payment_transactions.amount is the total charged (effective + service charge)
        const txAmount = Number(tx.amount) || 0;
        const metaEffectiveAmount = conektaOrder?.metadata?.effective_amount;
        const metaNetServiceCharge = conektaOrder?.metadata?.net_service_charge;
        const metaGrossServiceCharge = conektaOrder?.metadata?.gross_service_charge;
        const metaExemptionApplied = conektaOrder?.metadata?.membership_exemption_applied === "true";

        const effectiveAmount = metaEffectiveAmount != null ? parseFloat(metaEffectiveAmount) : txAmount;
        const serviceCharge = metaNetServiceCharge != null ? parseFloat(metaNetServiceCharge) : 0;
        const grossServiceCharge = metaGrossServiceCharge != null ? parseFloat(metaGrossServiceCharge) : 0;
        const membershipExemptionUsed = metaEffectiveAmount != null ? metaExemptionApplied : false;

        // Call the shared SQL function — it handles idempotency, allocations, points, plan totals
        const { data: allocResult, error: allocError } = await supabase.rpc("allocate_payment_plan_installment", {
          p_plan_id: planId,
          p_amount: effectiveAmount,
          p_provider: "conekta",
          p_service_charge: serviceCharge,
          p_gross_service_charge: grossServiceCharge,
          p_provider_transaction_id: orderId,
          p_user_id: planUserId,
          p_membership_exemption_used: membershipExemptionUsed,
          p_is_wallet_payment: false,
        });

        if (allocError) {
          console.error(`Error allocating payment plan installment for plan ${planId}:`, allocError.message);
        } else if (allocResult && !allocResult.idempotent_skip) {
          // Trigger CFDI generation for each newly-paid installment
          try {
            const { data: cfdiSettings } = await supabase
              .from("platform_settings")
              .select("pac_provider")
              .maybeSingle();

            if (cfdiSettings?.pac_provider && cfdiSettings.pac_provider !== "none") {
              const paymentForm = getPaymentFormForConekta(paymentMethodType, conektaOrder);
              const returnedAllocations = (allocResult.allocations as any[]) || [];

              for (const alloc of returnedAllocations) {
                // Check if this installment is now fully paid
                const { data: paidInst } = await supabase
                  .from("booking_payment_plan_installments")
                  .select("status")
                  .eq("id", alloc.installment_id)
                  .maybeSingle();

                if (paidInst?.status === "paid") {
                  EdgeRuntime.waitUntil(
                    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-booking-installment-cfdi`, {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                      },
                      body: JSON.stringify({
                        installment_id: alloc.installment_id,
                        transaction_id: allocResult.transaction_id,
                        payment_form: paymentForm,
                      }),
                    }).catch((e) => console.error("Error triggering installment CFDI:", e))
                  );
                }
              }
            }
          } catch (cfdiErr) {
            console.error("Error triggering installment CFDI:", cfdiErr);
          }

          // Accounting entry for payment plan installment (fire and forget)
          if (allocResult?.transaction_id) {
            supabase.rpc("create_accounting_entry_for_payment_plan_installment", { p_installment_tx_id: allocResult.transaction_id })
              .catch((e) => console.error("Error creating payment plan installment accounting entry (Conekta):", e));
          }
        }
      }
    }

    // ─── order.expired ─────────────────────────────────────────
    if (eventType === "order.expired") {
      // Atomic gate: only transition to "failed" if not already in a final state.
      const { data: expiredClaim } = await supabase
        .from("payment_transactions")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", tx.id)
        .neq("status", "succeeded")
        .neq("status", "failed")
        .select("id");

      if (!expiredClaim || expiredClaim.length === 0) {
        console.log(`Transaction ${tx.id} already in final state, skipping expired handler`);
      } else {
        // If BNPL, release the payment_pending_bnpl status
        if (paymentMethodType === "bnpl" && chargeContext === "booking_deposit") {
          const { data: booking } = await supabase
            .from("bookings")
            .select("status, user_payment")
            .eq("id", bookingId)
            .maybeSingle();

          if (booking?.status === "payment_pending_bnpl") {
            // Only revert to pending if no other partial payments exist
            const { data: otherTx } = await supabase
              .from("payment_transactions")
              .select("amount, status")
              .eq("booking_id", bookingId)
              .eq("charge_context", "booking_deposit")
              .eq("status", "succeeded");

            const hasOtherPayments = (otherTx || []).length > 0;
            await supabase
              .from("bookings")
              .update({
                status: hasOtherPayments ? "pending" : "pending",
              })
              .eq("id", bookingId);
          }
        }

        console.log(`Conekta order ${orderId} expired for booking ${bookingId}`);
      }
    }

    // ─── order.declined ─────────────────────────────────────────────
    if (eventType === "order.declined") {
      // Atomic gate: only transition to "failed" if not already in a final state.
      const { data: declinedClaim } = await supabase
        .from("payment_transactions")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", tx.id)
        .neq("status", "succeeded")
        .neq("status", "failed")
        .select("id");

      if (!declinedClaim || declinedClaim.length === 0) {
        console.log(`Transaction ${tx.id} already in final state, skipping declined handler`);
      } else {
        // Same treatment as expired for BNPL
        if (paymentMethodType === "bnpl" && chargeContext === "booking_deposit") {
          const { data: booking } = await supabase
            .from("bookings")
            .select("status")
            .eq("id", bookingId)
            .maybeSingle();

          if (booking?.status === "payment_pending_bnpl") {
            await supabase
              .from("bookings")
              .update({ status: "pending" })
              .eq("id", bookingId);
          }
        }

        console.log(`Conekta order ${orderId} declined for booking ${bookingId}`);
      }
    }

    // Mark event as processed (idempotency)
    const updatedEvents = [...processedEvents, eventId].filter(Boolean);
    await supabase
      .from("payment_transactions")
      .update({
        metadata: {
          ...tx.metadata,
          processed_webhook_events: updatedEvents,
          last_webhook_event: eventType,
          last_webhook_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", tx.id);

    return jsonResponse({ received: true });
  } catch (err: any) {
    console.error("Error in conekta-webhook:", err);
    if (sentryDsn) {
      Sentry.captureException(err, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return jsonResponse({ error: err.message || "Internal server error" }, 500);
  }
});

// Determine the SAT Forma de Pago based on Conekta payment_method_type
function getPaymentFormForConekta(paymentMethodType: string, conektaOrder: any): string {
  if (paymentMethodType === "bnpl") {
    return "03"; // Transferencia electrónica de fondos
  }
  if (paymentMethodType === "spei") {
    return "03"; // Transferencia electrónica de fondos
  }
  if (paymentMethodType === "cash") {
    return "01"; // Efectivo
  }
  if (paymentMethodType === "card") {
    // Check if it's credit or debit card from Conekta charge data
    const charges = conektaOrder?.charges?.data || conektaOrder?.charges || [];
    if (Array.isArray(charges) && charges.length > 0) {
      const cardType = charges[0]?.payment_method?.type;
      // "credit" → 04 (Tarjeta de crédito), "debit" → 28 (Tarjeta de débito)
      if (cardType === "debit") return "28";
      return "04"; // Default to credit
    }
    return "04"; // Default to credit card
  }
  if (paymentMethodType === "split") {
    // For split orders, use the first charge's method — each charge gets its own CFDI
    const charges = conektaOrder?.charges?.data || conektaOrder?.charges || [];
    if (Array.isArray(charges) && charges.length > 0) {
      const firstChargeMethod = charges[0]?.payment_method?.type;
      if (firstChargeMethod === "card") return "04";
      if (firstChargeMethod === "cash") return "01";
      if (firstChargeMethod === "spei") return "03";
    }
    return "03"; // Fallback
  }
  return "03"; // Default fallback
}

async function awardExtraPoints(supabase: any, bookingId: string, subtotal: number, referenceId: string, referenceType: string, description: string) {
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
  } catch (e) { console.error("Error awarding extra points (Conekta):", e); }
}
