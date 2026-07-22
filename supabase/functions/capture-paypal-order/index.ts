import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
            body: JSON.stringify({ booking_id: bookingId }),
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
      .select("paypal_client_id, paypal_client_secret, paypal_sandbox")
      .maybeSingle();

    if (!paypalClientId && settings?.paypal_client_id) paypalClientId = settings.paypal_client_id;
    if (!paypalClientSecret && settings?.paypal_client_secret) paypalClientSecret = settings.paypal_client_secret;
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
            const referenceId = giftCardId || bookingId || orderDetails.purchase_units?.[0]?.reference_id;
            const paypalTransactionId = orderDetails.purchase_units?.[0]?.payments?.captures?.[0]?.id || null;

            if (context === "featured_slot" && slotId) {
              const totalPaid = parseFloat(orderDetails.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? "0");
              await supabase.rpc("confirm_featured_slot_payment", {
                p_slot_id: slotId,
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
                  body: JSON.stringify({ slot_id: slotId }),
                }).catch((err) => console.error("Error triggering featured slot CFDI (paypal already captured):", err))
              );
            } else if (context === "gift_card" && referenceId) {
              await activateGiftCard(supabase, referenceId, paypalTransactionId);
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
      const referenceId = giftCardId || bookingId || captureData.purchase_units?.[0]?.reference_id;
      const paypalTransactionId = captureData.purchase_units?.[0]?.payments?.captures?.[0]?.id || null;

      if (context === "featured_slot" && slotId) {
        const totalPaid = parseFloat(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? "0");
        await supabase.rpc("confirm_featured_slot_payment", {
          p_slot_id: slotId,
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
            body: JSON.stringify({ slot_id: slotId }),
          }).catch((err) => console.error("Error triggering featured slot CFDI (paypal):", err))
        );
      } else if (context === "gift_card" && referenceId) {
        await activateGiftCard(supabase, referenceId, paypalTransactionId);
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
    return new Response(JSON.stringify({ error: err.message || "Error interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
