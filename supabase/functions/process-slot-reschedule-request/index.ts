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
    const {
      slot_id,
      tour_id,
      reason,
      resolution_type,
      target_slot_id,
      new_slot_date,
      new_slot_time,
      new_capacity,
      new_vehicle_map_type,
    } = body;

    if (!slot_id || !tour_id || !reason || !resolution_type) {
      return new Response(JSON.stringify({ success: false, error: "Faltan campos requeridos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["new_slot", "increase_capacity", "existing_slot", "expand_capacity"].includes(resolution_type)) {
      return new Response(JSON.stringify({ success: false, error: "Tipo de resolucion invalido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (resolution_type === "new_slot" && (!new_slot_date || !new_slot_time)) {
      return new Response(JSON.stringify({ success: false, error: "Se requiere fecha y hora del nuevo slot" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if ((resolution_type === "increase_capacity" || resolution_type === "existing_slot" || resolution_type === "expand_capacity") && !target_slot_id) {
      return new Response(JSON.stringify({ success: false, error: "Se requiere el slot destino" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: slot, error: slotError } = await adminClient
      .from("tour_slots")
      .select("*, tours!inner(id, name, agency_id, vehicle_map_type, agencies!inner(id, user_id, name))")
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
    const tourName = (slot.tours as any).name;

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
      .select("id, user_id, deposit_amount, toursred_cash_used, booking_code, created_at, travelers_count")
      .eq("tour_id", tour_id)
      .eq("selected_date", slot.slot_date)
      .eq("selected_time", slot.departure_time)
      .in("status", ["confirmed", "pending"])
      .is("cancelled_at", null);

    if (bookingsError) throw bookingsError;

    if (!affectedBookings || affectedBookings.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "No hay reservas activas en este slot" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let finalTargetSlotId = target_slot_id;
    let availableSpotsInTarget: number | null = null;

    if (resolution_type === "new_slot") {
      const newSlotTime = new_slot_time.includes(":") && new_slot_time.split(":").length === 3
        ? new_slot_time
        : new_slot_time + ":00";

      const slotCapacity = new_capacity ? Number(new_capacity) : slot.capacity;

      const { data: newSlot, error: newSlotError } = await adminClient
        .from("tour_slots")
        .insert({
          tour_id: tour_id,
          agency_id: agencyId,
          schedule_id: slot.schedule_id,
          slot_date: new_slot_date,
          departure_time: newSlotTime,
          capacity: slotCapacity,
          booked_count: 0,
          status: "activo",
          is_auto_generated: false,
          min_travelers_reached: false,
          notes: `Creado por reagendamiento desde ${slot.slot_date} ${slot.departure_time}. Motivo: ${reason}`,
        })
        .select()
        .single();

      if (newSlotError || !newSlot) throw new Error("Error creando nuevo slot");
      finalTargetSlotId = newSlot.id;
      availableSpotsInTarget = slotCapacity;

    } else if (resolution_type === "increase_capacity") {
      const { data: targetSlot, error: targetSlotError } = await adminClient
        .from("tour_slots")
        .select("id, capacity, booked_count")
        .eq("id", target_slot_id)
        .single();

      if (targetSlotError || !targetSlot) {
        return new Response(JSON.stringify({ success: false, error: "Slot destino no encontrado" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const finalCapacity = new_capacity ? Number(new_capacity) : targetSlot.capacity;

      const updatePayload: any = { capacity: finalCapacity, status: "activo" };
      if (new_vehicle_map_type) {
        await adminClient
          .from("tours")
          .update({ vehicle_map_type: new_vehicle_map_type })
          .eq("id", tour_id);
      }

      const { error: updateCapacityError } = await adminClient
        .from("tour_slots")
        .update(updatePayload)
        .eq("id", target_slot_id);

      if (updateCapacityError) throw updateCapacityError;

      availableSpotsInTarget = finalCapacity - targetSlot.booked_count;

    } else if (resolution_type === "expand_capacity") {
      const { data: targetSlot, error: targetSlotError } = await adminClient
        .from("tour_slots")
        .select("id, capacity, booked_count")
        .eq("id", target_slot_id)
        .single();

      if (targetSlotError || !targetSlot) {
        return new Response(JSON.stringify({ success: false, error: "Slot destino no encontrado" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const totalAffectedTravelers = affectedBookings.reduce((sum: number, b: any) => sum + (b.travelers_count || 1), 0);
      const minRequired = targetSlot.booked_count + totalAffectedTravelers;
      const finalCapacity = Math.max(targetSlot.capacity, minRequired);

      const { error: updateCapacityError } = await adminClient
        .from("tour_slots")
        .update({ capacity: finalCapacity, status: "activo" })
        .eq("id", target_slot_id);

      if (updateCapacityError) throw updateCapacityError;
      availableSpotsInTarget = finalCapacity - targetSlot.booked_count;

    } else if (resolution_type === "existing_slot") {
      const { data: targetSlot, error: targetSlotError } = await adminClient
        .from("tour_slots")
        .select("id, capacity, booked_count")
        .eq("id", target_slot_id)
        .single();

      if (targetSlotError || !targetSlot) {
        return new Response(JSON.stringify({ success: false, error: "Slot destino no encontrado" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      availableSpotsInTarget = targetSlot.capacity - targetSlot.booked_count;
    }

    const totalAffectedTravelers = affectedBookings.reduce((sum: number, b: any) => sum + (b.travelers_count || 1), 0);
    const capacitySufficient = availableSpotsInTarget === null || availableSpotsInTarget >= totalAffectedTravelers;

    const responseDeadline = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

    const { data: rescheduleRequest, error: requestError } = await adminClient
      .from("slot_reschedule_requests")
      .insert({
        original_slot_id: slot_id,
        tour_id: tour_id,
        agency_id: agencyId,
        resolution_type: resolution_type,
        target_slot_id: finalTargetSlotId,
        reason: reason,
        response_deadline: responseDeadline,
        status: "pending_responses",
        affected_bookings_count: affectedBookings.length,
        created_by: user.id,
        available_spots_in_target: availableSpotsInTarget,
        new_capacity: new_capacity ? Number(new_capacity) : null,
        new_vehicle_map_type: new_vehicle_map_type || null,
      })
      .select()
      .single();

    if (requestError || !rescheduleRequest) throw new Error("Error creando solicitud de reagendado");

    await adminClient
      .from("tour_slots")
      .update({ status: "bloqueado" })
      .eq("id", slot_id);

    const { data: targetSlotData } = await adminClient
      .from("tour_slots")
      .select("slot_date, departure_time")
      .eq("id", finalTargetSlotId!)
      .single();

    const responseInserts = affectedBookings.map((booking: any) => ({
      request_id: rescheduleRequest.id,
      booking_id: booking.id,
      user_id: booking.user_id,
      response: "pending",
      booking_created_at: booking.created_at,
    }));

    const { error: responsesError } = await adminClient
      .from("slot_reschedule_responses")
      .insert(responseInserts);

    if (responsesError) throw responsesError;

    const bookingIds = affectedBookings.map((b: any) => b.id);
    const { error: bookingUpdateError } = await adminClient
      .from("bookings")
      .update({ has_pending_slot_reschedule: true })
      .in("id", bookingIds);

    if (bookingUpdateError) throw bookingUpdateError;

    const notificationPromises = affectedBookings.map(async (booking: any) => {
      const newDate = targetSlotData?.slot_date || new_slot_date;
      const newTime = targetSlotData?.departure_time || new_slot_time;

      const baseMessage = `Tu reserva en "${tourName}" ha sido movida. Tienes 12 horas para aceptar o rechazar el nuevo horario: ${newDate} a las ${newTime?.substring(0, 5)}.`;
      const priorityNote = !capacitySufficient
        ? " Los cupos se asignan en orden de respuesta — responde pronto para asegurar tu lugar."
        : "";

      await adminClient.rpc("create_user_notification", {
        p_user_id: booking.user_id,
        p_type: "slot_reschedule_pending",
        p_title: "Cambio de horario en tu reserva",
        p_message: baseMessage + priorityNote,
        p_data: {
          request_id: rescheduleRequest.id,
          booking_id: booking.id,
          tour_id: tour_id,
          original_date: slot.slot_date,
          original_time: slot.departure_time,
          new_date: newDate,
          new_time: newTime,
          response_deadline: responseDeadline,
          resolution_type: resolution_type,
          capacity_sufficient: capacitySufficient,
        },
      });

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
            reason: reason,
            response_deadline: responseDeadline,
            capacity_sufficient: capacitySufficient,
          }),
        }).catch(() => {})
      );
    });

    await Promise.all(notificationPromises);

    return new Response(
      JSON.stringify({
        success: true,
        request_id: rescheduleRequest.id,
        affected_bookings: affectedBookings.length,
        target_slot_id: finalTargetSlotId,
        response_deadline: responseDeadline,
        available_spots_in_target: availableSpotsInTarget,
        capacity_sufficient: capacitySufficient,
        message: capacitySufficient
          ? `Solicitud de reagendado creada. ${affectedBookings.length} viajero(s) tienen 12 horas para responder.`
          : `Solicitud de reagendado creada. Los cupos son limitados — los viajeros serán asignados por orden de respuesta.`,
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
