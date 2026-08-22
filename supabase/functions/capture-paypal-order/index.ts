import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
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
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function getPayPalAccessToken(clientId: string, clientSecret: string, isSandbox: boolean): Promise<string> {
  const base = isSandbox
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("PayPal token error:", errorBody);
    throw new Error("Failed to get PayPal access token");
  }
  const data = await response.json();
  return data.access_token;
}

async function getPayPalOrderDetails(base: string, accessToken: string, orderId: string): Promise<any> {
  const response = await fetch(`${base}/v2/checkout/orders/${orderId}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    const errorBody = await response.text();
    console.error("PayPal get order error:", errorBody);
    throw new Error("Failed to get PayPal order details");
  }
  return response.json();
}

async function activateGiftCard(supabase: any, giftCardId: string, paypalTransactionId: string | null) {
  const { data: existingGc } = await supabase
    .from("gift_cards")
    .select("payment_status")
    .eq("id", giftCardId)
    .maybeSingle();

  if (existingGc?.payment_status === "paid") {
    console.log(`Gift card ${giftCardId} already paid — skipping duplicate activation (PayPal)`);
    return;
  }

  const { error } = await supabase
    .from("gift_cards")
    .update({
      status: "active",
      payment_status: "paid",
      payment_provider: "paypal",
      paypal_transaction_id: paypalTransactionId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", giftCardId)
    .in("status", ["pending_payment", "active"]);

  if (error) {
    console.error("Error updating gift card:", error);
  } else {
    // Poliza contable: venta de gift card
    await supabase.rpc("create_accounting_entry_for_gift_card_sale", { p_gift_card_id: giftCardId });
  }

  EdgeRuntime.waitUntil(
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-gift-card-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ giftCardId: giftCardId }),
    })
  );
}

async function confirmBooking(supabase: any, bookingId: string, paypalTransactionId: string | null, captureData?: any) {
  const { data: existingBooking } = await supabase
    .from("bookings")
    .select("payment_status, deposit_amount, user_id, toursred_cash_used, points_used")
    .eq("id", bookingId)
    .maybeSingle();

  if (existingBooking?.payment_status === "succeeded") {
    console.log(`Booking ${bookingId} already confirmed — skipping duplicate side effects (PayPal)`);
    return;
  }

  const capturedAmount = parseFloat(
    (captureData?.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value) ?? captureData?.amount?.value ?? "0"
  );
  const { data: priorPaypalPayments } = await supabase
    .from("payment_transactions")
    .select("amount")
    .eq("booking_id", bookingId)
    .eq("status", "succeeded")
    .eq("payment_processor", "paypal");
  const alreadyPaid = (priorPaypalPayments || []).reduce((sum: number, tx: any) => sum + Number(tx.amount || 0), 0);
  const totalPaid = alreadyPaid + capturedAmount;
  const requiredAmount = Number(existingBooking?.deposit_amount || 0);

  if (totalPaid < requiredAmount - 0.5) {
    await supabase.from("bookings").update({ payment_status: "processing" }).eq("id", bookingId);
    console.log(`Partial PayPal payment for booking ${bookingId}: ${totalPaid}/${requiredAmount} paid — marked as processing`);
    return;
  }

  const { error } = await supabase
    .from("bookings")
    .update({
      payment_status: "succeeded",
      status: "confirmed",
      payment_method: "paypal",
      payment_provider: "paypal",
      paypal_transaction_id: paypalTransactionId,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId);

  if (error) {
    console.error("Error updating booking:", error);
  }

  // Deduct ToursRed Cash from wallet if used
  const toursRedCashUsed = parseFloat(existingBooking?.toursred_cash_used || '0');
  if (toursRedCashUsed > 0 && existingBooking?.user_id) {
    try {
      const { data: existingWalletTx } = await supabase
        .from("wallet_transactions")
        .select("id")
        .eq("user_id", existingBooking.user_id)
        .eq("reference_id", bookingId)
        .eq("reference_type", "booking")
        .eq("type", "debit")
        .maybeSingle();

      if (existingWalletTx) {
        console.log(`⚠️ ToursRed Cash already deducted for booking ${bookingId} (PayPal), skipping...`);
      } else {
        const { error: walletError } = await supabase.rpc('update_wallet_balance', {
          p_user_id: existingBooking.user_id,
          p_amount: -toursRedCashUsed,
          p_type: 'debit',
          p_description: `Aplicado a reserva #${bookingId}`,
          p_reference_id: bookingId,
          p_reference_type: 'booking',
          p_idempotency_key: `${bookingId}_charge_booking`,
        });
        if (walletError) {
          console.error(`Error deducting ToursRed Cash (PayPal): ${walletError.message}`);
        } else {
          console.log(`Successfully deducted ${toursRedCashUsed} MXN from user wallet (PayPal)`);
        }
      }
    } catch (walletErr) {
      console.error('Error processing ToursRed Cash deduction (PayPal):', walletErr);
    }
  }

  // Deduct ToursRed Points if used
  const pointsUsed = parseInt(existingBooking?.points_used || '0');
  if (pointsUsed > 0) {
    try {
      const { error: pointsError } = await supabase.rpc('deduct_points_for_booking', {
        p_booking_id: bookingId,
        p_points_to_deduct: pointsUsed,
      });
      if (pointsError) {
        console.error(`Error deducting points (PayPal): ${pointsError.message}`);
      } else {
        console.log(`Successfully deducted ${pointsUsed} points from user points wallet (PayPal)`);
      }
    } catch (pointsErr) {
      console.error('Error processing points deduction (PayPal):', pointsErr);
    }
  }

  // Persist payment_transactions record for multi-processor refund support
  if (paypalTransactionId) {
    try {
      const capture = captureData?.purchase_units?.[0]?.payments?.captures?.[0] || captureData;
      const amountValue = parseFloat(capture?.amount?.value ?? "0");
      const currencyCode = (capture?.amount?.currency_code || "MXN").toLowerCase();
      const paypalFee = parseFloat(capture?.seller_receivable_breakdown?.paypal_fee?.value || "0");

      const { data: existingTx } = await supabase
        .from("payment_transactions")
        .select("id")
        .eq("paypal_capture_id", paypalTransactionId)
        .maybeSingle();

      if (!existingTx) {
        await supabase.from("payment_transactions").insert({
          booking_id: bookingId,
          paypal_capture_id: paypalTransactionId,
          payment_processor: "paypal",
          amount: amountValue,
          currency: currencyCode,
          status: "succeeded",
          payment_method_type: "Tarjeta",
          charge_context: "booking_deposit",
          charge_reference_id: bookingId,
          processor_fee: paypalFee,
          net_amount: amountValue - paypalFee,
          metadata: captureData || null,
        });
        console.log(`payment_transactions record created for PayPal capture ${paypalTransactionId}`);
      }
    } catch (txErr) {
      console.error("Error inserting payment_transactions (PayPal):", txErr);
    }
  }

  // Process unpaid optional services (pickup, language, traditional optionals)
  try {
    const { data: booking } = await supabase
      .from("bookings")
      .select("user_id")
      .eq("id", bookingId)
      .single();

    const { data: unpaidOptionals } = await supabase
      .from("booking_optional_services")
      .select("id, subtotal, total_paid")
      .eq("booking_id", bookingId)
      .eq("is_cancelled", false)
      .is("paid_at", null);

    if (unpaidOptionals && unpaidOptionals.length > 0) {
      const { data: settings } = await supabase
        .from("platform_settings")
        .select("service_charge_percentage")
        .maybeSingle();
      const svcChargeRate = settings?.service_charge_percentage || 5;

      for (const opt of unpaidOptionals) {
        if ((opt.total_paid || opt.subtotal) <= 0) continue;
        const grossSvcCharge = Math.round((opt.subtotal * svcChargeRate / 100) * 100) / 100;
        let exemptionUsed = 0;
        try {
          const { data: exemptResult } = await supabase
            .rpc("apply_membership_service_fee_exemption", {
              p_user_id: booking.user_id,
              p_gross_service_charge: grossSvcCharge,
            });
          exemptionUsed = parseFloat(exemptResult?.exemption_applied ?? "0");
        } catch (e) {
          console.error(`Error applying exemption for optional ${opt.id} (PayPal):`, e);
        }

        await supabase
          .from("booking_optional_services")
          .update({
            paid_at: new Date().toISOString(),
            payment_method: "paypal",
            service_charge: grossSvcCharge - exemptionUsed,
            membership_exemption_used: exemptionUsed,
            total_paid: opt.total_paid || opt.subtotal,
          })
          .eq("id", opt.id);
      }
      console.log(`Processed ${unpaidOptionals.length} optional services for booking ${bookingId} (PayPal)`);
    }
  } catch (optError) {
    console.error("Error processing optional services (PayPal):", optError);
  }

  // Apply preventa commission discount (10% on first 10 preventa bookings)
  EdgeRuntime.waitUntil(
    (async () => {
      try {
        const { data: bookingForPreventa } = await supabase
          .from("bookings")
          .select("es_reserva_preventa, commission_amount, tour_id")
          .eq("id", bookingId)
          .single();

        if (bookingForPreventa?.es_reserva_preventa) {
          const { data: preventaCount } = await supabase.rpc("get_preventa_bookings_count", { p_tour_id: bookingForPreventa.tour_id });
          if ((preventaCount || 0) <= 10) {
            const commissionBase = parseFloat(bookingForPreventa.commission_amount) || 0;
            const preventaComisionDescuento = Math.round(commissionBase * 0.10 * 100) / 100;
            await supabase.from("bookings").update({
              commission_amount: Math.round((commissionBase - preventaComisionDescuento) * 100) / 100,
              preventa_comision_descuento: preventaComisionDescuento,
            }).eq("id", bookingId);
            console.log(`✅ Preventa commission discount applied (PayPal): -${preventaComisionDescuento}`);
          }
        }
      } catch (preventaErr) {
        console.error("Error processing preventa commission discount (PayPal):", preventaErr);
      }
    })()
  );

  EdgeRuntime.waitUntil(
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-booking-confirmation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ booking_id: bookingId }),
    })
  );

  EdgeRuntime.waitUntil(
    (async () => {
      try {
        const { data: cfdiSettings } = await supabase
          .from("platform_settings")
          .select("pac_provider")
          .maybeSingle();
        if (cfdiSettings?.pac_provider && cfdiSettings.pac_provider !== "none") {
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-booking-cfdi`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ booking_id: bookingId, payment_form: '04' }),
          });
        }
      } catch (cfdiErr) {
        console.error("Error triggering booking CFDI (paypal):", cfdiErr);
      }
    })()
  );

  // Sync booking to accounting system (fire and forget)
  EdgeRuntime.waitUntil(
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-booking-to-accounting`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ booking_id: bookingId }),
    }).catch((err) => console.error("Error triggering booking accounting sync (paypal):", err))
  );

  // Activate payment plan if the booking was created with selected_payment_mode === 'plan'
  EdgeRuntime.waitUntil(
    (async () => {
      try {
        const { data: bkForPlan } = await supabase
          .from("bookings")
          .select(`
            id, selected_payment_mode, total_price, deposit_amount,
            tours:tour_id(payment_option, payment_plan_mode, installment_definitions, start_date, full_payment_days_before_departure)
          `)
          .eq("id", bookingId)
          .maybeSingle();

        if (bkForPlan?.selected_payment_mode === 'plan') {
          const tour = bkForPlan.tours as any;
          const totalPrice = parseFloat(bkForPlan.total_price) || 0;
          const depositPaid = parseFloat(bkForPlan.deposit_amount) || 0;
          const defs: any[] = tour?.installment_definitions || [];

          if (defs.length > 0) {
            const { data: existingPlan } = await supabase
              .from("booking_payment_plans")
              .select("id")
              .eq("booking_id", bookingId)
              .maybeSingle();

            if (!existingPlan) {
              const { data: plan, error: planErr } = await supabase
                .from("booking_payment_plans")
                .insert({
                  booking_id: bookingId,
                  mode: 'installments',
                  total_plan_amount: totalPrice,
                  total_amount_paid: depositPaid,
                  status: 'active',
                  paid_100_pct_at_booking: false,
                })
                .select('id')
                .single();

              if (planErr || !plan) {
                console.error('Error creating payment plan (PayPal):', planErr);
              } else {
                const bookingDate = new Date();
                const departureDate = tour?.start_date ? new Date(tour.start_date) : null;
                const daysBeforeDeparture = tour?.full_payment_days_before_departure || 15;

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
                    booking_id: bookingId,
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
                  .from("booking_payment_plan_installments")
                  .insert(installments);

                if (instErr) {
                  console.error('Error creating installments (PayPal):', instErr);
                } else {
                  await supabase
                    .from("bookings")
                    .update({
                      has_payment_plan: true,
                      payment_plan_status: 'active',
                      payment_plan_total: totalPrice,
                      payment_plan_paid: depositPaid,
                    })
                    .eq("id", bookingId);
                  console.log(`✅ Payment plan created for booking ${bookingId} with ${installments.length} installments (PayPal)`);
                }
              }
            } else {
              console.log(`Payment plan already exists for booking ${bookingId}, skipping (PayPal)`);
            }
          }
        }
      } catch (planErr) {
        console.error('Error creating payment plan for booking (PayPal):', planErr);
      }
    })()
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { orderId, bookingId, context, giftCardId, slotId } = await req.json();

    if (!orderId) {
      return new Response(JSON.stringify({ error: "order_id requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let paypalClientId = Deno.env.get("PAYPAL_CLIENT_ID");
    let paypalClientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");
    let isSandbox = Deno.env.get("PAYPAL_SANDBOX") === "true";

    const { data: settings } = await supabase
      .from("platform_settings")
      .select("paypal_client_id, paypal_sandbox")
      .maybeSingle();
    const { data: secrets } = await supabase
      .from("platform_secrets")
      .select("paypal_client_secret")
      .maybeSingle();

    if (!paypalClientId && settings?.paypal_client_id) paypalClientId = settings.paypal_client_id;
    if (!paypalClientSecret && secrets?.paypal_client_secret) paypalClientSecret = secrets.paypal_client_secret;
    if (settings?.paypal_sandbox !== undefined && settings?.paypal_sandbox !== null) {
      isSandbox = settings.paypal_sandbox;
    }

    if (!paypalClientId || !paypalClientSecret) {
      console.error("PayPal credentials missing. env:", !!Deno.env.get("PAYPAL_CLIENT_ID"), "settings:", !!settings?.paypal_client_id);
      return new Response(JSON.stringify({ error: "PayPal no configurado" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const base = isSandbox
      ? "https://api-m.sandbox.paypal.com"
      : "https://api-m.paypal.com";

    const accessToken = await getPayPalAccessToken(paypalClientId, paypalClientSecret, isSandbox);

    const captureResponse = await fetch(`${base}/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });

    let captureData: any;
    let captureStatus: string;

    if (!captureResponse.ok) {
      const errorBody = await captureResponse.text();
      console.error("PayPal capture error status:", captureResponse.status, "body:", errorBody);

      let errorJson: any = {};
      try { errorJson = JSON.parse(errorBody); } catch {}

      const isAlreadyCaptured =
        captureResponse.status === 422 &&
        errorJson?.details?.some((d: any) => d.issue === "ORDER_ALREADY_CAPTURED");

      if (isAlreadyCaptured) {
        console.log("Order already captured, fetching order details to confirm payment:", orderId);
        try {
          const orderDetails = await getPayPalOrderDetails(base, accessToken, orderId);
          console.log("PayPal order details status:", orderDetails.status);

          if (orderDetails.status === "COMPLETED") {
            const referenceId = orderDetails.purchase_units?.[0]?.reference_id;
            const verifiedSlotId = orderDetails.purchase_units?.[0]?.custom_id;
            const paypalTransactionId = orderDetails.purchase_units?.[0]?.payments?.captures?.[0]?.id || null;

            if (context === "featured_slot") {
              if (!verifiedSlotId) {
                return new Response(JSON.stringify({ error: "No se pudo verificar el tour destacado de esta orden" }), {
                  status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
              }
              const totalPaid = parseFloat(orderDetails.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? "0");
              await supabase.rpc("confirm_featured_slot_payment", {
                p_slot_id: verifiedSlotId,
                p_payment_id: paypalTransactionId ?? orderId,
                p_payment_provider: "paypal",
                p_total: totalPaid,
              });
              EdgeRuntime.waitUntil(
                fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-featured-slot-cfdi`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                  },
                  body: JSON.stringify({ slot_id: verifiedSlotId }),
                }).catch((err) => console.error("Error triggering featured slot CFDI (paypal already captured):", err))
              );
            } else if (context === "gift_card" && referenceId) {
              await activateGiftCard(supabase, referenceId, paypalTransactionId);
            } else if (context === "supplement" && referenceId) {
              await supabase.from("booking_supplements").update({
                status: "paid", payment_provider: "paypal", updated_at: new Date().toISOString(),
              }).eq("id", referenceId);
              supabase.rpc("create_accounting_entry_for_supplement", { p_supplement_id: referenceId })
                .catch((e) => console.error("Error creating supplement accounting entry (PayPal already captured):", e));
            } else if (context === "extras" && referenceId) {
              const extrasType = orderDetails.purchase_units?.[0]?.custom_id || "insurance";
              if (extrasType === "optional_service") {
                await supabase.from("booking_optional_services").update({
                  paid_at: new Date().toISOString(), payment_method: "paypal",
                }).eq("id", referenceId);
                supabase.rpc("create_accounting_entry_for_optional_service", { p_bos_id: referenceId })
                  .catch((e) => console.error("Error creating optional service accounting entry (PayPal already captured):", e));
              } else {
                await supabase.from("bookings").update({
                  travel_insurance_included: true,
                  travel_insurance_cost: parseFloat(orderDetails.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? "0"),
                  updated_at: new Date().toISOString(),
                }).eq("id", referenceId);
                supabase.rpc("create_accounting_entry_for_insurance_purchase", { p_booking_id: referenceId })
                  .catch((e) => console.error("Error creating insurance accounting entry (PayPal already captured):", e));
              }
            } else if (context === "payment_plan_installment" && referenceId) {
              const { data: planTx } = await supabase.from("booking_payment_plan_transactions")
                .select("id").eq("plan_id", referenceId).eq("payment_provider", "paypal")
                .order("created_at", { ascending: false }).limit(1).maybeSingle();
              if (planTx?.id) {
                supabase.rpc("create_accounting_entry_for_payment_plan_installment", { p_installment_tx_id: planTx.id })
                  .catch((e) => console.error("Error creating payment plan installment accounting entry (PayPal already captured):", e));
              }
            } else if (referenceId) {
              await confirmBooking(supabase, referenceId, paypalTransactionId, orderDetails);
            }

            return new Response(JSON.stringify({ success: true, status: "COMPLETED", alreadyCaptured: true }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          } else {
            console.error("Order not COMPLETED after already captured check, status:", orderDetails.status);
            return new Response(JSON.stringify({ success: false, status: orderDetails.status, error: "Pago no completado" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } catch (orderErr: any) {
          console.error("Error fetching order details after already captured:", orderErr);
          return new Response(JSON.stringify({ error: "Error al verificar estado del pago" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      return new Response(JSON.stringify({ error: "Error al capturar pago de PayPal", details: errorBody }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    captureData = await captureResponse.json();
    captureStatus = captureData.status;

    console.log("PayPal capture status:", captureStatus, "orderId:", orderId);

    if (captureStatus === "COMPLETED") {
      const referenceId = captureData.purchase_units?.[0]?.reference_id;
      const verifiedSlotId = captureData.purchase_units?.[0]?.custom_id;
      const paypalTransactionId = captureData.purchase_units?.[0]?.payments?.captures?.[0]?.id || null;

      if (context === "featured_slot") {
        if (!verifiedSlotId) {
          return new Response(JSON.stringify({ error: "No se pudo verificar el tour destacado de esta orden" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const totalPaid = parseFloat(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? "0");
        await supabase.rpc("confirm_featured_slot_payment", {
          p_slot_id: verifiedSlotId,
          p_payment_id: paypalTransactionId ?? orderId,
          p_payment_provider: "paypal",
          p_total: totalPaid,
        });
        EdgeRuntime.waitUntil(
          fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-featured-slot-cfdi`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ slot_id: verifiedSlotId }),
          }).catch((err) => console.error("Error triggering featured slot CFDI (paypal):", err))
        );
      } else if (context === "gift_card" && referenceId) {
        await activateGiftCard(supabase, referenceId, paypalTransactionId);
      } else if (context === "supplement" && referenceId) {
        await supabase.from("booking_supplements").update({
          status: "paid", payment_id: paypalTransactionId ?? orderId,
          payment_provider: "paypal", updated_at: new Date().toISOString(),
        }).eq("id", referenceId);

        const capturedAmt = parseFloat(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? "0");
        const ppFee = parseFloat(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.seller_receivable_breakdown?.paypal_fee?.value ?? "0");
        await supabase.from("payment_transactions").insert({
          booking_id: (await supabase.from("booking_supplements").select("booking_id").eq("id", referenceId).maybeSingle()).data?.booking_id,
          paypal_capture_id: paypalTransactionId, payment_processor: "paypal",
          amount: capturedAmt, currency: "mxn", status: "succeeded",
          processor_fee: ppFee, net_amount: capturedAmt - ppFee,
          charge_context: "supplement", charge_reference_id: referenceId,
        });

        EdgeRuntime.waitUntil(
          fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-supplement-cfdi`, {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({ booking_supplement_id: referenceId, payment_form: "04" }),
          }).catch((e) => console.error("Error triggering supplement CFDI (PayPal):", e))
        );
        supabase.rpc("create_accounting_entry_for_supplement", { p_supplement_id: referenceId })
          .catch((e) => console.error("Error creating supplement accounting entry (PayPal):", e));

      } else if (context === "extras" && referenceId) {
        const extrasType = captureData.purchase_units?.[0]?.custom_id || "insurance";
        if (extrasType === "optional_service") {
          await supabase.from("booking_optional_services").update({
            paid_at: new Date().toISOString(), payment_method: "paypal", updated_at: new Date().toISOString(),
          }).eq("id", referenceId);

          const capturedAmt = parseFloat(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? "0");
          const ppFee = parseFloat(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.seller_receivable_breakdown?.paypal_fee?.value ?? "0");
          const bosBooking = (await supabase.from("booking_optional_services").select("booking_id").eq("id", referenceId).maybeSingle()).data?.booking_id;
          await supabase.from("payment_transactions").insert({
            booking_id: bosBooking, paypal_capture_id: paypalTransactionId, payment_processor: "paypal",
            amount: capturedAmt, currency: "mxn", status: "succeeded",
            processor_fee: ppFee, net_amount: capturedAmt - ppFee,
            charge_context: "optional_service", charge_reference_id: referenceId,
          });

          EdgeRuntime.waitUntil(
            fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-optional-service-cfdi`, {
              method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
              body: JSON.stringify({ booking_optional_service_id: referenceId, payment_form: "04" }),
            }).catch((e) => console.error("Error triggering optional service CFDI (PayPal):", e))
          );
          supabase.rpc("create_accounting_entry_for_optional_service", { p_bos_id: referenceId })
            .catch((e) => console.error("Error creating optional service accounting entry (PayPal):", e));
        } else {
          await supabase.from("bookings").update({
            travel_insurance_included: true,
            travel_insurance_cost: parseFloat(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? "0"),
            updated_at: new Date().toISOString(),
          }).eq("id", referenceId);

          const capturedAmt = parseFloat(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? "0");
          const ppFee = parseFloat(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.seller_receivable_breakdown?.paypal_fee?.value ?? "0");
          await supabase.from("payment_transactions").insert({
            booking_id: referenceId, paypal_capture_id: paypalTransactionId, payment_processor: "paypal",
            amount: capturedAmt, currency: "mxn", status: "succeeded",
            processor_fee: ppFee, net_amount: capturedAmt - ppFee,
            charge_context: "insurance", charge_reference_id: referenceId,
          });

          EdgeRuntime.waitUntil(
            fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-post-booking-insurance-cfdi`, {
              method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
              body: JSON.stringify({ booking_id: referenceId, payment_form: "04" }),
            }).catch((e) => console.error("Error triggering insurance CFDI (PayPal):", e))
          );
          supabase.rpc("create_accounting_entry_for_insurance_purchase", { p_booking_id: referenceId })
            .catch((e) => console.error("Error creating insurance accounting entry (PayPal):", e));
        }

      } else if (context === "payment_plan_installment" && referenceId) {
        const planId = referenceId;
        const { data: planRow } = await supabase.from("booking_payment_plans").select("booking_id").eq("id", planId).maybeSingle();
        let planUserId: string | null = null;
        if (planRow) {
          const { data: bkRow } = await supabase.from("bookings").select("user_id").eq("id", planRow.booking_id).maybeSingle();
          planUserId = bkRow?.user_id || null;
        }
        const capturedAmt = parseFloat(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? "0");
        const ppFee = parseFloat(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.seller_receivable_breakdown?.paypal_fee?.value ?? "0");

        const { error: allocError } = await supabase.rpc("allocate_payment_plan_installment", {
          p_plan_id: planId, p_amount: capturedAmt, p_provider: "paypal",
          p_service_charge: 0, p_gross_service_charge: 0,
          p_provider_transaction_id: paypalTransactionId ?? orderId,
          p_user_id: planUserId, p_membership_exemption_used: false, p_is_wallet_payment: false,
        });

        if (allocError) {
          console.error(`Error allocating payment plan installment (PayPal) for plan ${planId}:`, allocError.message);
        }

        await supabase.from("payment_transactions").insert({
          booking_id: planRow?.booking_id, paypal_capture_id: paypalTransactionId,
          payment_processor: "paypal", amount: capturedAmt, currency: "mxn",
          status: "succeeded", processor_fee: ppFee, net_amount: capturedAmt - ppFee,
          charge_context: "payment_plan_installment", charge_reference_id: planId,
        });

        const { data: planTx } = await supabase.from("booking_payment_plan_transactions")
          .select("id").eq("plan_id", planId).eq("payment_provider", "paypal")
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (planTx?.id) {
          supabase.rpc("create_accounting_entry_for_payment_plan_installment", { p_installment_tx_id: planTx.id })
            .catch((e) => console.error("Error creating payment plan installment accounting entry (PayPal):", e));
        }

      } else if (referenceId) {
        await confirmBooking(supabase, referenceId, paypalTransactionId, captureData);
      }

      return new Response(JSON.stringify({ success: true, status: captureStatus }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: false, status: captureStatus }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Error in capture-paypal-order:", err);
    if (sentryDsn) {
      Sentry.captureException(err, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return new Response(JSON.stringify({ error: err.message || "Error interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
