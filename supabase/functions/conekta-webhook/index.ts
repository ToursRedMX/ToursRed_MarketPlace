import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function verifyConektaSignature(
  rawBody: string,
  signatureHeader: string | null,
  signingKey: string
): Promise<boolean> {
  if (!signingKey) return false;
  if (!signatureHeader) return false;

  // Conekta sends a hex HMAC-SHA256 signature in the conekta-signature header
  const encoder = new TextEncoder();
  const keyData = encoder.encode(signingKey);
  const messageData = encoder.encode(rawBody);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  const hashArray = Array.from(new Uint8Array(signature));
  const computed = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  return computed === signatureHeader;
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

    const signingKey = Deno.env.get("CONEKTA_WEBHOOK_SIGNING_KEY");
    const signatureHeader = req.headers.get("conekta-signature") || req.headers.get("x-conekta-signature");

    if (signingKey) {
      const isValid = await verifyConektaSignature(rawBody, signatureHeader, signingKey);
      if (!isValid) {
        console.error("Invalid Conekta webhook signature");
        return jsonResponse({ error: "Invalid signature" }, 401);
      }
    } else {
      console.warn("CONEKTA_WEBHOOK_SIGNING_KEY not configured, skipping signature validation");
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
      console.error(`No payment_transaction found for Conekta order ${orderId}`);
      return jsonResponse({ received: true });
    }

    // Idempotency: check if this event was already processed
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
          "Accept": "application/vnd.conekta-v2.0+json",
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

    // ─── order.paid ──────────────────────────────────────────────
    if (eventType === "order.paid" || orderStatus === "paid") {
      // Mark the transaction as succeeded
      await supabase
        .from("payment_transactions")
        .update({
          status: "succeeded",
          updated_at: new Date().toISOString(),
        })
        .eq("id", tx.id);

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
          .select("deposit_amount, total_price, user_payment, payment_status, status")
          .eq("id", bookingId)
          .maybeSingle();

        if (booking) {
          const requiredAmount = Number(booking.deposit_amount) || Number(booking.total_price) || 0;
          const newUserPayment = Number(booking.user_payment || 0) + Number(tx.amount);

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
                .select("pac_provider, pac_api_key_encrypted")
                .maybeSingle();

              if (cfdiSettings?.pac_provider && cfdiSettings.pac_provider !== "none" && cfdiSettings.pac_api_key_encrypted) {
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

        // Trigger supplement CFDI
        try {
          const { data: cfdiSettings } = await supabase
            .from("platform_settings")
            .select("pac_provider, pac_api_key_encrypted")
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
      } else if (chargeContext === "insurance" && chargeReferenceId) {
        await supabase
          .from("bookings")
          .update({ travel_insurance_status: "paid" })
          .eq("id", bookingId);

        try {
          const { data: cfdiSettings } = await supabase
            .from("platform_settings")
            .select("pac_provider, pac_api_key_encrypted")
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
      } else if (chargeContext === "optional_service" && chargeReferenceId) {
        await supabase
          .from("booking_optional_services")
          .update({
            payment_status: "paid",
            updated_at: new Date().toISOString(),
          })
          .eq("id", chargeReferenceId);

        try {
          const { data: cfdiSettings } = await supabase
            .from("platform_settings")
            .select("pac_provider, pac_api_key_encrypted")
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
      } else if (chargeContext === "payment_plan_installment" && chargeReferenceId) {
        await supabase
          .from("booking_payment_plan_installments")
          .update({
            status: "completed",
            paid_at: new Date().toISOString(),
          })
          .eq("id", chargeReferenceId);

        try {
          const { data: cfdiSettings } = await supabase
            .from("platform_settings")
            .select("pac_provider, pac_api_key_encrypted")
            .maybeSingle();

          if (cfdiSettings?.pac_provider && cfdiSettings.pac_provider !== "none") {
            const paymentForm = getPaymentFormForConekta(paymentMethodType, conektaOrder);
            EdgeRuntime.waitUntil(
              fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-booking-installment-cfdi`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                },
                body: JSON.stringify({
                  installment_id: chargeReferenceId,
                  payment_form: paymentForm,
                }),
              }).catch((e) => console.error("Error triggering installment CFDI:", e))
            );
          }
        } catch (cfdiErr) {
          console.error("Error triggering installment CFDI:", cfdiErr);
        }
      }
    }

    // ─── order.expired ───────────────────────────────────────────
    if (eventType === "order.expired" || orderStatus === "expired") {
      await supabase
        .from("payment_transactions")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", tx.id);

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

    // ─── order.declined ──────────────────────────────────────────
    if (eventType === "order.declined" || orderStatus === "declined") {
      await supabase
        .from("payment_transactions")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", tx.id);

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
