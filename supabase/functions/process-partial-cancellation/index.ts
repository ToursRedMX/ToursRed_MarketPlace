import "jsr:@supabase/functions-js@2.112.4/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import * as Sentry from "npm:@sentry/deno@9.47.1";
import { opcionesConContexto, sinUserAgentDeNavegador } from "../_shared/contextoAuditoria.ts";
import { politicaDelTour, salidaDelTour } from "../_shared/politicaCancelacion.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    release: Deno.env.get("SENTRY_RELEASE"),
    tracesSampleRate: 0.1,
  });
}

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

interface PolicyResult {
  policyType: "100_percent" | "50_percent" | "no_refund";
  daysBeforeTour: number;
  originalPartialAmount: number;
  /** Lo que vuelve a ToursRed Cash. */
  refundAmountToTraveler: number;
  /** Los ToursRed Points que vuelven. */
  pointsRefund: number;
  amountToAgency: number;
  amountToPlatform: number;
  insuranceRefund: number;
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
    , sinUserAgentDeNavegador(opcionesConContexto(req)));

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
        id, status, user_id, total_price, deposit_amount, points_earned, points_used, agency_id,
        has_payment_plan, travel_insurance_included, travel_insurance_cost,
        selected_date, selected_time, approval_status, slot_id, selected_seats,
        tours (id, name, start_date, cancellation_not_allowed, tour_type,
               flexible_hours, flexible_refund_percentage, moderate_hours, moderate_refund_percentage),
        agencies (id, user_id)
      `)
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError || !booking) return err("Reserva no encontrada");

    // Security: only the booking owner can cancel
    if (booking.user_id !== user.id) return err("No tienes permiso para cancelar esta reserva");

    if (["confirmed", "pending"].includes(booking.status) === false) {
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

    // ── Politica: la MISMA del tour que la cancelacion total ──
    // Hasta el 25-sep-2026 aqui iban dias fijos (15+ -> 100%, 7-14 -> 50%,
    // <7 -> 0) y la total usaba la politica del tour: en un receptivo de 48 h,
    // quitar a un viajero 5 dias antes daba 0% y cancelar la reserva entera el
    // mismo dia daba 100%. Axel decidio que las dos usen la del tour.
    const tour = (booking as any).tours as any;
    // Campos que usan la politica y el reparto, tipados en vez de `as any`.
    const reserva = booking as unknown as {
      points_used?: number | null;
      approval_status?: string | null;
      selected_date?: string | null;
      selected_time?: string | null;
    };
    const salida = salidaDelTour(tour, reserva);
    if (!salida) return err("El tour no tiene fecha de inicio configurada");
    const hoursBeforeTour = (salida.salida.getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursBeforeTour <= 0) return err("No se puede cancelar viajeros de un tour que ya inició o ha pasado");
    const daysBeforeTour = Math.ceil(hoursBeforeTour / 24);
    const { policyType: tipoPolitica, refundPct } = politicaDelTour(
      tour, hoursBeforeTour, reserva.approval_status === "pending");

    const fullPriceOfCancelledTravelers = travelersToCancel.reduce(
      (sum: number, t: any) => sum + Number(t.precio_aplicado),
      0
    );

    const totalPrice = Number((booking as any).total_price) || 0;
    const depositAmount = Number((booking as any).deposit_amount) || totalPrice;

    // Include installments paid (excluding the anticipo, installment_number > 1) when a payment plan exists
    let totalPrincipalPaid = depositAmount;
    if ((booking as any).has_payment_plan) {
      const { data: installments } = await supabase
        .from("booking_payment_plan_installments")
        .select("amount_paid, status")
        .eq("booking_id", bookingId)
        .in("status", ["paid", "partially_paid"])
        .gt("installment_number", 1);
      const installmentsPaid = (installments || []).reduce(
        (sum: number, inst: any) => sum + Number(inst.amount_paid),
        0
      );
      totalPrincipalPaid = depositAmount + installmentsPaid;
    }
    const depositRatio = totalPrice > 0 ? totalPrincipalPaid / totalPrice : 1;

    const originalPartialAmount = Math.round(fullPriceOfCancelledTravelers * depositRatio * 100) / 100;

    // Calculate proportional travel insurance refund
    const insuranceIncluded = (booking as any).travel_insurance_included === true;
    const insuranceCost = Number((booking as any).travel_insurance_cost) || 0;
    let insuranceRefund = 0;
    if (insuranceIncluded && insuranceCost > 0) {
      // Total traveler count (including already-cancelled) is the base for per-traveler insurance
      const { count: totalTravelerCount } = await supabase
        .from("booking_travelers")
        .select("id", { count: "exact", head: true })
        .eq("booking_id", bookingId);
      const baseCount = totalTravelerCount || currentActiveCount;
      if (baseCount > 0) {
        // Mismo porcentaje de la politica del tour que el principal.
        insuranceRefund = Math.round((insuranceCost / baseCount) * travelerIds.length * refundPct * 100) / 100;
      }
    }

    // Fetch platform commission rate
    const { data: platformSettings } = await supabase
      .from("platform_settings")
      .select("agency_commission_percentage")
      .maybeSingle();

    const commissionRate = ((platformSettings as any)?.agency_commission_percentage || 15) / 100;

    // Cada medio en su moneda: la parte de los puntos que corresponde a estos
    // viajeros vuelve como puntos, lo demas como Cash. La regla vive en
    // reparto_parcial() (migracion 20260925240000) y es la misma que usa
    // procesar_reembolso_parcial() al ejecutar, asi que la vista previa y el
    // dinero no pueden diferir. Hasta el 25-sep-2026 todo iba a Cash y los
    // puntos no volvian.
    const { data: reparto, error: repartoError } = await supabase.rpc("reparto_parcial", {
      p_points_used: Number(reserva.points_used) || 0,
      p_parte: originalPartialAmount,
      p_principal: totalPrincipalPaid,
      p_porcentaje: refundPct,
      p_extra_cash: insuranceRefund,
    }).single<{ points_share: number; cash: number; puntos: number }>();
    if (repartoError || !reparto) return err("Error calculando el reembolso: " + (repartoError?.message ?? "sin datos"));
    const cashRefund = Number(reparto.cash) || 0;
    const pointsRefund = Number(reparto.puntos) || 0;

    // La penalizacion es la parte del principal que no se devuelve. El reparto
    // entre agencia y plataforma es el que ya tenia esta funcion.
    const penaltyAmount = originalPartialAmount * (1 - refundPct);
    const policyType: PolicyResult["policyType"] =
      tipoPolitica === "pending_approval" ? "100_percent" : tipoPolitica;
    const amountToAgency = refundPct === 0
      ? originalPartialAmount * (1 - commissionRate)
      : penaltyAmount * 0.7;
    const amountToPlatform = refundPct === 0
      ? originalPartialAmount * commissionRate
      : penaltyAmount * 0.3;

    const enMonedas = pointsRefund > 0
      ? `${formatCurrency(cashRefund)} a tu ToursRed Cash y ${pointsRefund.toLocaleString("es-MX")} puntos a tus ToursRed Points (la parte que pagaste con puntos vuelve como puntos)`
      : `${formatCurrency(cashRefund)} a tu ToursRed Cash`;

    const policy: PolicyResult = {
      policyType,
      daysBeforeTour,
      originalPartialAmount,
      refundAmountToTraveler: cashRefund,
      pointsRefund,
      amountToAgency: refundPct >= 1 ? 0 : amountToAgency,
      amountToPlatform: refundPct >= 1 ? 0 : amountToPlatform,
      insuranceRefund,
      warningMessage: refundPct === 0
        ? (tour.cancellation_not_allowed
          ? "Este tour NO permite cancelaciones con reembolso."
          : "Cancelar en este momento no genera reembolso.")
        : undefined,
      refundMessage: refundPct === 0
        ? (cashRefund > 0
          ? `No habrá reembolso de lo pagado por estos viajeros; solo se devuelve el seguro (${enMonedas}).`
          : "No habrá reembolso por estos viajeros. La cancelación se procesa para evitar penalización de No Show.")
        : `Se reembolsará el ${Math.round(refundPct * 100)}% de lo pagado por estos viajeros: ${enMonedas}.`,
    };

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
    // Cash y puntos en una sola transaccion, con la misma regla que la vista
    // previa. Se llama siempre: aunque no se devuelva nada, `points_share`
    // (los puntos de estos viajeros) tiene que quedar registrado para que una
    // cancelacion total posterior no los vuelva a devolver.
    const partialCancellationId = crypto.randomUUID();
    const { data: refundData, error: refundError } = await supabase.rpc("procesar_reembolso_parcial", {
      p_booking_id: bookingId,
      p_partial_cancellation_id: partialCancellationId,
      p_parte: originalPartialAmount,
      p_principal: totalPrincipalPaid,
      p_porcentaje: refundPct,
      p_extra_cash: insuranceRefund,
      p_description: `Reembolso por cancelación parcial de ${tour.name}`,
    });
    if (refundError || !refundData?.success) {
      return err("Error al procesar reembolso: " + (refundError?.message ?? "sin respuesta"));
    }
    transactionId = refundData.transaction_id || null;
    const cashRefunded = Number(refundData.cash_refunded) || 0;
    const pointsRefunded = Number(refundData.points_refunded) || 0;
    const pointsShare = Number(refundData.points_share) || 0;

    // 2. Insert partial cancellation record
    const { data: partialCancellation, error: insertError } = await supabase
      .from("booking_partial_cancellations")
      .insert({
        id: partialCancellationId,
        booking_id: bookingId,
        cancelled_by_user_id: user.id,
        tour_start_date: salida.fechaParaRegistro,
        days_before_tour: policy.daysBeforeTour,
        cancellation_policy_type: policy.policyType,
        travelers_cancelled: travelersToCancel.map((t: any) => ({
          id: t.id,
          nombre: t.nombre,
          categoria_viajero: t.categoria_viajero,
          precio_aplicado: Number(t.precio_aplicado),
        })),
        original_partial_amount: policy.originalPartialAmount,
        refund_amount_to_traveler: cashRefunded,
        points_share: pointsShare,
        points_refunded: pointsRefunded,
        amount_to_agency: policy.amountToAgency,
        amount_to_platform: policy.amountToPlatform,
        toursred_cash_transaction_id: transactionId,
        refund_processed: cashRefunded > 0 || pointsRefunded > 0,
        cancellation_reason: cancellationReason || null,
        insurance_refund_amount: policy.insuranceRefund,
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
    const bookingUpdate: Record<string, any> = {
      has_partial_cancellations: true,
      active_travelers_count: newActiveCount,
      // trg_update_slot_booked_count (y el conteo de disponibilidad para tours
      // sin slot en create_booking_atomic) usan bookings.travelers_count, no
      // active_travelers_count, para recalcular cupo. Sin este campo la
      // cancelacion parcial nunca liberaba lugar: el tour seguia mostrando el
      // cupo de antes de cancelar.
      travelers_count: newActiveCount,
    };
    // Reduce travel_insurance_cost by the refunded amount to prevent double refunds
    if (policy.insuranceRefund > 0) {
      bookingUpdate.travel_insurance_cost = Math.max(0, insuranceCost - policy.insuranceRefund);
    }

    // Libera tantos asientos como viajeros cancelados. booking_travelers no
    // guarda que asiento le toco a cada quien, asi que se liberan los ultimos
    // N de bookings.selected_seats (orden estable, sin necesidad de mapeo).
    const currentSeats: number[] = ((booking as any).selected_seats as number[] | null) || [];
    let seatsToRelease: number[] = [];
    if (currentSeats.length > 0) {
      seatsToRelease = currentSeats.slice(-travelerIds.length);
      const remainingSeats = currentSeats.slice(0, currentSeats.length - seatsToRelease.length);
      bookingUpdate.selected_seats = remainingSeats.length > 0 ? remainingSeats : null;
    }

    const { error: updateBookingError } = await supabase
      .from("bookings")
      .update(bookingUpdate)
      .eq("id", bookingId);

    if (updateBookingError) return err("Error actualizando reserva: " + updateBookingError.message);

    if (seatsToRelease.length > 0) {
      const { error: seatReleaseError } = await supabase
        .from("slot_seat_status")
        .delete()
        .eq("booking_id", bookingId)
        .in("seat_number", seatsToRelease);
      if (seatReleaseError) {
        console.error("Error liberando asientos de cancelación parcial (no crítico):", seatReleaseError);
      }
    }

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
          // Lo que no se devuelve del principal. No se resta el Cash devuelto: desde
          // el 25-sep-2026 ese Cash excluye la parte pagada con puntos.
          gross_penalty: penaltyAmount,
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
            refund_amount: cashRefunded,
            points_refunded: pointsRefunded,
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

    // 10. Substitute CFDIs for partial cancellation (fire and forget, async)
    // Recalculates Tour/Seguro concepts on existing stamped CFDIs to reflect the new
    // active traveler count, generates sustituto CFDIs (tipo_relacion "04"), then
    // cancels the originals (motivo "01").
    EdgeRuntime.waitUntil(
      supabase.functions.invoke("substitute-cfdi-for-partial-cancellation", {
        body: { booking_id: bookingId, partial_cancellation_id: partialCancellation.id },
      }).catch((err: any) => console.error("Error substituting CFDIs (no crítico):", err))
    );

    return ok({
      success: true,
      partial_cancellation_id: partialCancellation.id,
      policy,
    });
  } catch (error: any) {
    console.error("Error en process-partial-cancellation:", error);
    if (sentryDsn) {
      Sentry.captureException(error, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return err(error.message || "Error al procesar la cancelación parcial");
  }
});
