import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { markPointsAsClawedBack } from "../_shared/pointsTraceability.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function cancelStampedCfds(
  supabase: ReturnType<typeof createClient>,
  bookingId: string,
  cancellationId: string
): Promise<void> {
  const { data: stampedCfds } = await supabase
    .from("cfdi_invoices")
    .select("id")
    .eq("booking_id", bookingId)
    .in("invoice_type", ["booking", "booking_installment"])
    .eq("status", "stamped");

  for (const cfdi of stampedCfds || []) {
    try {
      await supabase.functions.invoke("cancel-cfdi", {
        body: { cfdi_invoice_id: cfdi.id, motivo: "03", cancellation_id: cancellationId },
      });
    } catch (e) {
      console.error(`Error cancelling CFDI ${cfdi.id} for booking ${bookingId}:`, e);
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Fetch all bookings with active, non-completed payment plans
    const { data: bookings, error: fetchError } = await supabase
      .from("bookings")
      .select(`
        id, booking_code, user_id, status, payment_status, deposit_amount,
        service_charge, has_payment_plan, selected_date, selected_time,
        cancelled_at, tour_id,
        tours!inner(id, name, start_date, tour_type)
      `)
      .in("status", ["pending", "confirmed"])
      .eq("payment_status", "succeeded")
      .eq("has_payment_plan", true)
      .is("cancelled_at", null);

    if (fetchError) {
      console.error("Error fetching bookings:", fetchError);
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!bookings || bookings.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;
    let remindersSent = 0;
    let cancellationsProcessed = 0;

    for (const bookingRaw of bookings) {
      const booking = bookingRaw as any;
      const tour = booking.tours as any;

      // Check payment plan status
      const { data: plan } = await supabase
        .from("booking_payment_plans")
        .select("id, status")
        .eq("booking_id", booking.id)
        .maybeSingle();

      if (!plan || plan.status === "completed" || plan.status === "cancelled" || plan.status === "defaulted") {
        // defaulted plans are handled by process_payment_plan_deadlines; we only act on active plans
        // Actually we DO want to act on defaulted plans too — the tour deadline is independent of installment status
        if (!plan) continue;
        if (plan.status === "completed" || plan.status === "cancelled") continue;
      }

      // ── Calculate departure datetime (replicated from process-traveler-cancellation lines 104-130) ──
      let departureDateTime: Date;
      let tourStartDateForRecord: string | null = null;

      if (tour.tour_type === "receptivo") {
        const selectedDate = booking.selected_date as string | null;
        const selectedTime = (booking.selected_time as string | null) || "00:00:00";
        if (selectedDate) {
          departureDateTime = new Date(`${selectedDate}T${selectedTime}`);
          tourStartDateForRecord = selectedDate;
        } else if (tour.start_date) {
          departureDateTime = new Date(tour.start_date);
          tourStartDateForRecord = tour.start_date;
        } else {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          departureDateTime = tomorrow;
          tourStartDateForRecord = tomorrow.toISOString().split("T")[0];
        }
      } else {
        if (!tour.start_date) continue;
        departureDateTime = new Date(tour.start_date);
        tourStartDateForRecord = tour.start_date;
      }

      const daysBeforeTour = Math.ceil((departureDateTime.getTime() - now.getTime()) / msPerDay);

      // Skip if tour already started or passed
      if (daysBeforeTour <= 0) continue;

      // ── 20-day reminder window (19-20 days) ──────────────────────────────
      if (daysBeforeTour >= 19 && daysBeforeTour <= 20) {
        // Check if we already sent this notification for this booking
        const { data: existingNotif } = await supabase
          .from("notifications")
          .select("id")
          .eq("user_id", booking.user_id)
          .eq("type", "payment_plan_final_deadline_warning")
          .contains("data", { booking_id: booking.id })
          .limit(1)
          .maybeSingle();

        if (!existingNotif) {
          // Find the first pending installment to include in the reminder
          const { data: pendingInstallment } = await supabase
            .from("booking_payment_plan_installments")
            .select("id, installment_number, label, amount_due, amount_paid, penalty_applied, due_date")
            .eq("plan_id", plan.id)
            .in("status", ["pending", "overdue_grace", "overdue", "partially_paid"])
            .order("installment_number", { ascending: true })
            .limit(1)
            .maybeSingle();

          if (pendingInstallment) {
            // Calculate the 16-day deadline date
            const deadlineDate = new Date(departureDateTime);
            deadlineDate.setDate(deadlineDate.getDate() - 16);

            try {
              await fetch(`${supabaseUrl}/functions/v1/send-payment-plan-reminder`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${supabaseServiceKey}`,
                },
                body: JSON.stringify({
                  installment_id: pendingInstallment.id,
                  notification_type: "payment_plan_final_deadline_warning",
                  deadline_date: deadlineDate.toISOString(),
                }),
              }).catch((e) => console.error(`Error sending 20-day reminder for booking ${booking.id}:`, e));

              remindersSent++;
            } catch (e) {
              console.error(`Error sending 20-day reminder for booking ${booking.id}:`, e);
            }
          }
        }
      }

      // ── 16-day cancellation window (15-16 days) ──────────────────────────
      if (daysBeforeTour >= 15 && daysBeforeTour <= 16) {
        // Double-check booking is not already cancelled (race condition safety)
        if (booking.status === "cancelled" || booking.cancelled_at) continue;

        // ── Step 1: Calculate totalPaid (principal, no service charges) ──────
        let totalPaid = Number(booking.deposit_amount || 0);

        const { data: installments } = await supabase
          .from("booking_payment_plan_installments")
          .select("installment_number, amount_paid")
          .eq("booking_id", booking.id)
          .in("status", ["paid", "partially_paid"]);

        for (const inst of (installments || [])) {
          if ((inst as any).installment_number > 1) {
            totalPaid += Number((inst as any).amount_paid || 0);
          }
        }

        if (totalPaid <= 0) continue;

        // ── Step 2: Calculate totalServiceCharge (informational only) ────────
        let totalServiceCharge = Number(booking.service_charge || 0);

        const { data: ppTransactions } = await supabase
          .from("booking_payment_plan_transactions")
          .select("service_charge")
          .eq("booking_id", booking.id)
          .eq("status", "completed");

        for (const tx of (ppTransactions || [])) {
          totalServiceCharge += Number((tx as any).service_charge || 0);
        }

        // refundAmount = totalPaid directly (service charges are NOT subtracted —
        // booking_payment_plan_installments.amount_paid already excludes service charges)
        const refundAmount = Math.round(totalPaid * 100) / 100;

        // ── Step 3: Atomic cancellation + wallet refund via RPC ──────────────
        const refundDescription = `Reembolso por cancelación automática (plan de pagos no liquidado) — ${tour.name}`;

        const { data: rpcResult, error: rpcError } = await supabase.rpc("process_cancellation_refund", {
          p_booking_id: booking.id,
          p_refund_amount: refundAmount,
          p_reference_type: "payment_plan_auto_cancel",
          p_description: refundDescription,
          p_new_status: "cancelled",
          p_set_cancelled_at: true,
          p_cancellation_type: "payment_plan_auto_cancel",
          p_cancellation_refund_amount: refundAmount,
        });

        if (rpcError || !rpcResult?.success) {
          console.error(`Error in process_cancellation_refund for booking ${booking.id}:`, rpcError?.message || rpcResult?.error);
          continue;
        }

        const transactionId = rpcResult.transaction_id || null;

        // ── Step 4: Insert booking_cancellations record ──────────────────────
        const { data: cancellationRecord, error: cancellationError } = await supabase
          .from("booking_cancellations")
          .insert({
            booking_id: booking.id,
            cancelled_by_user_id: booking.user_id,
            cancelled_at: now.toISOString(),
            tour_start_date: tourStartDateForRecord,
            days_before_tour: daysBeforeTour,
            cancellation_policy_type: "payment_plan_auto_cancel",
            original_deposit_amount: totalPaid,
            original_service_charge: totalServiceCharge,
            total_principal_paid: totalPaid,
            refund_amount_to_traveler: refundAmount,
            amount_to_agency: 0,
            amount_to_platform: 0,
            toursred_cash_transaction_id: transactionId,
            refund_processed: refundAmount > 0,
            cancellation_reason: "Plan de pagos no liquidado a 16 días de la fecha del tour",
            service_charge_refunded_amount: 0,
            insurance_refund_amount: 0,
            optional_services_refund_amount: 0,
          })
          .select()
          .single();

        if (cancellationError) {
          console.error(`Error inserting booking_cancellations for booking ${booking.id}:`, cancellationError.message);
          continue;
        }

        // ── Step 5: Clawback loyalty points ──────────────────────────────────
        let pointsDeducted = 0;
        if (refundAmount > 0) {
          const { data: earnedPoints } = await supabase.rpc("get_earned_points_for_reference", {
            p_reference_id: booking.id,
            p_reference_type: "booking",
          });
          const pointsToDeduct = earnedPoints || 0;
          if (pointsToDeduct > 0) {
            try {
              const { error: deductErr } = await supabase.rpc("deduct_points", {
                p_user_id: booking.user_id,
                p_amount: pointsToDeduct,
                p_description: `Puntos revertidos por cancelación automática (plan no liquidado) — ${tour.name}`,
                p_reference_id: booking.id,
                p_reference_type: "payment_plan_auto_cancel",
              });
              if (deductErr) {
                console.error(`Error deducting points for booking ${booking.id}:`, deductErr);
              } else {
                pointsDeducted = pointsToDeduct;
              }
            } catch (e) {
              console.error(`Exception deducting points for booking ${booking.id}:`, e);
            }
          }
        }

        if (pointsDeducted > 0) {
          try {
            await markPointsAsClawedBack(supabase, booking.id, cancellationRecord.id, "automatica");
          } catch (e) {
            console.error(`Error marking points as clawed back for booking ${booking.id}:`, e);
          }
        }

        // ── Step 6: Mark payment plan as cancelled ───────────────────────────
        await supabase
          .from("booking_payment_plans")
          .update({ status: "cancelled" })
          .eq("id", plan.id);

        // ── Step 7: Cancel optional services (no service charge refund) ──────
        try {
          await supabase.rpc("cancel_booking_optional_services", {
            p_booking_id: booking.id,
            p_cancelled_by_agency: false,
            p_refund_service_charge: false,
          });
        } catch (e) {
          console.error(`Error cancelling optional services for booking ${booking.id}:`, e);
        }

        // ── Step 8: Cancel stamped CFDIs (motivo "03") ───────────────────────
        EdgeRuntime.waitUntil(
          cancelStampedCfds(supabase, booking.id, cancellationRecord.id)
        );

        // ── Step 9: Generate accounting entry ────────────────────────────────
        try {
          await supabase.rpc("create_accounting_entry_for_cancellation", {
            p_cancellation_id: cancellationRecord.id,
            p_cancellation_type: "full",
          });
        } catch (e) {
          console.error(`Error generating accounting entry for booking ${booking.id}:`, e);
        }

        // ── Step 10: Notify traveler ─────────────────────────────────────────
        const { data: traveler } = await supabase
          .from("users")
          .select("email, first_name")
          .eq("id", booking.user_id)
          .maybeSingle();

        if (traveler?.email) {
          // In-app notification
          await supabase.from("notifications").insert({
            user_id: booking.user_id,
            type: "payment_plan_auto_cancelled",
            title: `Reserva cancelada por falta de pago — ${tour.name}`,
            message: `Tu reserva ${booking.booking_code} fue cancelada automáticamente porque tu plan de pagos no estaba liquidado a 16 días de la fecha del tour. Se reembolsaron $${refundAmount.toFixed(2)} MXN a tu monedero ToursRed Cash.`,
            data: {
              booking_id: booking.id,
              booking_code: booking.booking_code,
              cancellation_id: cancellationRecord.id,
              refund_amount: refundAmount,
            },
          }).catch((e) => console.error(`Error inserting notification for booking ${booking.id}:`, e));

          // Email notification
          const { data: emailSettings } = await supabase
            .from("platform_settings")
            .select("platform_url")
            .maybeSingle();

          const appUrl = (emailSettings as any)?.platform_url || "https://toursredmx.netlify.app";

          EdgeRuntime.waitUntil(
            fetch(`${supabaseUrl}/functions/v1/send-email`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({
                to: traveler.email,
                subject: `Reserva cancelada por falta de pago — ${tour.name}`,
                html: `
                  <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2>Tu reserva fue cancelada automáticamente</h2>
                    <p>Hola ${traveler.first_name},</p>
                    <p>Tu reserva <strong>${booking.booking_code}</strong> para el tour <strong>${tour.name}</strong> fue cancelada porque tu plan de pagos no estaba liquidado a 16 días de la fecha de salida.</p>
                    <p>Se reembolsaron <strong>$${refundAmount.toFixed(2)} MXN</strong> a tu monedero de ToursRed Cash. Los cargos de servicio no son reembolsables.</p>
                    <p>Si crees que esto es un error, contacta a soporte.</p>
                    <br>
                    <a href="${appUrl}/traveler/wallet"
                       style="background: #0ea5e9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
                      Ver mi monedero
                    </a>
                  </div>
                `,
              }),
            }).catch(() => {})
          );
        }

        cancellationsProcessed++;
        console.log(`Booking ${booking.id} auto-cancelled (payment plan not completed, ${daysBeforeTour} days before tour)`);
      }
    }

    console.log(`process-payment-plan-tour-deadline: reminders=${remindersSent}, cancellations=${cancellationsProcessed}`);

    return new Response(JSON.stringify({
      processed: bookings.length,
      reminders_sent: remindersSent,
      cancellations_processed: cancellationsProcessed,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("Error in process-payment-plan-tour-deadline:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
