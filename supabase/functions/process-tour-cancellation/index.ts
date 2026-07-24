import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { markPointsAsClawedBack } from "../_shared/pointsTraceability.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) throw new Error("Invalid user token");

    const { tour_id, cancellation_reason } = await req.json();
    if (!tour_id || !cancellation_reason) throw new Error("Missing required fields");
    if (cancellation_reason.trim().length < 50) throw new Error("El motivo de cancelación debe tener al menos 50 caracteres");

    const { data: tour, error: tourError } = await supabase
      .from("tours")
      .select("*, agency:agencies!tours_agency_id_fkey(id, user_id, name, contact_email)")
      .eq("id", tour_id)
      .single();

    if (tourError || !tour) throw new Error("Tour no encontrado");
    if (tour.agency.user_id !== user.id) throw new Error("No tienes permiso para cancelar este tour");
    if (tour.cancelled_by_agency) throw new Error("Este tour ya fue cancelado por la agencia");

    const tourStartDate = new Date(tour.start_date);
    const now = new Date();
    tourStartDate.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);
    if (tourStartDate <= now) throw new Error("No se puede cancelar un tour que ya inició o está en curso");

    const { data: activeBookings, error: bookingsError } = await supabase
      .from("bookings")
      .select("*, user:users!bookings_user_id_fkey(id, first_name, last_name, email)")
      .eq("tour_id", tour_id)
      .in("status", ["confirmed", "pending"])
      .eq("payment_status", "succeeded")
      .is("cancelled_at", null);

    if (bookingsError) throw new Error("Error al obtener reservas");
    if (!activeBookings || activeBookings.length === 0) throw new Error("No hay reservas activas para cancelar en este tour");

    const { data: cancellationRecord, error: cancellationError } = await supabase
      .from("tour_cancellations")
      .insert({
        tour_id, agency_id: tour.agency_id, cancelled_by_user_id: user.id,
        cancellation_reason: cancellation_reason.trim(), original_tour_date: tour.start_date,
        affected_bookings_count: activeBookings.length,
      })
      .select()
      .single();

    if (cancellationError || !cancellationRecord) throw new Error("Error al crear el registro de cancelación");

    let totalRefunded = 0;
    let successfulRefunds = 0;
    const failedRefunds: string[] = [];

    for (const booking of activeBookings) {
      try {
        // ============================================================
        // Calculate refund — agency always refunds EVERYTHING
        // including service charge and payment plan installments
        // ============================================================
        const originalDepositAmount = Number(booking.deposit_amount || 0);
        let originalServiceCharge = Number(booking.service_charge || 0);

        let installmentsPaid = 0;
        if ((booking as any).has_payment_plan) {
          const { data: installments } = await supabase
            .from("booking_payment_plan_installments")
            .select("installment_number, amount_paid")
            .eq("booking_id", booking.id)
            .in("status", ["paid", "partially_paid"]);

          for (const inst of (installments || [])) {
            if ((inst as any).installment_number > 1) {
              installmentsPaid += Number((inst as any).amount_paid || 0);
            }
          }

          const { data: ppTransactions } = await supabase
            .from("booking_payment_plan_transactions")
            .select("service_charge")
            .eq("booking_id", booking.id)
            .eq("status", "completed");

          for (const tx of (ppTransactions || [])) {
            originalServiceCharge += Number((tx as any).service_charge || 0);
          }
        }
        const principalPaid = originalDepositAmount + installmentsPaid;

        const insuranceRefund = (booking as any).travel_insurance_included
          ? Number((booking as any).travel_insurance_cost || 0) : 0;

        const { data: optionalServicesData } = await supabase
          .from("booking_optional_services")
          .select("subtotal, service_charge, total_paid")
          .eq("booking_id", booking.id)
          .eq("is_cancelled", false);

        let optionalServicesRefundable = 0;
        let optionalServicesServiceCharge = 0;
        for (const bos of (optionalServicesData || [])) {
          optionalServicesRefundable += Number((bos as any).total_paid || (bos as any).subtotal || 0);
          optionalServicesServiceCharge += Number((bos as any).service_charge || 0);
        }

        const refundAmount = principalPaid + originalServiceCharge + insuranceRefund + optionalServicesRefundable;

        // Get or create wallet
        let { data: wallet } = await supabase
          .from("toursred_cash_wallets")
          .select("*")
          .eq("user_id", booking.user_id)
          .maybeSingle();

        if (!wallet) {
          const { data: newWallet, error: walletError } = await supabase
            .from("toursred_cash_wallets")
            .insert({ user_id: booking.user_id, balance: 0, currency: "MXN" })
            .select()
            .single();
          if (walletError || !newWallet) throw new Error("Error creando wallet");
          wallet = newWallet;
        }

        const newBalance = Number(wallet.balance) + refundAmount;

        const { error: transactionError } = await supabase
          .from("toursred_cash_transactions")
          .insert({
            wallet_id: wallet.id, user_id: booking.user_id, amount: refundAmount,
            balance_after: newBalance, type: "refund",
            description: `Reembolso completo por cancelación del tour: ${tour.name}`,
            reference_id: cancellationRecord.id, reference_type: "tour_cancellation",
          });
        if (transactionError) throw new Error("Error creando transacción");

        const { error: walletUpdateError } = await supabase
          .from("toursred_cash_wallets")
          .update({ balance: newBalance })
          .eq("id", wallet.id);
        if (walletUpdateError) throw new Error("Error actualizando balance");

        // Create booking_cancellations record with correct amounts
        const { data: bookingCancellationRecord } = await supabase
          .from("booking_cancellations")
          .insert({
            booking_id: booking.id, cancelled_by_user_id: user.id, cancelled_at: new Date().toISOString(),
            tour_start_date: tour.start_date,
            days_before_tour: Math.floor((tourStartDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
            cancellation_policy_type: "100_percent",
            original_deposit_amount: principalPaid, original_service_charge: originalServiceCharge + optionalServicesServiceCharge,
            total_principal_paid: principalPaid, refund_amount_to_traveler: refundAmount,
            amount_to_agency: 0, amount_to_platform: 0, refund_processed: true,
            cancelled_by_agency: true,
            cancellation_reason: `Cancelación de tour completo por agencia: ${cancellation_reason.trim()}`,
            service_charge_refunded_amount: originalServiceCharge + optionalServicesServiceCharge,
          })
          .select()
          .maybeSingle();

        // Cancel optional services (agency cancellation: refund everything including service charge)
        try {
          await supabase.rpc("cancel_booking_optional_services", {
            p_booking_id: booking.id,
            p_cancelled_by_agency: true,
            p_refund_service_charge: true,
          });
        } catch (rpcErr) {
          console.error("Error cancelling optional services (tour cancellation):", rpcErr);
        }

        // Update booking status
        const { error: bookingUpdateError } = await supabase
          .from("bookings")
          .update({
            status: "cancelled", cancelled_at: new Date().toISOString(),
            cancellation_type: "agency_cancellation", cancellation_refund_amount: refundAmount,
            agency_cancellation_id: cancellationRecord.id,
          })
          .eq("id", booking.id);
        if (bookingUpdateError) throw new Error("Error actualizando reserva");

        // Refund paid supplements
        const { data: paidSupplements } = await supabase
          .from("booking_supplements")
          .select("id, total_paid, tour_supplements(name)")
          .eq("booking_id", booking.id)
          .eq("status", "paid");

        if (paidSupplements && paidSupplements.length > 0) {
          for (const sup of paidSupplements) {
            const supRefundAmount = Number(sup.total_paid) || 0;
            if (supRefundAmount <= 0) continue;

            const { data: updatedWallet } = await supabase
              .from("toursred_cash_wallets")
              .select("id, balance")
              .eq("user_id", booking.user_id)
              .maybeSingle();

            const walletId = updatedWallet?.id || wallet.id;
            const currentBalance = updatedWallet?.balance ?? wallet.balance ?? 0;
            const newSupBalance = Number(currentBalance) + supRefundAmount;

            await supabase.from("toursred_cash_transactions").insert({
              wallet_id: walletId, user_id: booking.user_id, amount: supRefundAmount,
              balance_after: newSupBalance, type: "refund",
              description: `Reembolso suplemento "${(sup.tour_supplements as any)?.name}" por cancelación del tour: ${tour.name}`,
              reference_id: sup.id, reference_type: "supplement_cancellation",
            });
            await supabase.from("toursred_cash_wallets").update({ balance: newSupBalance }).eq("id", walletId);

            await supabase.from("booking_supplements").update({
              status: "cancelled", cancelled_at: new Date().toISOString(),
              cancelled_by: "tour_cancellation", refund_amount: supRefundAmount, updated_at: new Date().toISOString(),
            }).eq("id", sup.id);

            totalRefunded += supRefundAmount;
          }
        }

        // Deduct points — 1 peso = 1 punto
        if (refundAmount > 0) {
          const pointsToDeduct = Math.floor(refundAmount);
          if (pointsToDeduct > 0) {
            try {
              const { error: deductErr } = await supabase.rpc("deduct_points", {
                p_user_id: booking.user_id,
                p_amount: pointsToDeduct,
                p_description: `Puntos revertidos por cancelación de tour - ${tour.name}`,
                p_reference_id: booking.id,
                p_reference_type: "tour_cancellation",
              });
              if (deductErr) console.error("Error deducting points (tour cancellation):", deductErr);
              else await markPointsAsClawedBack(supabase, booking.id, bookingCancellationRecord?.id || null, "tour_cancellation");
            } catch (e: unknown) {
              console.error("Exception deducting points (tour cancellation):", e);
            }
          }
        }

        // Generate accounting entry
        if (bookingCancellationRecord) {
          try {
            await supabase.rpc("create_accounting_entry_for_cancellation", {
              p_cancellation_id: bookingCancellationRecord.id,
              p_cancellation_type: "agency_booking",
            });
          } catch (accountingError) {
            console.error("Error generando póliza contable para reserva:", booking.id, accountingError);
          }

          // Cancel stamped CFDIs (async, non-blocking)
          EdgeRuntime.waitUntil(
            cancelStampedCfds(supabase, booking.id, bookingCancellationRecord.id)
          );
        }

        totalRefunded += refundAmount;
        successfulRefunds++;

        try {
          await supabase.functions.invoke("send-agency-cancellation-notification-traveler", {
            body: { booking_id: booking.id, tour_cancellation_id: cancellationRecord.id },
          });
        } catch (emailError) {
          console.error("Error sending email to traveler:", emailError);
        }

        await supabase.from("notifications").insert({
          user_id: booking.user_id, type: "system_announcement",
          title: "Tour Cancelado por la Agencia",
          message: `El tour "${tour.name}" ha sido cancelado por la agencia. Has recibido un reembolso completo de $${refundAmount.toFixed(2)} en tu ToursRed Cash.`,
          data: { booking_id: booking.id, tour_id, tour_cancellation_id: cancellationRecord.id, refund_amount: refundAmount },
        });

      } catch (err) {
        console.error("Error processing refund for booking:", booking.id, err);
        failedRefunds.push(booking.id);
      }
    }

    await supabase.from("tour_cancellations").update({
      total_refunded_amount: totalRefunded, emails_sent_to_travelers: successfulRefunds,
    }).eq("id", cancellationRecord.id);

    await supabase.from("tours").update({
      cancelled_by_agency: true, agency_cancellation_id: cancellationRecord.id,
    }).eq("id", tour_id);

    try {
      await supabase.functions.invoke("send-agency-cancellation-notification-admin", {
        body: { tour_cancellation_id: cancellationRecord.id },
      });
      await supabase.from("tour_cancellations").update({ admin_email_sent: true }).eq("id", cancellationRecord.id);
    } catch (adminEmailError) {
      console.error("Error sending admin email:", adminEmailError);
    }

    return new Response(JSON.stringify({
      success: true, cancellation_id: cancellationRecord.id,
      affected_bookings: activeBookings.length, successful_refunds: successfulRefunds,
      failed_refunds: failedRefunds.length, total_refunded: totalRefunded,
      message: `Tour cancelado exitosamente. ${successfulRefunds} reservas fueron reembolsadas.`,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: any) {
    console.error("Error in process-tour-cancellation:", error);
    return new Response(JSON.stringify({ success: false, error: error.message || "Error al procesar la cancelación del tour" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
