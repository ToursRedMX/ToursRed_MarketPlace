import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function handleSeatAssignment(
  adminClient: any,
  bookingId: string,
  targetSlotId: string,
  tourId: string,
  originalSeats: number[],
  travelersCount: number
): Promise<{ assigned: boolean; needsReselection: boolean }> {
  if (!originalSeats || originalSeats.length === 0) {
    return { assigned: false, needsReselection: false };
  }

  const { data: occupiedSeats } = await adminClient
    .from("slot_seat_status")
    .select("seat_number")
    .eq("tour_id", tourId)
    .eq("slot_id", targetSlotId)
    .in("status", ["reservado_online", "bloqueado_agencia"]);

  const occupiedNumbers = new Set((occupiedSeats || []).map((s: any) => s.seat_number));
  const availableOriginalSeats = originalSeats.filter((n) => !occupiedNumbers.has(n));

  if (availableOriginalSeats.length >= travelersCount) {
    const seatsToUse = availableOriginalSeats.slice(0, travelersCount);
    const seatRecords = seatsToUse.map((seatNum) => ({
      tour_id: tourId,
      slot_id: targetSlotId,
      agency_id: null,
      seat_number: seatNum,
      status: "reservado_online",
      booking_id: bookingId,
    }));

    await adminClient
      .from("slot_seat_status")
      .delete()
      .eq("booking_id", bookingId)
      .neq("slot_id", targetSlotId);

    await adminClient.from("slot_seat_status").upsert(seatRecords, {
      onConflict: "tour_id,slot_id,seat_number",
    });

    await adminClient
      .from("bookings")
      .update({ selected_seats: seatsToUse, needs_seat_reselection: false })
      .eq("id", bookingId);

    return { assigned: true, needsReselection: false };
  } else {
    await adminClient
      .from("slot_seat_status")
      .delete()
      .eq("booking_id", bookingId)
      .neq("slot_id", targetSlotId);

    await adminClient
      .from("bookings")
      .update({
        needs_seat_reselection: true,
        previous_selected_seats: originalSeats,
        selected_seats: null,
      })
      .eq("id", bookingId);

    return { assigned: false, needsReselection: true };
  }
}

