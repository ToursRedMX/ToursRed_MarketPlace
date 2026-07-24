import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function parseDateFromDB(dateString: string | null | undefined): Date {
  if (!dateString) return new Date();
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

interface PolicyResult {
  policyType: "100_percent" | "50_percent" | "no_refund";
  daysBeforeTour: number;
  originalPartialAmount: number;
  refundAmountToTraveler: number;
  amountToAgency: number;
  amountToPlatform: number;
  refundMessage: string;
  warningMessage?: string;
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

    // Validate auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return err("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return err("Token inválido");

    const body = await req.json();
    const bookingId = body.booking_id;
    const travelerIds: string[] = body.traveler_ids;
    const cancellationReason: string | undefined = body.cancellation_reason;
    const isPreview: boolean = body.preview === true;

    if (!bookingId) return err("booking_id es requerido");
    if (!travelerIds || !Array.isArray(travelerIds) || travelerIds.length === 0) {
      return err("traveler_ids debe ser un arreglo con al menos un ID");
    }

    // Load booking with tour and agency info
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        id, status, user_id, total_price, deposit_amount, points_earned, agency_id,
        tours (id, name, start_date, cancellation_not_allowed),
        agencies (id, user_id)
      `)
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError || !booking) return err("Reserva no encontrada");

    // Security: only the booking owner can cancel
    if (booking.user_id !== user.id) return err("No tienes permiso para cancelar esta reserva");

    if (!["confirmed", "pending"].includes(booking.status)) {
      return err("La reserva no está en un estado que permita cancelaciones parciales");
    }

    // Load all active travelers for this booking
    const { data: activeTravelers, error: travelersError } = await supabase
      .from("booking_travelers")
      .select("id, nombre, categoria_viajero, precio_aplicado")
      .eq("booking_id", bookingId)
      .eq("is_cancelled", false);

    if (travelersError) return err("Error cargando viajeros: " + travelersError.message);

    const currentActiveCount = activeTravelers?.length || 0;

    // Validate that ALL traveler_ids belong to this booking's active travelers
    const activeTravelerIds = new Set((activeTravelers || []).map((t: any) => t.id));
    for (const tid of travelerIds) {
      if (!activeTravelerIds.has(tid)) {
        return err("Uno o más viajeros seleccionados no pertenecen a esta reserva o ya fueron cancelados");
      }
    }

    // Can't cancel all travelers via partial — must use total cancellation
    if (travelerIds.length >= currentActiveCount) {
      return err("No puedes cancelar todos los viajeros con cancelación parcial. Usa la cancelación total de la reserva.");
    }

    // Get the travelers to cancel (with precio_aplicado read from DB, not from client)
    const travelersToCancel = (activeTravelers || []).filter((t: any) => travelerIds.includes(t.id));

    // ── Calculate cancellation policy (server-side, replicating client logic exactly) ──
    const tour = (booking as any).tours as any;
    const tourStartDate = parseDateFromDB(tour.start_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const millisecondsPerDay = 1000 * 60 * 60 * 24;
    const daysBeforeTour = Math.ceil((tourStartDate.getTime() - today.getTime()) / millisecondsPerDay);

    const fullPriceOfCancelledTravelers = travelersToCancel.reduce(
      (sum: number, t: any) => sum + Number(t.precio_aplicado),
      0
    );

    const totalPrice = Number((booking as any).total_price) || 0;
    const depositAmount = Number((booking as any).deposit_amount) || totalPrice;
    const depositRatio = totalPrice > 0 ? depositAmount / totalPrice : 1;

    const originalPartialAmount = Math.round(fullPriceOfCancelledTravelers * depositRatio * 100) / 100;

    // Fetch platform commission rate
    const { data: platformSettings } = await supabase
      .from("platform_settings")
      .select("agency_commission_percentage")
      .maybeSingle();

    const commissionRate = ((platformSettings as any)?.agency_commission_percentage || 15) / 100;

    let policy: PolicyResult;

    if (daysBeforeTour >= 15) {
      policy = {
        policyType: "100_percent",
        daysBeforeTour,
        originalPartialAmount,
        refundAmountToTraveler: originalPartialAmount,
        amountToAgency: 0,
        amountToPlatform: 0,
        refundMessage: `Se reembolsará el 100% del anticipo parcial ($${formatCurrency(originalPartialAmount)}) a tu ToursRed Cash.`,
      };
    } else if (daysBeforeTour >= 7 && daysBeforeTour < 15) {
      const refundAmount = originalPartialAmount * 0.5;
      const penaltyAmount = originalPartialAmount * 0.5;
      policy = {
        policyType: "50_percent",
        daysBeforeTour,
        originalPartialAmount,
        refundAmountToTraveler: refundAmount,
        amountToAgency: penaltyAmount * 0.7,
        amountToPlatform: penaltyAmount * 0.3,
        refundMessage: `Se reembolsará el 50% del anticipo parcial ($${formatCurrency(refundAmount)}) a tu ToursRed Cash.`,
      };
    } else {
      const agencyAmount = originalPartialAmount * (1 - commissionRate);
      const platformAmount = originalPartialAmount * commissionRate;
      policy = {
        policyType: "no_refund",
        daysBeforeTour,
        originalPartialAmount,
        refundAmountToTraveler: 0,
        amountToAgency: agencyAmount,
        amountToPlatform: platformAmount,
        warningMessage: tour.cancellation_not_allowed
          ? "Este tour NO permite cancelaciones con reembolso."
          : daysBeforeTour < 1
            ? "Cancelar en este momento no genera reembolso."
            : undefined,
        refundMessage: "No habrá reembolso por estos viajeros. La cancelación se procesa para evitar penalización de No Show.",
      };
    }

    // ── Preview mode: return policy without any side effects ──
    if (isPreview) {
      return ok({
        success: true,
        preview: true,
        policy,
      });
    }

    // ── Execution mode: perform all side effects ──
    let transactionId: string | null = null;

    // 1. Refund to wallet (server-calculated amount, not client-supplied)
    if (policy.refundAmountToTraveler > 0) {
      const tourName = tour.name;
      const { data: refundData, error: refundError } = await supabase.rpc("update_wallet_balance", {
        p_user_id: user.id,
        p_amount: policy.refundAmountToTraveler,
        p_type: "refund",
        p_description: `Reembolso por cancelación parcial de ${tourName}`,
        p_reference_id: bookingId,
        p_reference_type: "booking_partial_cancellation",
      });

      if (refundError) return err("Error al procesar reembolso: " + refundError.message);
      transactionId = refundData?.transaction_id || null;
    }

    // 2. Insert partial cancellation record
    const { data: partialCancellation, error: insertError } = await supabase
      .from("booking_partial_cancellations")
      .insert({
        booking_id: bookingId,
        cancelled_by_user_id: user.id,
        tour_start_date: tour.start_date,
        days_before_tour: policy.daysBeforeTour,
        cancellation_policy_type: policy.policyType,
        travelers_cancelled: travelersToCancel.map((t: any) => ({
          id: t.id,
          nombre: t.nombre,
          categoria_viajero: t.categoria_viajero,
          precio_aplicado: Number(t.precio_aplicado),
        })),
        original_partial_amount: policy.originalPartialAmount,
        refund_amount_to_traveler: policy.refundAmountToTraveler,
        amount_to_agency: policy.amountToAgency,
        amount_to_platform: policy.amountToPlatform,
        toursred_cash_transaction_id: transactionId,
        refund_processed: policy.refundAmountToTraveler > 0,
        cancellation_reason: cancellationReason || null,
      })
      .select()
      .single();

    if (insertError) return err("Error registrando cancelación parcial: " + insertError.message);

    // 3. Accounting entry when there's a retention (50% or no_refund)
    if (policy.policyType === "50_percent" || policy.policyType === "no_refund") {
      supabase
        .rpc("create_accounting_entry_for_cancellation", {
          p_cancellation_id: partialCancellation.id,
          p_cancellation_type: "partial",
        })
        .then(({ error: accErr }: { error: any }) => {
          if (accErr) console.error("Error generando póliza contable de cancelación parcial:", accErr);
        });
    }

    // 4. Deduct points
    const pointsEarned = Number((booking as any).points_earned) || 0;
    if (pointsEarned > 0) {
      const pointsToDeduct = Math.min(Math.floor(policy.originalPartialAmount), pointsEarned);

      if (pointsToDeduct > 0) {
        const { error: deductError } = await supabase.rpc("deduct_points_for_partial_cancellation", {
          p_booking_id: bookingId,
          p_partial_cancellation_id: partialCancellation.id,
          p_user_id: user.id,
          p_points_to_deduct: pointsToDeduct,
        });
        if (deductError) {
          console.error("Error descontando puntos (no crítico):", deductError);
        } else {
          await supabase
            .from("bookings")
            .update({ points_earned: pointsEarned - pointsToDeduct })
            .eq("id", bookingId);
        }
      }
    }

    // 5. Mark travelers as cancelled
    const { error: updateTravelersError } = await supabase
      .from("booking_travelers")
      .update({
        is_cancelled: true,
        cancelled_at: new Date().toISOString(),
        partial_cancellation_id: partialCancellation.id,
      })
      .in("id", travelerIds);

    if (updateTravelersError) return err("Error actualizando viajeros: " + updateTravelersError.message);

    // 6. Update booking flags
    const newActiveCount = currentActiveCount - travelerIds.length;
    const { error: updateBookingError } = await supabase
      .from("bookings")
      .update({
        has_partial_cancellations: true,
        active_travelers_count: newActiveCount,
      })
      .eq("id", bookingId);

    if (updateBookingError) return err("Error actualizando reserva: " + updateBookingError.message);

    // 7. Penalty record when applicable
    if (
      policy.amountToAgency > 0 &&
      (policy.policyType === "50_percent" || policy.policyType === "no_refund")
    ) {
      const { error: penaltyError } = await supabase
        .from("cancellation_penalty_records")
        .insert({
          booking_id: bookingId,
          agency_id: (booking as any).agency_id,
          tour_id: tour.id,
          cancellation_type: "partial",
          partial_cancellation_id: partialCancellation.id,
          cancellation_policy_type: policy.policyType,
          original_booking_amount: policy.originalPartialAmount,
          gross_penalty: policy.originalPartialAmount - policy.refundAmountToTraveler,
          agency_net_amount: policy.amountToAgency,
          platform_amount: policy.amountToPlatform,
          status: "pending",
        });

      if (penaltyError) return err("Error creando cancellation_penalty_record: " + penaltyError.message);
    }

    // 8. Realtime notification to agency
    try {
      const agencyUserId = (booking as any).agencies?.user_id;
      if (agencyUserId) {
        await supabase.rpc("create_user_notification", {
          p_user_id: agencyUserId,
          p_type: "booking_cancelled",
          p_title: "Cancelación Parcial de Viajeros",
          p_message: `Se cancelaron ${travelerIds.length} viajero(s) de la reserva del tour "${tour.name}".`,
          p_data: {
            booking_id: bookingId,
            partial_cancellation_id: partialCancellation.id,
            travelers_count: travelerIds.length,
            refund_amount: policy.refundAmountToTraveler,
            policy_type: policy.policyType,
          },
        });

        await supabase
          .from("booking_partial_cancellations")
          .update({ notification_sent: true })
          .eq("id", partialCancellation.id);
      }
    } catch (notifError) {
      console.error("Error enviando notificación en tiempo real (no crítico):", notifError);
    }

    // 9. Send the 3 email notifications
    try {
      const emailBody = { booking_id: bookingId, partial_cancellation_id: partialCancellation.id };
      const responses = await Promise.all([
        supabase.functions.invoke("send-partial-cancellation-notification-traveler", { body: emailBody }),
        supabase.functions.invoke("send-partial-cancellation-notification-agency", { body: emailBody }),
        supabase.functions.invoke("send-partial-cancellation-notification-admin", { body: emailBody }),
      ]);

      const allSent = responses.every((r: any) => !r.error);
      await supabase
        .from("booking_partial_cancellations")
        .update({ emails_sent: allSent })
        .eq("id", partialCancellation.id);
    } catch (emailError) {
      console.error("Error enviando emails de cancelación parcial (no crítico):", emailError);
    }

    return ok({
      success: true,
      partial_cancellation_id: partialCancellation.id,
      policy,
    });
  } catch (error: any) {
    console.error("Error en process-partial-cancellation:", error);
    return err(error.message || "Error al procesar la cancelación parcial");
  }
});
