import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { markPointsAsClawedBack } from "../_shared/pointsTraceability.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

    // Validate auth and identify the calling traveler
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return err("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return err("Token inválido");

    const { booking_id, cancellation_reason } = await req.json();
    if (!booking_id) return err("booking_id es requerido");

    // Load booking + tour fields + insurance fields needed for policy calculation
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        id, status, payment_status, deposit_amount, service_charge,
        user_id, tour_id, agency_id, booking_code, cancelled_at,
        is_no_show, approval_status, selected_date, selected_time,
        travel_insurance_included, travel_insurance_cost,
        tours!bookings_tour_id_fkey(
          id, name, tour_type, start_date,
          cancellation_not_allowed,
          flexible_hours, flexible_refund_percentage,
          moderate_hours, moderate_refund_percentage
        )
      `)
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError || !booking) return err("Reserva no encontrada");

    // Security: only the booking owner can cancel
    if (booking.user_id !== user.id) return err("No tienes permiso para cancelar esta reserva");

    // Eligibility checks
    if (booking.cancelled_at || booking.status === "cancelled") return err("Esta reserva ya fue cancelada");
    if ((booking as any).is_no_show) return err("Esta reserva está marcada como No Show y no puede cancelarse");
    if ((booking as any).approval_status === "rejected") return err("Esta reserva fue rechazada y no puede cancelarse");
    if (!["pending", "confirmed"].includes(booking.status)) return err("Solo se pueden cancelar reservas pendientes o confirmadas");

    const tour = (booking as any).tours as any;
    if (!tour) return err("Información del tour no encontrada");

    const isPending = (booking as any).approval_status === "pending";
    const isReceptivo = tour.tour_type === "receptivo";

    // Determine departure datetime for policy calculation
    let departureDateTime: Date;
    let tourStartDateForRecord: string | null = null;

    if (isReceptivo) {
      const selectedDate = (booking as any).selected_date as string | null;
      const selectedTime = ((booking as any).selected_time as string | null) || "00:00:00";
      if (selectedDate) {
        departureDateTime = new Date(`${selectedDate}T${selectedTime}`);
        tourStartDateForRecord = selectedDate;
      } else if (tour.start_date) {
        departureDateTime = new Date(tour.start_date);
        tourStartDateForRecord = tour.start_date;
      } else {
        // No date available: use tomorrow as a safe fallback so the cancellation proceeds
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        departureDateTime = tomorrow;
        tourStartDateForRecord = tomorrow.toISOString().split("T")[0];
      }
    } else {
      if (!tour.start_date) return err("El tour no tiene fecha de inicio configurada");
      departureDateTime = new Date(tour.start_date);
      tourStartDateForRecord = tour.start_date;
    }

    const now = new Date();
    const millisecondsPerHour = 1000 * 60 * 60;
    const hoursBeforeTour = (departureDateTime.getTime() - now.getTime()) / millisecondsPerHour;
    const daysBeforeTour = Math.ceil(hoursBeforeTour / 24);

    // Validate tour hasn't started
    if (hoursBeforeTour <= 0) return err("No se puede cancelar una reserva de un tour que ya inició o ha pasado");

    // Fetch platform commission rate
    const { data: platformSettings } = await supabase
      .from("platform_settings")
      .select("agency_commission_percentage")
      .maybeSingle();
    const commissionRate = ((platformSettings as any)?.agency_commission_percentage || 15) / 100;

    const originalDepositAmount = Number((booking as any).deposit_amount || 0);
    let originalServiceCharge = Number((booking as any).service_charge || 0);

    // When has_payment_plan, installment 1 ("Anticipo") already represents the
    // deposit — adding deposit_amount on top would double-count it.
    let installmentsPaid = 0;
    if ((booking as any).has_payment_plan) {
      const { data: installments } = await supabase
        .from("booking_payment_plan_installments")
        .select("installment_number, amount_paid")
        .eq("booking_id", booking_id)
        .in("status", ["paid", "partially_paid"]);
      for (const inst of (installments || [])) {
        if ((inst as any).installment_number > 1) {
          installmentsPaid += Number((inst as any).amount_paid || 0);
        }
      }

      // Add service charges from completed payment plan transactions
      const { data: ppTransactions } = await supabase
        .from("booking_payment_plan_transactions")
        .select("service_charge")
        .eq("booking_id", booking_id)
        .eq("status", "completed");
      for (const tx of (ppTransactions || [])) {
        originalServiceCharge += Number((tx as any).service_charge || 0);
      }
    }
    const principalPaid = originalDepositAmount + installmentsPaid;

    // BUG FIX 1: include travel insurance in refund calculation
    const insuranceRefund = (booking as any).travel_insurance_included
      ? Number((booking as any).travel_insurance_cost || 0)
      : 0;

    // Fetch optional services
    const { data: optionalServicesData } = await supabase
      .from("booking_optional_services")
      .select("subtotal, tour_optional_service_id, tour_optional_services(is_refundable)")
      .eq("booking_id", booking_id)
      .eq("is_cancelled", false);

    let optionalServicesRefundable = 0;
    for (const bos of (optionalServicesData || [])) {
      const isRefundable = (bos as any).tour_optional_services?.is_refundable !== false;
      if (isRefundable) optionalServicesRefundable += Number((bos as any).subtotal || 0);
    }

    // Calculate cancellation policy
    let policyType: string;
    let refundPct: number;
    let penaltyAmount: number;

    if (isPending) {
      policyType = "pending_approval";
      refundPct = 1;
      penaltyAmount = 0;
    } else if (tour.cancellation_not_allowed) {
      policyType = "no_refund";
      refundPct = 0;
      penaltyAmount = principalPaid;
    } else {
      const flexibleHours = Number(tour.flexible_hours ?? 48);
      const flexibleRefundPct = Number(tour.flexible_refund_percentage ?? 100) / 100;
      const moderateHours = Number(tour.moderate_hours ?? 24);
      const moderateRefundPct = Number(tour.moderate_refund_percentage ?? 50) / 100;

      if (hoursBeforeTour >= flexibleHours) {
        refundPct = flexibleRefundPct;
        penaltyAmount = principalPaid * (1 - flexibleRefundPct);
        policyType = flexibleRefundPct >= 1 ? "100_percent" : "50_percent";
      } else if (hoursBeforeTour >= moderateHours) {
        refundPct = moderateRefundPct;
        penaltyAmount = principalPaid * (1 - moderateRefundPct);
        policyType = moderateRefundPct > 0 ? "50_percent" : "no_refund";
      } else {
        refundPct = 0;
        penaltyAmount = principalPaid;
        policyType = "no_refund";
      }
    }

    const principalRefund = principalPaid * refundPct;
    // BUG FIX 1: sum insurance refund into total
    const refundAmountToTraveler = principalRefund + optionalServicesRefundable + insuranceRefund;
    // Penalty split: 60% to agency, 40% to platform (only applies when penaltyAmount > 0)
    const PENALTY_AGENCY_SHARE = 0.60;
    const PENALTY_PLATFORM_SHARE = 0.40;
    const amountToAgency = penaltyAmount * PENALTY_AGENCY_SHARE;
    const amountToPlatform = penaltyAmount * PENALTY_PLATFORM_SHARE;

    // Cancel optional services
    await supabase.rpc("cancel_booking_optional_services", {
      p_booking_id: booking_id,
      p_cancelled_by_agency: false,
    });

    // Process refund to ToursRed Cash wallet if there's a refund
    let transactionId: string | null = null;
    if (refundAmountToTraveler > 0) {
      let { data: wallet } = await supabase
        .from("toursred_cash_wallets")
        .select("*")
        .eq("user_id", booking.user_id)
        .maybeSingle();

      if (!wallet) {
        const { data: newWallet, error: walletCreateError } = await supabase
          .from("toursred_cash_wallets")
          .insert({ user_id: booking.user_id, balance: 0, currency: "MXN" })
          .select()
          .single();
        if (walletCreateError || !newWallet) throw new Error("Error creando wallet del viajero");
        wallet = newWallet;
      }

      const newBalance = Number(wallet.balance) + refundAmountToTraveler;

      // Build description with all refund components
      const descParts: string[] = [];
      if (optionalServicesRefundable > 0) descParts.push(`servicios opcionales $${optionalServicesRefundable.toFixed(2)}`);
      if (insuranceRefund > 0) descParts.push(`seguro de viaje $${insuranceRefund.toFixed(2)}`);
      const descSuffix = descParts.length > 0 ? ` (incluye ${descParts.join(", ")})` : "";

      const { data: transaction, error: txError } = await supabase
        .from("toursred_cash_transactions")
        .insert({
          wallet_id: wallet.id,
          user_id: booking.user_id,
          amount: refundAmountToTraveler,
          balance_after: newBalance,
          type: "refund",
          description: `Reembolso por cancelación - ${tour.name}${descSuffix}`,
          reference_id: booking_id,
          reference_type: "booking_cancellation",
        })
        .select()
        .single();

      if (txError || !transaction) throw new Error("Error creando transacción de reembolso");
      transactionId = transaction.id;

      const { error: walletUpdateError } = await supabase
        .from("toursred_cash_wallets")
        .update({ balance: newBalance })
        .eq("id", wallet.id);
      if (walletUpdateError) throw new Error("Error actualizando balance del wallet");
    }

    // BUG FIX 2: tour_start_date is NOT NULL — always provide a valid date
    // tourStartDateForRecord is guaranteed non-null from the logic above
    const { data: cancellationRecord, error: cancellationError } = await supabase
      .from("booking_cancellations")
      .insert({
        booking_id: booking_id,
        cancelled_by_user_id: user.id,
        cancelled_at: now.toISOString(),
        tour_start_date: tourStartDateForRecord,
        days_before_tour: daysBeforeTour,
        cancellation_policy_type: policyType,
        original_deposit_amount: originalDepositAmount,
        original_service_charge: originalServiceCharge,
        total_principal_paid: principalPaid,
        refund_amount_to_traveler: refundAmountToTraveler,
        amount_to_agency: amountToAgency,
        amount_to_platform: amountToPlatform,
        toursred_cash_transaction_id: transactionId,
        refund_processed: refundAmountToTraveler > 0,
        cancellation_reason: cancellation_reason || null,
      })
      .select()
      .single();

    if (cancellationError) {
      console.error("Error registrando booking_cancellations:", JSON.stringify(cancellationError));
      throw new Error(`Error registrando cancelación: ${cancellationError.message}`);
    }

    // Bug 3 fix: deducir puntos — 1 peso = 1 punto, una sola llamada a deduct_points
    let pointsDeducted = 0;
    if (refundAmountToTraveler > 0) {
      const pointsToDeduct = Math.floor(refundAmountToTraveler);
      if (pointsToDeduct > 0) {
        try {
          const { error: deductErr } = await supabase.rpc("deduct_points", {
            p_user_id: booking.user_id,
            p_amount: pointsToDeduct,
            p_description: `Puntos revertidos por cancelación self-service - ${tour.name}`,
            p_reference_id: booking_id,
            p_reference_type: "traveler_cancellation",
          });
          if (deductErr) {
            console.error("Error deducting points (traveler cancellation):", deductErr);
          } else {
            pointsDeducted = pointsToDeduct;
          }
        } catch (e: unknown) {
          console.error("Exception deducting points (traveler cancellation):", e);
        }
      }
    }

    // Cierre de trazabilidad: registros clawback amount=0 por fuente
    if (pointsDeducted > 0) {
      await markPointsAsClawedBack(supabase, booking_id, cancellationRecord.id, "self-service");
    }

    // BUG FIX 2: update booking status — log error explicitly if it fails
    const { error: updateBookingError } = await supabase
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_at: now.toISOString(),
        cancellation_type: policyType,
        cancellation_refund_amount: refundAmountToTraveler,
      })
      .eq("id", booking_id);

    if (updateBookingError) {
      console.error("Error actualizando bookings a cancelled:", JSON.stringify(updateBookingError));
      throw new Error(`Error actualizando reserva: ${updateBookingError.message}`);
    }

    // Explicit audit log — DB trigger uses auth.uid() which is null under service role
    Promise.resolve(supabase.rpc("insert_audit_log", {
      p_tenant_type: "traveler",
      p_actor_id: user.id,
      p_actor_email: user.email ?? null,
      p_actor_role: "traveler",
      p_target_id: booking_id,
      p_target_table: "bookings",
      p_action: "cancel",
      p_severity: "medium",
      p_old_values: { status: booking.status },
      p_new_values: { status: "cancelled", cancellation_type: policyType },
      p_metadata: { cancellation_id: cancellationRecord.id, policy_type: policyType },
    })).catch((e: unknown) => console.error("Error insertando audit log:", e));

    // Create penalty record if applicable
    if (penaltyAmount > 0 && (policyType === "50_percent" || policyType === "no_refund")) {
      const { error: penaltyError } = await supabase
        .from("cancellation_penalty_records")
        .insert({
          booking_id: booking_id,
          agency_id: (booking as any).agency_id,
          tour_id: (booking as any).tour_id,
          cancellation_type: "full",
          cancellation_id: cancellationRecord.id,
          cancellation_policy_type: policyType,
          original_booking_amount: originalDepositAmount,
          gross_penalty: penaltyAmount,
          agency_net_amount: amountToAgency,
          platform_amount: amountToPlatform,
          status: "pending",
        });
      if (penaltyError) {
        console.error("Error creando cancellation_penalty_record:", penaltyError.message);
      }
    }

    // Generate accounting entry (awaited — fire-and-forget may not execute before response is sent)
    if (policyType === "50_percent" || policyType === "no_refund") {
      try {
        const { error: accErr } = await supabase.rpc("create_accounting_entry_for_cancellation", {
          p_cancellation_id: cancellationRecord.id,
          p_cancellation_type: "full",
        });
        if (accErr) console.error("Error generando póliza de cancelación:", accErr.message);
      } catch (e: unknown) {
        console.error("Excepción generando póliza de cancelación:", e);
      }
    }

    // Send notifications (fire-and-forget)
    const notificationBody = {
      booking_id: booking_id,
      cancellation_id: cancellationRecord.id,
    };
    supabase.functions.invoke("send-cancellation-notification-traveler", { body: notificationBody })
      .catch((e: unknown) => console.error("Error enviando email viajero:", e));
    supabase.functions.invoke("send-cancellation-notification-agency", { body: notificationBody })
      .catch((e: unknown) => console.error("Error enviando email agencia:", e));
    supabase.functions.invoke("send-cancellation-notification-admin", { body: notificationBody })
      .catch((e: unknown) => console.error("Error enviando email admin:", e));

    return ok({
      success: true,
      cancellation_id: cancellationRecord.id,
      refund_amount: refundAmountToTraveler,
      refund_percentage: Math.round(refundPct * 100),
      policy_type: policyType,
      days_before_tour: daysBeforeTour,
      points_deducted: pointsDeducted,
    });

  } catch (error: any) {
    console.error("process-traveler-cancellation error:", error);
    return err(error.message || "Error al procesar la cancelación");
  }
});
