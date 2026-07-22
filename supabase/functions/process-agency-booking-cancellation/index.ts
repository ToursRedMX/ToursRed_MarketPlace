import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      throw new Error("Invalid user token");
    }

    const { booking_id, cancellation_reason } = await req.json();

    if (!booking_id || !cancellation_reason) {
      throw new Error("Faltan campos requeridos");
    }

    if (cancellation_reason.trim().length < 50) {
      throw new Error("El motivo de cancelación debe tener al menos 50 caracteres");
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        *,
        tour:tours!bookings_tour_id_fkey(
          id,
          name,
          destination,
          start_date,
          agency_id,
          agency:agencies!tours_agency_id_fkey(
            id,
            user_id,
            name,
            contact_email
          )
        ),
        user:users!bookings_user_id_fkey(
          id,
          first_name,
          last_name,
          email
        )
      `)
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking) {
      throw new Error("Reserva no encontrada");
    }

    if (booking.tour.agency.user_id !== user.id) {
      throw new Error("No tienes permiso para cancelar esta reserva");
    }

    if (booking.cancelled_at || booking.status === "cancelled") {
      throw new Error("Esta reserva ya fue cancelada");
    }

    if (!["confirmed", "pending"].includes(booking.status) || booking.payment_status !== "succeeded") {
      throw new Error("Solo se pueden cancelar reservas confirmadas o pendientes con pago exitoso");
    }

    const tourStartDate = new Date(booking.tour.start_date);
    const now = new Date();
    tourStartDate.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);

    if (tourStartDate <= now) {
      throw new Error("No se puede cancelar una reserva de un tour que ya inició");
    }

    let wallet = await supabase
      .from("toursred_cash_wallets")
      .select("*")
      .eq("user_id", booking.user_id)
      .maybeSingle();

    if (!wallet.data) {
      const { data: newWallet, error: walletError } = await supabase
        .from("toursred_cash_wallets")
        .insert({
          user_id: booking.user_id,
          balance: 0,
          currency: "MXN"
        })
        .select()
        .single();

      if (walletError || !newWallet) {
        throw new Error("Error creando wallet del viajero");
      }
      wallet.data = newWallet;
    }

    // When agency cancels: ALL optional services are refunded (even non-refundable ones)
    const { data: optionalServicesData } = await supabase
      .from("booking_optional_services")
      .select("subtotal")
      .eq("booking_id", booking_id)
      .eq("is_cancelled", false);

    const optionalServicesTotal = (optionalServicesData || []).reduce(
      (sum: number, bos: any) => sum + Number(bos.subtotal || 0),
      0
    );

    // Cancel all optional services marking them as cancelled by agency
    await supabase.rpc("cancel_booking_optional_services", {
      p_booking_id: booking_id,
      p_cancelled_by_agency: true,
    });

    const depositRefundAmount = Number(booking.deposit_amount) || 0;
    const refundAmount = depositRefundAmount + optionalServicesTotal;
    const newBalance = Number(wallet.data.balance) + refundAmount;

    const { data: transaction, error: transactionError } = await supabase
      .from("toursred_cash_transactions")
      .insert({
        wallet_id: wallet.data.id,
        user_id: booking.user_id,
        amount: refundAmount,
        balance_after: newBalance,
        type: "refund",
        description: `Reembolso completo por cancelación de la agencia - ${booking.tour.name}${optionalServicesTotal > 0 ? ` (incluye $${optionalServicesTotal.toFixed(2)} de servicios adicionales)` : ""}`,
        reference_id: booking_id,
        reference_type: "booking_cancellation"
      })
      .select()
      .single();

    if (transactionError || !transaction) {
      throw new Error("Error creando transacción de reembolso");
    }

    const { error: walletUpdateError } = await supabase
      .from("toursred_cash_wallets")
      .update({ balance: newBalance })
      .eq("id", wallet.data.id);

    if (walletUpdateError) {
      throw new Error("Error actualizando balance del wallet");
    }

    const { data: cancellationRecord, error: cancellationError } = await supabase
      .from("booking_cancellations")
      .insert({
        booking_id: booking_id,
        cancelled_by_user_id: user.id,
        cancelled_at: new Date().toISOString(),
        tour_start_date: booking.tour.start_date,
        days_before_tour: Math.floor((tourStartDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        cancellation_policy_type: "100_percent",
        original_deposit_amount: booking.deposit_amount,
        original_service_charge: booking.service_charge || 0,
        refund_amount_to_traveler: refundAmount,
        amount_to_agency: 0,
        amount_to_platform: 0,
        toursred_cash_transaction_id: transaction.id,
        refund_processed: true,
        cancelled_by_agency: true,
        agency_cancellation_reason: cancellation_reason.trim(),
        cancellation_reason: `Cancelación por agencia: ${cancellation_reason.trim()}`
      })
      .select()
      .single();

    if (cancellationError || !cancellationRecord) {
      throw new Error("Error creando registro de cancelación");
    }

    const { error: bookingUpdateError } = await supabase
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by_agency_at: new Date().toISOString(),
        cancellation_type: "agency_cancellation",
        cancellation_refund_amount: refundAmount
      })
      .eq("id", booking_id);

    if (bookingUpdateError) {
      throw new Error("Error actualizando estado de la reserva");
    }

    // Generar póliza contable para la cancelación por agencia (reembolso 100%)
    try {
      await supabase.rpc("create_accounting_entry_for_cancellation", {
        p_cancellation_id: cancellationRecord.id,
        p_cancellation_type: "agency_booking"
      });
    } catch (accountingError) {
      console.error("Error generando póliza contable de cancelación:", accountingError);
    }

    try {
      await supabase.functions.invoke("send-agency-booking-cancellation-notification-traveler", {
        body: {
          booking_id: booking_id,
          cancellation_id: cancellationRecord.id
        }
      });
    } catch (emailError) {
      console.error("Error enviando email al viajero:", emailError);
    }

    try {
      await supabase.functions.invoke("send-agency-booking-cancellation-notification-admin", {
        body: {
          booking_id: booking_id,
          cancellation_id: cancellationRecord.id
        }
      });
    } catch (adminEmailError) {
      console.error("Error enviando email al admin:", adminEmailError);
    }

    await supabase
      .from("notifications")
      .insert({
        user_id: booking.user_id,
        type: "system_announcement",
        title: "Reserva Cancelada por la Agencia",
        message: `Tu reserva para "${booking.tour.name}" ha sido cancelada por la agencia. Has recibido un reembolso completo de $${refundAmount.toFixed(2)} en tu ToursRed Cash.`,
        data: {
          booking_id: booking_id,
          tour_id: booking.tour_id,
          cancellation_id: cancellationRecord.id,
          refund_amount: refundAmount
        }
      });

    return new Response(
      JSON.stringify({
        success: true,
        cancellation_id: cancellationRecord.id,
        booking_id: booking_id,
        refund_amount: refundAmount,
        new_balance: newBalance,
        message: `Reserva cancelada exitosamente. El viajero ha recibido un reembolso completo de $${refundAmount.toFixed(2)} en su ToursRed Cash.`
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );

  } catch (error: any) {
    console.error("Error in process-agency-booking-cancellation:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Error al procesar la cancelación de la reserva"
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
