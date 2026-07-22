import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function verifyMercadoPagoSignature(
  req: Request,
  rawBody: string,
  secret: string
): Promise<boolean> {
  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");

  if (!xSignature) return false;

  const url = new URL(req.url);
  const dataId = url.searchParams.get("data.id") || url.searchParams.get("id");

  const parts = xSignature.split(",");
  let ts = "";
  let v1 = "";
  for (const part of parts) {
    const [key, value] = part.trim().split("=");
    if (key === "ts") ts = value;
    if (key === "v1") v1 = value;
  }

  if (!ts || !v1) return false;

  const manifest = [
    dataId ? `id:${dataId};` : "",
    xRequestId ? `request-id:${xRequestId};` : "",
    `ts:${ts};`,
  ].join("");

  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(manifest);

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

  return computed === v1;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const rawBody = await req.text();

    const webhookSecret = Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET");
    if (webhookSecret) {
      const isValid = await verifyMercadoPagoSignature(req, rawBody, webhookSecret);
      if (!isValid) {
        console.error("Invalid MercadoPago webhook signature");
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      console.warn("MERCADOPAGO_WEBHOOK_SECRET not configured, skipping signature validation");
    }

    let body: any = {};
    try {
      body = JSON.parse(rawBody);
    } catch {
      // body may be empty
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!mpAccessToken) {
      return new Response(JSON.stringify({ error: "MercadoPago no configurado" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const topic = url.searchParams.get("topic") || url.searchParams.get("type");
    const idParam = url.searchParams.get("id") || url.searchParams.get("data.id");

    const notificationId = idParam || body?.data?.id;
    const notificationType = topic || body?.type;
    const isLiveMode = body?.live_mode !== false;

    console.log("MercadoPago webhook received:", { notificationType, notificationId, isLiveMode });

    if (!notificationId || notificationType !== "payment") {
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!isLiveMode && (notificationId === "123456" || notificationId === 123456)) {
      console.log("Simulated test notification received, skipping payment lookup");
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const paymentResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/${notificationId}`,
      {
        headers: { Authorization: `Bearer ${mpAccessToken}` },
      }
    );

    if (!paymentResponse.ok) {
      console.error("Failed to fetch MP payment:", notificationId);
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payment = await paymentResponse.json();
    const externalReference = payment.external_reference;
    const status = payment.status;

    console.log("Payment details:", { externalReference, status });

    // ============================================================
    // Handle refund status — update payment_refunds if applicable
    // ============================================================
    if (status === "refunded" || status === "partially_refunded") {
      try {
        // Look up payment_transactions by mercadopago_payment_id, then find payment_refunds
        const { data: tx } = await supabase
          .from("payment_transactions")
          .select("id")
          .eq("mercadopago_payment_id", String(notificationId))
          .maybeSingle();

        if (tx) {
          const { data: refundRecord } = await supabase
            .from("payment_refunds")
            .select("id, status, processor_fee_lost")
            .eq("payment_transaction_id", tx.id)
            .eq("payment_processor", "mercadopago")
            .in("status", ["pending", "processing"])
            .maybeSingle();

          if (refundRecord) {
            await supabase
              .from("payment_refunds")
              .update({
                status: "succeeded",
                confirmed_at: new Date().toISOString(),
                webhook_last_event: `mercadopago.${status}`,
                webhook_last_payload: payment,
                updated_at: new Date().toISOString(),
              })
              .eq("id", refundRecord.id);

            console.log(`MercadoPago refund confirmed for payment_refund ${refundRecord.id} (payment ${notificationId})`);

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
                      console.error(`Error clawing back points for MP refund ${refundRecord.id}: ${clawbackError.message}`);
                    } else {
                      console.log(`Points clawback processed for MP refund ${refundRecord.id}`);
                    }
                  }
                }
              }
            } catch (clawbackErr) {
              console.error("Error during points clawback (MP):", clawbackErr);
            }
          }
        }
      } catch (refundErr) {
        console.error("Error updating MP refund status:", refundErr);
      }
    }

    if (!externalReference) {
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (status === "approved") {
      // Check if this is a featured slot payment first
      const { data: featuredSlot } = await supabase
        .from("featured_tour_slots")
        .select("id, status, total_amount")
        .eq("id", externalReference)
        .eq("status", "pending_payment")
        .maybeSingle();

      if (featuredSlot) {
        const totalPaid = Number(featuredSlot.total_amount ?? 0);
        const { error: rpcError } = await supabase.rpc("confirm_featured_slot_payment", {
          p_slot_id: featuredSlot.id,
          p_payment_id: String(notificationId),
          p_payment_provider: "mercadopago",
          p_total: totalPaid,
        });
        if (rpcError) {
          console.error("Error confirming featured slot payment (MP):", rpcError);
        } else {
          fetch(
            `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-featured-slot-cfdi`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              },
              body: JSON.stringify({ slot_id: featuredSlot.id }),
            }
          ).catch((err) => console.error("Error triggering featured slot CFDI (MP):", err));
        }
        return new Response(JSON.stringify({ received: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check if this is a booking supplement payment
      const { data: bookingSupplement } = await supabase
        .from("booking_supplements")
        .select("id, status")
        .eq("id", externalReference)
        .eq("status", "pending_payment")
        .maybeSingle();

      if (bookingSupplement) {
        const { error: suppUpdateError } = await supabase
          .from("booking_supplements")
          .update({
            status: "paid",
            payment_id: String(notificationId),
            payment_provider: "mercadopago",
            updated_at: new Date().toISOString(),
          })
          .eq("id", externalReference);

        if (suppUpdateError) {
          console.error("Error updating supplement payment status (MP webhook):", suppUpdateError);
        } else {
          // Record in payment_transactions for refund tracking
          const { data: existingSuppTx } = await supabase
            .from("payment_transactions")
            .select("id")
            .eq("mercadopago_payment_id", String(notificationId))
            .maybeSingle();
          if (!existingSuppTx) {
            const { data: suppDetails } = await supabase
              .from("booking_supplements")
              .select("booking_id, total_paid")
              .eq("id", externalReference)
              .maybeSingle();
            if (suppDetails) {
              await supabase.from("payment_transactions").insert({
                booking_id: suppDetails.booking_id,
                mercadopago_payment_id: String(notificationId),
                amount: Number(suppDetails.total_paid) || 0,
                currency: "mxn",
                status: "succeeded",
                payment_processor: "mercadopago",
                processor_fee: 0,
                net_amount: Number(suppDetails.total_paid) || 0,
                charge_context: "supplement",
                charge_reference_id: externalReference,
              });
            }
          }

          fetch(
            `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-supplement-cfdi`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              },
              body: JSON.stringify({ supplement_id: externalReference }),
            }
          ).catch((err) => console.error("Error triggering supplement CFDI (MP webhook):", err));
        }
        return new Response(JSON.stringify({ received: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: booking } = await supabase
        .from("bookings")
        .select("id, user_id, payment_status")
        .eq("id", externalReference)
        .maybeSingle();

      if (booking && booking.payment_status !== "succeeded") {
        await supabase
          .from("bookings")
          .update({
            payment_status: "succeeded",
            status: "confirmed",
            payment_method: "mercadopago",
            payment_provider: "mercadopago",
            paid_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", externalReference);

        // Persist payment_transactions record for multi-processor refund support
        try {
          const mpAmount = parseFloat(payment.transaction_amount || payment.amount || "0");
          const mpFee = Array.isArray(payment.fee_details)
            ? payment.fee_details
                .filter((fd: any) => fd.type === "mercadopago_fee")
                .reduce((sum: number, fd: any) => sum + parseFloat(fd.amount || "0"), 0)
            : 0;

          const { data: existingTx } = await supabase
            .from("payment_transactions")
            .select("id")
            .eq("mercadopago_payment_id", String(notificationId))
            .maybeSingle();

          if (!existingTx) {
            await supabase.from("payment_transactions").insert({
              booking_id: externalReference,
              mercadopago_payment_id: String(notificationId),
              payment_processor: "mercadopago",
              amount: mpAmount,
              currency: "mxn",
              status: "succeeded",
              payment_method_type: "Tarjeta",
              processor_fee: mpFee,
              net_amount: mpAmount - mpFee,
              metadata: payment,
            });
            console.log(`payment_transactions record created for MP payment ${notificationId} (webhook), fee=${mpFee}`);
          }
        } catch (txErr) {
          console.error("Error inserting payment_transactions (MP webhook):", txErr);
        }

        // Apply preventa commission discount (10% on first 10 preventa bookings)
        try {
          const { data: bookingForPreventa } = await supabase
            .from("bookings")
            .select("es_reserva_preventa, commission_amount, tour_id")
            .eq("id", externalReference)
            .single();

          if (bookingForPreventa?.es_reserva_preventa) {
            const { data: preventaCount } = await supabase.rpc("get_preventa_bookings_count", { p_tour_id: bookingForPreventa.tour_id });
            if ((preventaCount || 0) <= 10) {
              const commissionBase = parseFloat(bookingForPreventa.commission_amount) || 0;
              const preventaComisionDescuento = Math.round(commissionBase * 0.10 * 100) / 100;
              await supabase.from("bookings").update({
                commission_amount: Math.round((commissionBase - preventaComisionDescuento) * 100) / 100,
                preventa_comision_descuento: preventaComisionDescuento,
              }).eq("id", externalReference);
              console.log(`✅ Preventa commission discount applied (MP): -${preventaComisionDescuento}`);
            }
          }
        } catch (preventaErr) {
          console.error("Error processing preventa commission discount (MP):", preventaErr);
        }

        try {
          await fetch(
            `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-booking-confirmation`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              },
              body: JSON.stringify({ booking_id: externalReference }),
            }
          );
        } catch (emailErr) {
          console.error("Error sending confirmation email:", emailErr);
        }

        try {
          const { data: cfdiSettings } = await supabase
            .from("platform_settings")
            .select("pac_provider")
            .maybeSingle();
          if (cfdiSettings?.pac_provider && cfdiSettings.pac_provider !== "none") {
            await fetch(
              `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-booking-cfdi`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                },
                body: JSON.stringify({ booking_id: externalReference }),
              }
            );
          }
        } catch (cfdiErr) {
          console.error("Error triggering booking CFDI (mercadopago):", cfdiErr);
        }

        // Sync booking to accounting system (fire and forget)
        fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-booking-to-accounting`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ booking_id: externalReference }),
          }
        ).catch((err) => console.error("Error triggering booking accounting sync:", err));

        // Process unpaid optional services (pickup, language, traditional optionals)
        try {
          const { data: unpaidOptionals } = await supabase
            .from('booking_optional_services')
            .select('id, subtotal, total_paid')
            .eq('booking_id', externalReference)
            .eq('is_cancelled', false)
            .is('paid_at', null);

          if (unpaidOptionals && unpaidOptionals.length > 0) {
            const { data: settings } = await supabase
              .from('platform_settings')
              .select('service_charge_percentage')
              .maybeSingle();
            const svcChargeRate = settings?.service_charge_percentage || 5;

            for (const opt of unpaidOptionals) {
              if ((opt.total_paid || opt.subtotal) <= 0) continue;
              const grossSvcCharge = Math.round((opt.subtotal * svcChargeRate / 100) * 100) / 100;
              let exemptionUsed = 0;
              try {
                const { data: exemptResult } = await supabase
                  .rpc('apply_membership_service_fee_exemption', {
                    p_user_id: booking.user_id,
                    p_gross_service_charge: grossSvcCharge,
                  });
                exemptionUsed = parseFloat(exemptResult?.exemption_applied ?? '0');
              } catch (e) {
                console.error(`Error applying exemption for optional ${opt.id} (MP):`, e);
              }

              await supabase
                .from('booking_optional_services')
                .update({
                  paid_at: new Date().toISOString(),
                  payment_method: 'mercadopago',
                  service_charge: grossSvcCharge - exemptionUsed,
                  membership_exemption_used: exemptionUsed,
                  total_paid: opt.total_paid || opt.subtotal,
                })
                .eq('id', opt.id);
            }
            console.log(`Processed ${unpaidOptionals.length} optional services for booking ${externalReference} (MP)`);
          }
        } catch (optError) {
          console.error('Error processing optional services (MP):', optError);
        }

        // Activate payment plan if the booking was created with selected_payment_mode === 'plan'
        try {
          const { data: bkForPlan } = await supabase
            .from('bookings')
            .select(`
              id, selected_payment_mode, total_price, deposit_amount,
              tours:tour_id(payment_option, payment_plan_mode, installment_definitions, start_date, full_payment_days_before_departure)
            `)
            .eq('id', externalReference)
            .maybeSingle();

          if (bkForPlan?.selected_payment_mode === 'plan') {
            const tour = bkForPlan.tours as any;
            const totalPrice = parseFloat(bkForPlan.total_price) || 0;
            const depositPaid = parseFloat(bkForPlan.deposit_amount) || 0;
            const defs: any[] = tour?.installment_definitions || [];

            if (defs.length > 0) {
              const { data: existingPlan } = await supabase
                .from('booking_payment_plans')
                .select('id')
                .eq('booking_id', externalReference)
                .maybeSingle();

              if (!existingPlan) {
                const { data: plan, error: planErr } = await supabase
                  .from('booking_payment_plans')
                  .insert({
                    booking_id: externalReference,
                    mode: 'installments',
                    total_plan_amount: totalPrice,
                    total_amount_paid: depositPaid,
                    status: 'active',
                    paid_100_pct_at_booking: false,
                  })
                  .select('id')
                  .single();

                if (planErr || !plan) {
                  console.error('Error creating payment plan (MP webhook):', planErr);
                } else {
                  const bookingDate = new Date();
                  const departureDate = tour?.start_date ? new Date(tour.start_date) : null;

                  const installments = defs.map((def: any, idx: number) => {
                    const amount = Math.round(totalPrice * (def.pct_of_total / 100) * 100) / 100;
                    let dueDate: Date;
                    if (def.specific_date) {
                      dueDate = new Date(def.specific_date + 'T12:00:00');
                    } else if (def.days_before_departure !== undefined && departureDate) {
                      dueDate = new Date(departureDate);
                      dueDate.setDate(dueDate.getDate() - def.days_before_departure);
                    } else {
                      dueDate = new Date(bookingDate);
                      dueDate.setDate(dueDate.getDate() + (def.days_after_booking || 0));
                    }

                    const isFirstInstallment = idx === 0;
                    const amountPaidForThisInstallment = isFirstInstallment ? Math.min(depositPaid, amount) : 0;
                    const isPaid = isFirstInstallment && amountPaidForThisInstallment >= amount;

                    return {
                      plan_id: plan.id,
                      booking_id: externalReference,
                      installment_number: idx + 1,
                      label: def.label || `Pago ${idx + 1}`,
                      amount_due: amount,
                      amount_paid: amountPaidForThisInstallment,
                      due_date: dueDate.toISOString().split('T')[0],
                      status: isPaid ? 'paid' : 'pending',
                      paid_at: isPaid ? new Date().toISOString() : null,
                    };
                  });

                  const { error: instErr } = await supabase
                    .from('booking_payment_plan_installments')
                    .insert(installments);

                  if (instErr) {
                    console.error('Error creating installments (MP webhook):', instErr);
                  } else {
                    await supabase
                      .from('bookings')
                      .update({
                        has_payment_plan: true,
                        payment_plan_status: 'active',
                        payment_plan_total: totalPrice,
                        payment_plan_paid: depositPaid,
                      })
                      .eq('id', externalReference);
                    console.log(`✅ Payment plan created for booking ${externalReference} with ${installments.length} installments (MP webhook)`);
                  }
                }
              }
            }
          }
        } catch (planErr) {
          console.error('Error creating payment plan (MP webhook):', planErr);
        }
      }

      const { data: giftCard } = await supabase
        .from("gift_cards")
        .select("id, payment_status")
        .eq("id", externalReference)
        .maybeSingle();

      if (giftCard && giftCard.payment_status !== "paid") {
        await supabase
          .from("gift_cards")
          .update({
            payment_status: "paid",
            payment_provider: "mercadopago",
            updated_at: new Date().toISOString(),
          })
          .eq("id", externalReference);

        // Poliza contable: venta de gift card
        await supabase.rpc("create_accounting_entry_for_gift_card_sale", { p_gift_card_id: externalReference });

        try {
          await fetch(
            `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-gift-card-email`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              },
              body: JSON.stringify({ giftCardId: externalReference }),
            }
          );
        } catch (emailErr) {
          console.error("Error sending gift card email:", emailErr);
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Error in mercadopago-webhook:", err);
    return new Response(JSON.stringify({ error: err.message || "Error interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
