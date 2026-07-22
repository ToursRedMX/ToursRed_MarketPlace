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
    const { slot_id, tour_id, cancellation_reason, reschedule_to_date, reschedule_to_time, check_capacity_only } = body;

    if (!slot_id || !tour_id || !cancellation_reason) {
      return new Response(JSON.stringify({ success: false, error: "Faltan campos requeridos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isReschedule = !!(reschedule_to_date && reschedule_to_time);

    const { data: slot, error: slotError } = await adminClient
      .from("tour_slots")
      .select("*, tours!inner(id, name, agency_id, agencies!inner(id, user_id, name))")
      .eq("id", slot_id)
      .eq("tour_id", tour_id)
      .single();

    if (slotError || !slot) {
      return new Response(JSON.stringify({ success: false, error: "Slot no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const agencyId = (slot.tours as any).agency_id;
    const agencyUserId = (slot.tours as any).agencies?.user_id;

    const { data: userData } = await adminClient
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    const isAdmin = userData?.role === "admin" || userData?.role === "super_admin";
    const isAgencyOwner = agencyUserId === user.id;

    if (!isAdmin && !isAgencyOwner) {
      const { data: staffData } = await adminClient
        .from("agency_staff_members")
        .select("permissions")
        .eq("user_id", user.id)
        .eq("agency_id", agencyId)
        .eq("is_active", true)
        .single();

      const canManage = (staffData?.permissions as any)?.canManageTours;
      if (!canManage) {
        return new Response(JSON.stringify({ success: false, error: "Sin permisos para esta accion" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { data: affectedBookings, error: bookingsError } = await adminClient
      .from("bookings")
      .select("id, user_id, deposit_amount, service_charge, toursred_cash_used, travelers_count")
      .eq("tour_id", tour_id)
      .eq("selected_date", slot.slot_date)
      .eq("selected_time", slot.departure_time)
      .in("status", ["confirmed", "pending"])
      .is("cancelled_at", null);

    if (bookingsError) throw bookingsError;

    // --- Flujo de REAGENDADO ---
    // Siempre que haya reservas activas y sea reagendado, usar el flujo de ventana de 12 horas.
    // El flujo de reembolso inmediato queda solo para CANCELACION pura (sin nueva fecha).
    if (isReschedule) {
      const rescheduleTimeParts = reschedule_to_time.split(":");
      const rescheduleTime = rescheduleTimeParts.length === 3 ? reschedule_to_time : reschedule_to_time + ":00";

      // Verificar si ya existe un slot en la fecha/hora destino
      const { data: existingSlots } = await adminClient
        .from("tour_slots")
        .select("id, capacity, booked_count, status, slot_date, departure_time")
        .eq("tour_id", tour_id)
        .eq("slot_date", reschedule_to_date)
        .neq("status", "cancelado")
        .neq("status", "bloqueado");

      const targetSlot = existingSlots?.find((s: any) =>
        s.departure_time === rescheduleTime || s.departure_time === reschedule_to_time
      ) || (existingSlots && existingSlots.length === 1 ? existingSlots[0] : null);

      // Verificar conflicto de cupo solo si ya hay reservas y hay slot existente en destino
      if (affectedBookings && affectedBookings.length > 0 && targetSlot) {
        const availableSpots = targetSlot.capacity - targetSlot.booked_count;
        const travelersAffected = affectedBookings.reduce((sum: number, b: any) => sum + (b.travelers_count || 1), 0);

        if (availableSpots < travelersAffected) {
          // Hay conflicto de cupo - devolver para que la UI muestre opciones
          return new Response(
            JSON.stringify({
              success: check_capacity_only ? true : false,
              conflict: true,
              target_slot: {
                id: targetSlot.id,
                slot_date: targetSlot.slot_date,
                departure_time: targetSlot.departure_time,
                capacity: targetSlot.capacity,
                booked_count: targetSlot.booked_count,
                available_spots: availableSpots,
              },
              affected_travelers: travelersAffected,
              spots_needed: travelersAffected - availableSpots,
              error: check_capacity_only ? undefined : "No hay cupo suficiente en el slot destino",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      if (check_capacity_only) {
        return new Response(
          JSON.stringify({ success: true, conflict: false }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Sin conflicto de cupo (o sin reservas activas) - usar flujo de 12 horas con cupo suficiente
      if (affectedBookings && affectedBookings.length > 0) {
        // Determinar el slot destino: usar existente si tiene cupo, si no crear uno nuevo
        let finalTargetSlotId: string;

        if (targetSlot) {
          // Ampliar capacidad si es necesario y mover reservas
          const needed = targetSlot.booked_count + affectedBookings.length;
          if (needed > targetSlot.capacity) {
            await adminClient
              .from("tour_slots")
              .update({ capacity: needed })
              .eq("id", targetSlot.id);
          }
          finalTargetSlotId = targetSlot.id;
        } else {
          // Crear nuevo slot en la fecha/hora destino
          const { data: newSlot, error: newSlotError } = await adminClient
            .from("tour_slots")
            .insert({
              tour_id: tour_id,
              agency_id: agencyId,
              schedule_id: slot.schedule_id,
              slot_date: reschedule_to_date,
              departure_time: rescheduleTime,
              capacity: slot.capacity,
              booked_count: 0,
              status: "activo",
              is_auto_generated: false,
              min_travelers_reached: false,
              notes: `Creado por reagendamiento desde ${slot.slot_date} ${slot.departure_time}. Motivo: ${cancellation_reason}`,
            })
            .select()
            .single();

          if (newSlotError || !newSlot) throw new Error("Error creando slot destino");
          finalTargetSlotId = newSlot.id;
        }

        // Crear solicitud de reagendado con ventana de 12 horas
        const responseDeadline = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

        const { data: rescheduleRequest, error: requestError } = await adminClient
          .from("slot_reschedule_requests")
          .insert({
            original_slot_id: slot_id,
            tour_id: tour_id,
            agency_id: agencyId,
            resolution_type: "new_slot",
            target_slot_id: finalTargetSlotId,
            reason: cancellation_reason,
            response_deadline: responseDeadline,
            status: "pending_responses",
            affected_bookings_count: affectedBookings.length,
            created_by: user.id,
          })
          .select()
          .single();

        if (requestError || !rescheduleRequest) throw new Error("Error creando solicitud de reagendado");

        // Bloquear el slot origen
        await adminClient
          .from("tour_slots")
          .update({ status: "bloqueado" })
          .eq("id", slot_id);

        // Obtener datos del slot destino para las notificaciones
        const { data: destSlotData } = await adminClient
          .from("tour_slots")
          .select("slot_date, departure_time")
          .eq("id", finalTargetSlotId)
          .single();

        // Crear respuestas individuales y notificar a cada viajero
        const responseInserts = affectedBookings.map((booking: any) => ({
          request_id: rescheduleRequest.id,
          booking_id: booking.id,
          user_id: booking.user_id,
          response: "pending",
        }));

        await adminClient.from("slot_reschedule_responses").insert(responseInserts);

        const bookingIds = affectedBookings.map((b: any) => b.id);
        await adminClient
          .from("bookings")
          .update({ has_pending_slot_reschedule: true })
          .in("id", bookingIds);

        const newDate = destSlotData?.slot_date || reschedule_to_date;
        const newTime = destSlotData?.departure_time || rescheduleTime;
        const tourName = (slot.tours as any).name;

        // Notificaciones in-app + emails
        const notifyPromises = affectedBookings.map(async (booking: any) => {
          await adminClient.rpc("create_user_notification", {
            p_user_id: booking.user_id,
            p_type: "slot_reschedule_pending",
            p_title: "Cambio de horario en tu reserva",
            p_message: `Tu reserva en "${tourName}" ha cambiado de fecha: ${slot.slot_date} → ${newDate}. Tienes 12 horas para aceptar o rechazar el cambio.`,
            p_data: {
              request_id: rescheduleRequest.id,
              booking_id: booking.id,
              tour_id: tour_id,
              original_date: slot.slot_date,
              original_time: slot.departure_time,
              new_date: newDate,
              new_time: newTime,
              response_deadline: responseDeadline,
            },
          });

          // Enviar email de notificacion
          EdgeRuntime.waitUntil(
            fetch(`${supabaseUrl}/functions/v1/send-slot-reschedule-notification`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${anonKey}`,
              },
              body: JSON.stringify({
                booking_id: booking.id,
                request_id: rescheduleRequest.id,
                original_date: slot.slot_date,
                original_time: slot.departure_time,
                new_date: newDate,
                new_time: newTime,
                reason: cancellation_reason,
                response_deadline: responseDeadline,
              }),
            }).catch(() => {})
          );
        });

        await Promise.all(notifyPromises);

        return new Response(
          JSON.stringify({
            success: true,
            mode: "reschedule_with_consent",
            request_id: rescheduleRequest.id,
            affected_bookings: affectedBookings.length,
            response_deadline: responseDeadline,
            message: `Solicitud de reagendado creada. ${affectedBookings.length} viajero(s) tienen 12 horas para aceptar o rechazar el nuevo horario.`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Sin reservas activas - reagendar directamente sin notificaciones
      await adminClient
        .from("tour_slots")
        .update({
          status: "cancelled",
          cancellation_reason: cancellation_reason,
          cancelled_at: new Date().toISOString(),
        })
        .eq("id", slot_id);

      if (!targetSlot) {
        await adminClient.from("tour_slots").insert({
          tour_id: tour_id,
          agency_id: agencyId,
          schedule_id: slot.schedule_id,
          slot_date: reschedule_to_date,
          departure_time: rescheduleTime,
          capacity: slot.capacity,
          booked_count: 0,
          status: "activo",
          is_auto_generated: false,
          min_travelers_reached: false,
          notes: `Reagendado desde ${slot.slot_date} ${slot.departure_time}. Motivo: ${cancellation_reason}`,
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          mode: "reschedule_direct",
          affected_bookings: 0,
          message: "Slot reagendado. No habia reservas activas que notificar.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Flujo de CANCELACION pura (sin nueva fecha) ---
    // Reembolso inmediato del 100%
    const tourName = (slot.tours as any).name;
    const affectedCount = affectedBookings?.length || 0;

    const refundPromises = (affectedBookings || []).map(async (booking: any) => {
      const depositAmount = Number(booking.deposit_amount || 0);

      await adminClient.rpc("update_wallet_balance", {
        p_user_id: booking.user_id,
        p_amount: depositAmount,
        p_type: "refund",
        p_description: `Reembolso por cancelacion de slot: ${tourName} - ${slot.slot_date}`,
        p_reference_id: booking.id,
        p_reference_type: "slot_cancellation",
      });

      await adminClient
        .from("bookings")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancellation_type: "no_refund",
          cancellation_refund_amount: depositAmount,
        })
        .eq("id", booking.id);

      await adminClient.rpc("create_user_notification", {
        p_user_id: booking.user_id,
        p_type: "booking_cancelled",
        p_title: "Cancelacion de Fecha de Tour",
        p_message: `La fecha ${slot.slot_date} de "${tourName}" fue cancelada. Se ha procesado un reembolso del 100% del anticipo.`,
        p_data: {
          booking_id: booking.id,
          tour_id: tour_id,
          slot_date: slot.slot_date,
          is_reschedule: false,
        },
      });
    });

    await Promise.all(refundPromises);

    await adminClient
      .from("tour_slots")
      .update({
        status: "cancelled",
        cancellation_reason: cancellation_reason,
        cancelled_at: new Date().toISOString(),
      })
      .eq("id", slot_id);

    if (affectedCount > 0) {
      fetch(`${supabaseUrl}/functions/v1/send-agency-cancellation-notification-admin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({
          tour_id,
          slot_date: slot.slot_date,
          slot_time: slot.departure_time,
          is_slot_cancellation: true,
          is_reschedule: false,
          affected_count: affectedCount,
          cancellation_reason,
          tour_name: tourName,
        }),
      }).catch(() => {});
    }

    return new Response(
      JSON.stringify({
        success: true,
        mode: "cancellation",
        affected_bookings: affectedCount,
        message: `Slot cancelado. ${affectedCount} viajero(s) notificados y reembolsados.`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