async function checkAndFinalizeRequest(
  adminClient: any,
  requestId: string,
  targetSlotId: string,
  originalSlotId: string,
  reason: string,
  now: string
): Promise<void> {
  const { data: allResponses } = await adminClient
    .from("slot_reschedule_responses")
    .select("response, confirmed_spot, booking_id")
    .eq("request_id", requestId);

  if (!allResponses) return;

  const stillPending = allResponses.some((r: any) => r.response === "pending");
  if (stillPending) return;

  const { data: targetSlot } = await adminClient
    .from("tour_slots")
    .select("slot_date, departure_time")
    .eq("id", targetSlotId)
    .single();

  if (!targetSlot) return;

  const confirmedResponses = allResponses.filter((r: any) => r.confirmed_spot === true);
  const confirmedBookingIds = confirmedResponses.map((r: any) => r.booking_id);

  if (confirmedBookingIds.length > 0) {
    await adminClient
      .from("bookings")
      .update({
        selected_date: targetSlot.slot_date,
        selected_time: targetSlot.departure_time,
      })
      .in("id", confirmedBookingIds);

    const { data: confirmedTravelerCounts } = await adminClient
      .from("bookings")
      .select("travelers_count")
      .in("id", confirmedBookingIds);

    const totalConfirmedTravelers = (confirmedTravelerCounts || []).reduce(
      (sum: number, b: any) => sum + (b.travelers_count || 1),
      0
    );

    const { data: currentSlot } = await adminClient
      .from("tour_slots")
      .select("booked_count")
      .eq("id", targetSlotId)
      .single();

    if (currentSlot) {
      await adminClient
        .from("tour_slots")
        .update({ booked_count: currentSlot.booked_count + totalConfirmedTravelers })
        .eq("id", targetSlotId);
    }
  }

  const noAvailabilityCount = allResponses.filter(
    (r: any) => r.response === "accepted_no_availability" || r.response === "auto_accepted_no_availability"
  ).length;

  await adminClient
    .from("slot_reschedule_requests")
    .update({
      status: "completed",
      completed_at: now,
      no_availability_count: noAvailabilityCount,
    })
    .eq("id", requestId);

  await adminClient
    .from("tour_slots")
    .update({
      status: "cancelado",
      cancellation_reason: "Reagendado: " + reason,
      cancelled_at: now,
    })
    .eq("id", originalSlotId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ success: false, error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { booking_id, response, alternative_slot_id } = body;

    if (!booking_id || !response) {
      return new Response(JSON.stringify({ success: false, error: "Faltan campos requeridos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["accepted", "rejected", "choose_alternative"].includes(response)) {
      return new Response(JSON.stringify({ success: false, error: "Respuesta invalida" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (response === "choose_alternative" && !alternative_slot_id) {
      return new Response(JSON.stringify({ success: false, error: "Se requiere el slot alternativo" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: booking, error: bookingError } = await adminClient
      .from("bookings")
      .select("id, user_id, status, deposit_amount, toursred_cash_used, tour_id, has_pending_slot_reschedule, slot_reschedule_response, selected_seats, travelers_count")
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking) {
      return new Response(JSON.stringify({ success: false, error: "Reserva no encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (booking.status === "cancellation_processing") {
      return new Response(JSON.stringify({ success: false, error: "Esta reserva está en proceso de cancelación" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (booking.user_id !== user.id) {
      return new Response(JSON.stringify({ success: false, error: "Sin permisos para esta reserva" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!booking.has_pending_slot_reschedule) {
      return new Response(JSON.stringify({ success: false, error: "Esta reserva no tiene un reagendado pendiente" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: rescheduleResponse, error: responseError } = await adminClient
      .from("slot_reschedule_responses")
      .select("*, slot_reschedule_requests!inner(id, status, response_deadline, target_slot_id, reason, tour_id, original_slot_id, available_spots_in_target)")
      .eq("booking_id", booking_id)
      .eq("response", "pending")
      .single();

    if (responseError || !rescheduleResponse) {
      if (response === "choose_alternative" && booking.slot_reschedule_response === "accepted_no_availability") {
        const { data: existingResponse } = await adminClient
          .from("slot_reschedule_responses")
          .select("*, slot_reschedule_requests!inner(id, status, response_deadline, target_slot_id, reason, tour_id, original_slot_id, available_spots_in_target)")
          .eq("booking_id", booking_id)
          .eq("response", "accepted_no_availability")
          .single();

        if (!existingResponse) {
          return new Response(JSON.stringify({ success: false, error: "No se encontro la solicitud de reagendado" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const rr = (existingResponse as any).slot_reschedule_requests;
        const now = new Date().toISOString();

        const { data: altSlot } = await adminClient
          .from("tour_slots")
          .select("id, slot_date, departure_time, capacity, booked_count")
          .eq("id", alternative_slot_id)
          .single();

        if (!altSlot) {
          return new Response(JSON.stringify({ success: false, error: "Slot alternativo no encontrado" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const available = altSlot.capacity - altSlot.booked_count;
        const travelersCount = booking.travelers_count || 1;

        if (available < travelersCount) {
          return new Response(JSON.stringify({ success: false, error: "El horario seleccionado ya no tiene suficiente cupo" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await adminClient
          .from("slot_reschedule_responses")
          .update({
            response: "accepted",
            confirmed_spot: true,
            alternative_slot_id: alternative_slot_id,
            responded_at: now,
          })
          .eq("id", existingResponse.id);

        await adminClient
          .from("bookings")
          .update({
            has_pending_slot_reschedule: false,
            slot_reschedule_response: "accepted",
            slot_reschedule_responded_at: now,
            slot_reschedule_alternative_slot_id: alternative_slot_id,
            selected_date: altSlot.slot_date,
            selected_time: altSlot.departure_time,
            slot_id: altSlot.id,
          })
          .eq("id", booking_id);

        await adminClient
          .from("tour_slots")
          .update({ booked_count: altSlot.booked_count + travelersCount })
          .eq("id", alternative_slot_id);

        const { data: tourData } = await adminClient
          .from("tours")
          .select("vehicle_map_type")
          .eq("id", booking.tour_id)
          .single();

        let seatReselectionNeeded = false;
        if (tourData?.vehicle_map_type && booking.selected_seats && booking.selected_seats.length > 0) {
          const seatResult = await handleSeatAssignment(
            adminClient, booking_id, altSlot.id, booking.tour_id,
            booking.selected_seats, travelersCount
          );
          seatReselectionNeeded = seatResult.needsReselection;
        }

        await adminClient.rpc("create_user_notification", {
          p_user_id: user.id,
          p_type: "slot_reschedule_accepted",
          p_title: "Nuevo horario confirmado",
          p_message: `Tu reserva ha sido movida al horario alternativo: ${altSlot.slot_date} a las ${altSlot.departure_time?.substring(0, 5)}.`,
          p_data: {
            booking_id: booking_id,
            request_id: rr.id,
            new_date: altSlot.slot_date,
            new_time: altSlot.departure_time,
            needs_seat_reselection: seatReselectionNeeded,
          },
        });

        return new Response(
          JSON.stringify({
            success: true,
            response: "accepted",
            new_date: altSlot.slot_date,
            new_time: altSlot.departure_time,
            needs_seat_reselection: seatReselectionNeeded,
            message: "Has confirmado el horario alternativo. Tu reserva ha sido actualizada.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ success: false, error: "No se encontro la solicitud de reagendado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rescheduleRequest = (rescheduleResponse as any).slot_reschedule_requests;

    if (rescheduleRequest.status !== "pending_responses") {
      return new Response(JSON.stringify({ success: false, error: "Esta solicitud ya fue procesada" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (new Date(rescheduleRequest.response_deadline) < new Date()) {
      return new Response(JSON.stringify({ success: false, error: "El plazo para responder ha expirado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();

    if (response === "accepted") {
      const availableInTarget: number | null = rescheduleRequest.available_spots_in_target;
      const travelersCount = booking.travelers_count || 1;

      let confirmedSpot = true;
      let alternativeSlots: any[] = [];

      if (availableInTarget !== null) {
        const { data: alreadyConfirmedData } = await adminClient.rpc("get_confirmed_spots_in_reschedule", {
          p_request_id: rescheduleRequest.id,
        });

        const alreadyConfirmedTravelers = Number(alreadyConfirmedData || 0);
        const remainingSpots = availableInTarget - alreadyConfirmedTravelers;

        if (remainingSpots < travelersCount) {
          confirmedSpot = false;

          const { data: altSlots } = await adminClient.rpc("get_alternative_slots_for_reschedule", {
            p_tour_id: rescheduleRequest.tour_id,
            p_original_slot_id: rescheduleRequest.original_slot_id,
            p_travelers_needed: travelersCount,
          });

          alternativeSlots = altSlots || [];

          await adminClient
            .from("slot_reschedule_responses")
            .update({
              response: "accepted_no_availability",
              confirmed_spot: false,
              responded_at: now,
            })
            .eq("id", rescheduleResponse.id);

          await adminClient
            .from("bookings")
            .update({
              has_pending_slot_reschedule: false,
              slot_reschedule_response: "accepted_no_availability",
              slot_reschedule_responded_at: now,
            })
            .eq("id", booking_id);

          await adminClient.rpc("create_user_notification", {
            p_user_id: user.id,
            p_type: "slot_reschedule_pending",
            p_title: "Sin cupo en el horario propuesto",
            p_message: `Los cupos del horario propuesto ya fueron asignados a otros viajeros. Puedes elegir un horario alternativo o solicitar reembolso.`,
            p_data: {
              booking_id: booking_id,
              request_id: rescheduleRequest.id,
              has_alternative_slots: alternativeSlots.length > 0,
            },
          });

          await checkAndFinalizeRequest(
            adminClient,
            rescheduleRequest.id,
            rescheduleRequest.target_slot_id,
            rescheduleRequest.original_slot_id,
            rescheduleRequest.reason,
            now
          );

          return new Response(
            JSON.stringify({
              success: true,
              response: "accepted_no_availability",
              alternative_slots: alternativeSlots,
              message: "No hay cupo disponible en el horario propuesto. Por favor elige un horario alternativo o solicita reembolso.",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      await adminClient
        .from("slot_reschedule_responses")
        .update({
          response: "accepted",
          confirmed_spot: true,
          responded_at: now,
        })
        .eq("id", rescheduleResponse.id);

      const { data: targetSlot } = await adminClient
        .from("tour_slots")
        .select("id, slot_date, departure_time")
        .eq("id", rescheduleRequest.target_slot_id)
        .single();

      await adminClient
        .from("bookings")
        .update({
          has_pending_slot_reschedule: false,
          slot_reschedule_response: "accepted",
          slot_reschedule_responded_at: now,
          selected_date: targetSlot?.slot_date ?? undefined,
          selected_time: targetSlot?.departure_time ?? undefined,
          slot_id: targetSlot?.id ?? undefined,
        })
        .eq("id", booking_id);

      let seatReselectionNeeded = false;

      if (targetSlot) {
        const { data: tourData } = await adminClient
          .from("tours")
          .select("vehicle_map_type")
          .eq("id", booking.tour_id)
          .single();

        const hasSeatMap = !!(tourData?.vehicle_map_type);

        if (hasSeatMap && booking.selected_seats && booking.selected_seats.length > 0) {
          const seatResult = await handleSeatAssignment(
            adminClient,
            booking_id,
            targetSlot.id,
            booking.tour_id,
            booking.selected_seats,
            booking.travelers_count || booking.selected_seats.length
          );
          seatReselectionNeeded = seatResult.needsReselection;
        }
      }

      const notifMessage = seatReselectionNeeded
        ? `Confirmado. Tu reserva fue movida al ${targetSlot?.slot_date} a las ${targetSlot?.departure_time?.substring(0, 5)}. Tus asientos anteriores no estaban disponibles, por favor selecciona nuevos asientos.`
        : `Confirmado. Tu reserva ha sido movida al ${targetSlot?.slot_date} a las ${targetSlot?.departure_time?.substring(0, 5)}.`;

      await adminClient.rpc("create_user_notification", {
        p_user_id: user.id,
        p_type: seatReselectionNeeded ? "slot_reschedule_seat_reselection" : "slot_reschedule_accepted",
        p_title: seatReselectionNeeded ? "Selecciona nuevos asientos" : "Has aceptado el nuevo horario",
        p_message: notifMessage,
        p_data: {
          booking_id: booking_id,
          request_id: rescheduleRequest.id,
          new_date: targetSlot?.slot_date,
          new_time: targetSlot?.departure_time,
          needs_seat_reselection: seatReselectionNeeded,
        },
      });

      await checkAndFinalizeRequest(
        adminClient,
        rescheduleRequest.id,
        rescheduleRequest.target_slot_id,
        rescheduleRequest.original_slot_id,
        rescheduleRequest.reason,
        now
      );

      return new Response(
        JSON.stringify({
          success: true,
          response: "accepted",
          new_date: targetSlot?.slot_date,
          new_time: targetSlot?.departure_time,
          needs_seat_reselection: seatReselectionNeeded,
          message: seatReselectionNeeded
            ? "Has aceptado el nuevo horario. Tus asientos anteriores no estaban disponibles, por favor selecciona nuevos asientos."
            : "Has aceptado el nuevo horario. Tu reserva ha sido actualizada.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else if (response === "rejected") {
      const depositAmount = Number(booking.deposit_amount || 0);
      const toursredCashUsed = Number(booking.toursred_cash_used || 0);
      const totalRefund = depositAmount + toursredCashUsed;

      let refundTransactionId: string | null = null;

      if (totalRefund > 0) {
        const { data: refundData, error: refundError } = await adminClient.rpc("update_wallet_balance", {
          p_user_id: user.id,
          p_amount: totalRefund,
          p_type: "refund",
          p_description: `Reembolso por rechazo de reagendado de slot`,
          p_reference_id: booking_id,
          p_reference_type: "slot_reschedule_rejection",
        });

        if (refundError) throw refundError;
        refundTransactionId = refundData?.transaction_id || null;
      }

      await adminClient
        .from("slot_reschedule_responses")
        .update({
          response: "rejected",
          confirmed_spot: false,
          responded_at: now,
          refund_processed: true,
          refund_amount: totalRefund,
          refund_transaction_id: refundTransactionId,
        })
        .eq("id", rescheduleResponse.id);

      await adminClient
        .from("bookings")
        .update({
          status: "cancelled",
          cancelled_at: now,
          cancellation_type: "slot_reschedule_rejection",
          cancellation_refund_amount: totalRefund,
          has_pending_slot_reschedule: false,
          slot_reschedule_response: "rejected",
          slot_reschedule_responded_at: now,
        })
        .eq("id", booking_id);

      await adminClient.rpc("create_user_notification", {
        p_user_id: user.id,
        p_type: "slot_reschedule_rejected",
        p_title: "Has rechazado el reagendamiento",
        p_message: `Has rechazado el nuevo horario. Se ha procesado un reembolso de $${totalRefund.toFixed(2)} a tu ToursRed Cash.`,
        p_data: {
          booking_id: booking_id,
          request_id: rescheduleRequest.id,
          refund_amount: totalRefund,
        },
      });

      await checkAndFinalizeRequest(
        adminClient,
        rescheduleRequest.id,
        rescheduleRequest.target_slot_id,
        rescheduleRequest.original_slot_id,
        rescheduleRequest.reason,
        now
      );

      return new Response(
        JSON.stringify({
          success: true,
          response: "rejected",
          refund_amount: totalRefund,
          message: `Has rechazado el reagendamiento. Se han reembolsado $${totalRefund.toFixed(2)} a tu ToursRed Cash.`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ success: false, error: "Respuesta no procesada" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
