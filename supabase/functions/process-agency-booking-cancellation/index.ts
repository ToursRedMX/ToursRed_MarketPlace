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
    if (!authHeader) return err("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return err("Token inválido");

    const { booking_id, cancellation_reason } = await req.json();
    if (!booking_id) return err("booking_id es requerido");

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        id, status, deposit_amount, service_charge,
        user_id, tour_id, agency_id, booking_code, cancelled_at,
        has_payment_plan, travel_insurance_included, travel_insurance_cost,
        tours!bookings_tour_id_fkey(id, name, start_date)
      `)
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError || !booking) return err("Reserva no encontrada");

    const tour = (booking as any).tours as any;
    if (!tour) return err("Información del tour no encontrada");

    // Security: verify the caller belongs to the agency that owns this tour
    const { data: agency } = await supabase
      .from("agencies")
      .select("id, user_id")
      .eq("id", booking.agency_id)
      .maybeSingle();

    if (!agency || agency.user_id !== user.id) {
      return err("No tienes permiso para cancelar esta reserva");
    }

    if (booking.cancelled_at || booking.status === "cancelled") return err("Esta reserva ya fue cancelada");
    if (booking.status === "cancellation_processing") return err("Esta reserva ya tiene una cancelación en proceso");
    if (!["pending", "confirmed"].includes(booking.status)) return err("Solo se pueden cancelar reservas pendientes o confirmadas");

    const tourStartDate = new Date(tour.start_date);
    const now = new Date();
    tourStartDate.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);
    const daysBeforeTour = Math.floor((tourStartDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    // ============================================================
    // Calculate refund amounts — agency always refunds EVERYTHING
    // including service charge and payment plan installments
    // ============================================================
    const originalDepositAmount = Number(booking.deposit_amount || 0);
    let originalServiceCharge = Number(booking.service_charge || 0);

    // Include payment plan installments (installment_number > 1)
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

    // Insurance refund
    const insuranceRefund = (booking as any).travel_insurance_included
      ? Number((booking as any).travel_insurance_cost || 0)
      : 0;

    // Optional services refund
    const { data: optionalServicesData } = await supabase
      .from("booking_optional_services")
      .select("subtotal, service_charge, total_paid, tour_optional_services(is_refundable)")
      .eq("booking_id", booking_id)
      .eq("is_cancelled", false);

    let optionalServicesRefundable = 0;
    let optionalServicesServiceCharge = 0;
    for (const bos of (optionalServicesData || [])) {
      optionalServicesRefundable += Number((bos as any).total_paid || (bos as any).subtotal || 0);
      optionalServicesServiceCharge += Number((bos as any).service_charge || 0);
    }

    // Total refund = principal + service charge + insurance + optionals
    const refundAmount = principalPaid + originalServiceCharge + insuranceRefund + optionalServicesRefundable;

    // Process refund to ToursRed Cash wallet
    let wallet = await supabase
      .from("toursred_cash_wallets")
      .select("*")
      .eq("user_id", booking.user_id)
      .maybeSingle();

    if (!wallet.data) {
      const { data: newWallet, error: walletError } = await supabase
        .from("toursred_cash_wallets")
        .insert({ user_id: booking.user_id, balance: 0, currency: "MXN" })
        .select()
        .single();

      if (walletError || !newWallet) throw new Error("Error creando wallet");
      wallet.data = newWallet;
    }

    let transactionId: string | null = null;
    if (refundAmount > 0) {
      const newBalance = Number(wallet.data.balance) + refundAmount;

      const descParts: string[] = [];
      if (originalServiceCharge > 0) descParts.push(`cargo de servicio $${originalServiceCharge.toFixed(2)}`);
      if (insuranceRefund > 0) descParts.push(`seguro $${insuranceRefund.toFixed(2)}`);
      if (optionalServicesRefundable > 0) descParts.push(`opcionales $${optionalServicesRefundable.toFixed(2)}`);
      const descSuffix = descParts.length > 0 ? ` (incluye ${descParts.join(", ")})` : "";

      const { data: transaction, error: txError } = await supabase
        .from("toursred_cash_transactions")
        .insert({
          wallet_id: wallet.data.id,
          user_id: booking.user_id,
          amount: refundAmount,
          balance_after: newBalance,
          type: "refund",
          description: `Reembolso completo por cancelación de agencia - ${tour.name}${descSuffix}`,
          reference_id: booking_id,
          reference_type: "agency_booking_cancellation",
        })
        .select()
        .single();

      if (txError || !transaction) throw new Error("Error creando transacción de reembolso");
      transactionId = transaction.id;

      const { error: walletUpdateError } = await supabase
        .from("toursred_cash_wallets")
        .update({ balance: newBalance })
        .eq("id", wallet.data.id);
      if (walletUpdateError) throw new Error("Error actualizando balance del wallet");
    }

    // Cancel optional services
    await supabase.rpc("cancel_booking_optional_services", {
      p_booking_id: booking_id,
      p_cancelled_by_agency: true,
      p_refund_service_charge: true,
    });

    // Create booking_cancellations record with correct amounts
    const { data: cancellationRecord, error: cancellationError } = await supabase
      .from("booking_cancellations")
      .insert({
        booking_id,
        cancelled_by_user_id: user.id,
        cancelled_at: new Date().toISOString(),
        tour_start_date: tour.start_date,
        days_before_tour: daysBeforeTour,
        cancellation_policy_type: "100_percent",
        original_deposit_amount: principalPaid,
        original_service_charge: originalServiceCharge + optionalServicesServiceCharge,
        total_principal_paid: principalPaid,
        refund_amount_to_traveler: refundAmount,
        amount_to_agency: 0,
        amount_to_platform: 0,
        toursred_cash_transaction_id: transactionId,
        refund_processed: refundAmount > 0,
        cancelled_by_agency: true,
        agency_cancellation_reason: cancellation_reason || "Cancelación por agencia",
        service_charge_refunded_amount: originalServiceCharge + optionalServicesServiceCharge,
      })
      .select()
      .single();

    if (cancellationError) {
      throw new Error(`Error registrando cancelación: ${cancellationError.message}`);
    }

    // Deduct points — 1 peso = 1 punto
    let pointsDeducted = 0;
    if (refundAmount > 0) {
      const pointsToDeduct = Math.floor(refundAmount);
      if (pointsToDeduct > 0) {
        try {
          const { error: deductErr } = await supabase.rpc("deduct_points", {
            p_user_id: booking.user_id,
            p_amount: pointsToDeduct,
            p_description: `Puntos revertidos por cancelación de agencia - ${tour.name}`,
            p_reference_id: booking_id,
            p_reference_type: "agency_booking_cancellation",
          });
          if (deductErr) {
            console.error("Error deducting points (agency cancellation):", deductErr);
          } else {
            pointsDeducted = pointsToDeduct;
          }
        } catch (e: unknown) {
          console.error("Exception deducting points (agency cancellation):", e);
        }
      }
    }

    if (pointsDeducted > 0) {
      await markPointsAsClawedBack(supabase, booking_id, cancellationRecord.id, "agency_cancellation");
    }

    // Update booking status
    const { error: updateBookingError } = await supabase
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancellation_type: "agency_cancellation",
        cancellation_refund_amount: refundAmount,
      })
      .eq("id", booking_id);

    if (updateBookingError) {
      throw new Error(`Error actualizando reserva: ${updateBookingError.message}`);
    }

    // Generate accounting entry
    try {
      await supabase.rpc("create_accounting_entry_for_cancellation", {
        p_cancellation_id: cancellationRecord.id,
        p_cancellation_type: "agency_booking",
      });
    } catch (accountingError) {
      console.error("Error generando póliza contable:", accountingError);
    }

    // Cancel stamped CFDIs (async, non-blocking)
    EdgeRuntime.waitUntil(
      cancelStampedCfds(supabase, booking_id, cancellationRecord.id)
    );

    // Audit log
    Promise.resolve(supabase.rpc("insert_audit_log", {
      p_tenant_type: "agency",
      p_actor_id: user.id,
      p_actor_email: null,
      p_actor_role: "agency",
      p_target_id: booking_id,
      p_target_table: "bookings",
      p_action: "agency_cancel_booking",
      p_severity: "medium",
      p_old_values: { status: booking.status },
      p_new_values: { status: "cancelled", cancellation_type: "agency_cancellation" },
      p_metadata: { cancellation_id: cancellationRecord.id, refund_amount: refundAmount },
    })).catch((e: unknown) => console.error("Error audit log:", e));

    // Send notifications
    supabase.functions.invoke("send-agency-booking-cancellation-notification-traveler", {
      body: { booking_id, cancellation_id: cancellationRecord.id },
    }).catch((e: unknown) => console.error("Error enviando email viajero:", e));

    supabase.functions.invoke("send-agency-booking-cancellation-notification-admin", {
      body: { booking_id, cancellation_id: cancellationRecord.id },
    }).catch((e: unknown) => console.error("Error enviando email admin:", e));

    return ok({
      success: true,
      cancellation_id: cancellationRecord.id,
      refund_amount: refundAmount,
      points_deducted: pointsDeducted,
    });

  } catch (error: any) {
    console.error("process-agency-booking-cancellation error:", error);
    return err(error.message || "Error al procesar la cancelación");
  }
});
