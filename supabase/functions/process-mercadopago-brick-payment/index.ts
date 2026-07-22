import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { formData, preferenceId, bookingId } = await req.json();

    if (!formData) {
      return new Response(JSON.stringify({ error: "Datos del formulario requeridos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!mpAccessToken) {
      const { data: settings } = await supabase
        .from("platform_settings")
        .select("mercadopago_access_token")
        .maybeSingle();
      if (settings?.mercadopago_access_token) mpAccessToken = settings.mercadopago_access_token;
    }

    if (!mpAccessToken) {
      return new Response(JSON.stringify({ error: "MercadoPago no configurado" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const paymentPayload = {
      ...formData,
      external_reference: bookingId,
      notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mercadopago-webhook`,
      metadata: {
        ...(formData.metadata || {}),
        preference_id: preferenceId,
        booking_id: bookingId,
      },
    };

    const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mpAccessToken}`,
        "X-Idempotency-Key": `${preferenceId}-${Date.now()}`,
      },
      body: JSON.stringify(paymentPayload),
    });

    const payment = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error("MercadoPago payment error:", JSON.stringify(payment));
      return new Response(
        JSON.stringify({
          error: payment.message || "Error al procesar el pago",
          status_detail: payment.cause?.[0]?.description,
        }),
        {
          status: mpResponse.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (bookingId && payment.status === "approved") {
      const { data: giftCardCheck } = await supabase
        .from("gift_cards")
        .select("id")
        .eq("id", bookingId)
        .maybeSingle();

      if (giftCardCheck) {
        await supabase
          .from("gift_cards")
          .update({
            status: "active",
            payment_status: "paid",
          })
          .eq("id", bookingId);

        try {
          await fetch(
            `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-gift-card-email`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              },
              body: JSON.stringify({ giftCardId: bookingId }),
            }
          );
          console.log("Gift card email sent for:", bookingId);
        } catch (emailErr) {
          console.error("Error sending gift card email:", emailErr);
        }

        return new Response(
          JSON.stringify({
            success: true,
            status: payment.status,
            status_detail: payment.status_detail,
            payment_id: payment.id,
            external_reference: payment.external_reference,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error: updateError } = await supabase
        .from("bookings")
        .update({
          payment_status: "succeeded",
          status: "confirmed",
          paid_at: new Date().toISOString(),
          payment_method: "mercadopago",
        })
        .eq("id", bookingId);

      if (updateError) {
        console.error("Error updating booking after approved MP payment:", updateError);
      } else {
        console.log("Booking confirmed after MP payment approval:", bookingId);

        // Persist payment_transactions record for multi-processor refund support
        try {
          const mpFee = Array.isArray(payment.fee_details)
            ? payment.fee_details
                .filter((fd: any) => fd.type === "mercadopago_fee")
                .reduce((sum: number, fd: any) => sum + parseFloat(fd.amount || "0"), 0)
            : 0;
          const mpAmount = parseFloat(payment.transaction_amount || payment.amount || "0");

          const { data: existingTx } = await supabase
            .from("payment_transactions")
            .select("id")
            .eq("mercadopago_payment_id", String(payment.id))
            .maybeSingle();

          if (!existingTx) {
            await supabase.from("payment_transactions").insert({
              booking_id: bookingId,
              mercadopago_payment_id: String(payment.id),
              payment_processor: "mercadopago",
              amount: mpAmount,
              currency: "mxn",
              status: "succeeded",
              payment_method_type: "Tarjeta",
              processor_fee: mpFee,
              net_amount: mpAmount - mpFee,
              metadata: payment,
            });
            console.log(`payment_transactions record created for MP payment ${payment.id}, fee=${mpFee}`);
          }
        } catch (txErr) {
          console.error("Error inserting payment_transactions (MercadoPago):", txErr);
        }

        const { data: booking } = await supabase
          .from("bookings")
          .select("agency_id, deposit_amount, service_charge")
          .eq("id", bookingId)
          .maybeSingle();

        if (booking) {
          const { data: existing } = await supabase
            .from("commission_records")
            .select("id")
            .eq("booking_id", bookingId)
            .maybeSingle();

          if (!existing) {
            const { data: platformSettings } = await supabase
              .from("platform_settings")
              .select("agency_commission_percentage")
              .maybeSingle();

            const commissionRate = (platformSettings?.agency_commission_percentage || 15) / 100;
            const depositAmount = Number(booking.deposit_amount || 0);
            const platformAmount = depositAmount * commissionRate;
            const agencyAmount = depositAmount - platformAmount;

            await supabase.from("commission_records").insert({
              booking_id: bookingId,
              agency_id: booking.agency_id,
              agency_amount: agencyAmount,
              platform_amount: platformAmount,
              status: "pending",
            });
          }
        }

        // Record insurance discount code usage if applicable
        try {
          const { data: bookingForInsurance } = await supabase
            .from("bookings")
            .select("user_id, insurance_discount_code_id")
            .eq("id", bookingId)
            .maybeSingle();

          if (bookingForInsurance?.insurance_discount_code_id) {
            const insCodeId = bookingForInsurance.insurance_discount_code_id;
            const { data: existingInsUsage } = await supabase
              .from("discount_code_usage")
              .select("id")
              .eq("discount_code_id", insCodeId)
              .eq("user_id", bookingForInsurance.user_id)
              .maybeSingle();

            if (!existingInsUsage) {
              await supabase.from("discount_code_usage").insert({
                discount_code_id: insCodeId,
                user_id: bookingForInsurance.user_id,
                booking_id: bookingId,
              });
            }
          }
        } catch (insDiscountError) {
          console.error("Error recording insurance discount code usage:", insDiscountError);
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
              body: JSON.stringify({ booking_id: bookingId }),
            }
          );
          console.log("Booking confirmation emails triggered for:", bookingId);
        } catch (emailErr) {
          console.error("Error sending booking confirmation email:", emailErr);
        }

        // Activate payment plan if the booking was created with selected_payment_mode === 'plan'
        try {
          const { data: bkForPlan } = await supabase
            .from('bookings')
            .select(`
              id, selected_payment_mode, total_price, deposit_amount,
              tours:tour_id(payment_option, payment_plan_mode, installment_definitions, start_date, full_payment_days_before_departure)
            `)
            .eq('id', bookingId)
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
                .eq('booking_id', bookingId)
                .maybeSingle();

              if (!existingPlan) {
                const { data: plan, error: planErr } = await supabase
                  .from('booking_payment_plans')
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
                  console.error('Error creating payment plan (MP brick):', planErr);
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
                    .from('booking_payment_plan_installments')
                    .insert(installments);

                  if (instErr) {
                    console.error('Error creating installments (MP brick):', instErr);
                  } else {
                    await supabase
                      .from('bookings')
                      .update({
                        has_payment_plan: true,
                        payment_plan_status: 'active',
                        payment_plan_total: totalPrice,
                        payment_plan_paid: depositPaid,
                      })
                      .eq('id', bookingId);
                    console.log(`✅ Payment plan created for booking ${bookingId} with ${installments.length} installments (MP brick)`);
                  }
                }
              }
            }
          }
        } catch (planErr) {
          console.error('Error creating payment plan (MP brick):', planErr);
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
                body: JSON.stringify({ booking_id: bookingId }),
              }
            );
          }
        } catch (cfdiErr) {
          console.error("Error triggering booking CFDI (mp-brick):", cfdiErr);
        }
      }
    } else if (bookingId && (payment.status === "in_process" || payment.status === "pending")) {
      await supabase
        .from("bookings")
        .update({ payment_status: "processing" })
        .eq("id", bookingId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        status: payment.status,
        status_detail: payment.status_detail,
        payment_id: payment.id,
        external_reference: payment.external_reference,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Error in process-mercadopago-brick-payment:", err);
    return new Response(JSON.stringify({ error: err.message || "Error interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
