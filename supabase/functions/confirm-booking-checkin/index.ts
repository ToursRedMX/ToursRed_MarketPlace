import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No autenticado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "No autenticado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { token, checkin_type, no_show_traveler_ids, scanned_by_staff_id } = await req.json();

    if (!token || !checkin_type || !['full', 'partial'].includes(checkin_type)) {
      return new Response(
        JSON.stringify({ error: "token y checkin_type (full|partial) son requeridos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (checkin_type === 'partial' && (!no_show_traveler_ids || no_show_traveler_ids.length === 0)) {
      return new Response(
        JSON.stringify({ error: "Para check-in parcial debes indicar los viajeros que no se presentaron" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: tokenRecord, error: tokenError } = await supabase
      .from("booking_checkin_tokens")
      .select("id, booking_id, expires_at, redeemed_at")
      .eq("token", token)
      .maybeSingle();

    if (tokenError || !tokenRecord) {
      return new Response(
        JSON.stringify({ error: "Token no válido o no encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (tokenRecord.redeemed_at) {
      return new Response(
        JSON.stringify({ error: "Este código QR ya fue utilizado para hacer check-in" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date();
    if (new Date(tokenRecord.expires_at) < now) {
      return new Response(
        JSON.stringify({ error: "Este código QR ha expirado (venció 24h después del inicio del tour)" }),
        { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        id, user_id, agency_id, status, booking_code,
        tour:tours(name, start_date),
        traveler:users!bookings_user_id_fkey(id, first_name, last_name, email, no_show_count),
        agency:agencies(id, name, user_id, contact_email)
      `)
      .eq("id", tokenRecord.booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      return new Response(
        JSON.stringify({ error: "Reserva no encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: currentUser } = await supabase
      .from("users")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle();

    const isAgencyOwner = booking.agency?.user_id === user.id;
    const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';

    // Check if user is an authorized coordinator for this agency
    let isAuthorizedStaff = false;
    if (!isAgencyOwner && !isAdmin) {
      const { data: staffRecord } = await supabase
        .from("agency_staff")
        .select("id, agency_staff_permissions(can_scan_checkin)")
        .eq("user_id", user.id)
        .eq("agency_id", booking.agency_id)
        .eq("is_active", true)
        .maybeSingle();

      if (staffRecord) {
        const perms = Array.isArray(staffRecord.agency_staff_permissions)
          ? staffRecord.agency_staff_permissions[0]
          : staffRecord.agency_staff_permissions;
        isAuthorizedStaff = perms?.can_scan_checkin === true;
      }
    }

    if (!isAgencyOwner && !isAdmin && !isAuthorizedStaff) {
      return new Response(
        JSON.stringify({ error: "Solo la agencia del tour puede confirmar el check-in" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (booking.status === 'cancelled') {
      return new Response(
        JSON.stringify({ error: "No se puede hacer check-in de una reserva cancelada" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const checkinAt = now.toISOString();

    await supabase
      .from("bookings")
      .update({
        checkin_status: checkin_type,
        checkin_at: checkinAt,
        status: 'completed',
      })
      .eq("id", tokenRecord.booking_id);

    await supabase
      .from("booking_checkin_tokens")
      .update({
        redeemed_at: checkinAt,
        ...(scanned_by_staff_id ? { scanned_by_staff_id } : {}),
      })
      .eq("id", tokenRecord.id);

    let noShowTravelerNames: string[] = [];

    if (checkin_type === 'partial' && no_show_traveler_ids?.length > 0) {
      await supabase
        .from("booking_travelers")
        .update({ is_no_show: true })
        .in("id", no_show_traveler_ids)
        .eq("booking_id", tokenRecord.booking_id);

      const { data: noShowTravelers } = await supabase
        .from("booking_travelers")
        .select("nombre")
        .in("id", no_show_traveler_ids);

      noShowTravelerNames = (noShowTravelers || []).map((t: any) => t.nombre);

      await supabase
        .from("users")
        .update({ no_show_count: (booking.traveler?.no_show_count || 0) + 1 })
        .eq("id", booking.user_id);
    }

    EdgeRuntime.waitUntil(
      fetch(`${supabaseUrl}/functions/v1/send-checkin-confirmation-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          booking_id: tokenRecord.booking_id,
          checkin_type,
          no_show_traveler_names: noShowTravelerNames,
        }),
      }).catch((err) => console.error("Error enviando email de check-in:", err))
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: checkin_type === 'full'
          ? "Check-in completo confirmado exitosamente"
          : `Check-in parcial confirmado. ${noShowTravelerNames.length} viajero(s) marcados como no show.`,
        checkin_type,
        checkin_at: checkinAt,
        no_show_travelers: noShowTravelerNames,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error en confirm-booking-checkin:", error);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor", details: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
