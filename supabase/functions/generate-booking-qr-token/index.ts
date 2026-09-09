import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";
import * as Sentry from "npm:@sentry/deno@9";
import { mensajeDeError } from "../_shared/errores.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Forma real de la fila del .select() de la reserva. Se declara a mano porque
// el cliente no lleva el tipo Database y supabase-js tipa los embeds to-one
// como arreglo; en runtime PostgREST devuelve un objeto.
type ReservaQr = {
  id: string;
  user_id: string;
  agency_id: string;
  tour: { start_date: string | null } | null;
  agency: { user_id: string } | null;
};

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    tracesSampleRate: 0.1,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const siteUrl = Deno.env.get("SITE_URL") || "https://toursred.com";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Esta funcion emite —y si no existe, CREA— el token de check-in de una
    // reserva. Antes era alcanzable sin credenciales: bastaba un booking_id
    // para obtener su token, escribir en booking_checkin_tokens y averiguar si
    // una reserva existe (404 contra 200).
    //
    // Mismo criterio de autorizacion que confirm-booking-checkin, que es quien
    // consume estos tokens: dueño de la reserva, dueño de la agencia del tour,
    // staff de esa agencia con can_scan_checkin, o admin.
    // El llamador interno es send-booking-confirmation, que pide el QR con el
    // SERVICE ROLE KEY para meterlo en el correo de confirmacion. Ese caso pasa
    // sin usuario detras, igual que en _shared/cfdiAuth.ts. Cualquier otro
    // llamador tiene que ser una persona con permiso sobre la reserva.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No autenticado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const bearer = authHeader.replace("Bearer ", "").trim();
    const isServiceRole = bearer.length > 0 && bearer === supabaseServiceKey;

    let user: { id: string } | null = null;

    if (!isServiceRole) {
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });

      // La llave publicable cae aqui: es un JWT valido del proyecto pero no de
      // un usuario, asi que getUser no devuelve a nadie y termina en 401.
      const { data: { user: authUser }, error: authError } = await userClient.auth.getUser();
      if (authError || !authUser) {
        return new Response(
          JSON.stringify({ error: "No autenticado" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      user = authUser;
    }

    const { booking_id } = await req.json();

    if (!booking_id) {
      return new Response(
        JSON.stringify({ error: "booking_id es requerido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // La reserva se lee ANTES de tocar el token: sin permiso no se confirma
    // siquiera que exista, para no dejar el oraculo de enumeracion.
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, user_id, agency_id, tour:tours(start_date), agency:agencies(user_id)")
      .eq("id", booking_id)
      .returns<ReservaQr[]>()
      .maybeSingle();

    if (bookingError || !booking) {
      return new Response(
        JSON.stringify({ error: "Reserva no encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (user) {
      const { data: currentUser } = await supabase
        .from("users")
        .select("id, role")
        .eq("id", user.id)
        .maybeSingle();

      const agency = Array.isArray(booking.agency) ? booking.agency[0] : booking.agency;
      const isBookingOwner = booking.user_id === user.id;
      const isAgencyOwner = agency?.user_id === user.id;
      const isAdmin = currentUser?.role === "admin" || currentUser?.role === "super_admin";

      let isAuthorizedStaff = false;
      if (!isBookingOwner && !isAgencyOwner && !isAdmin && booking.agency_id) {
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

      if (!isBookingOwner && !isAgencyOwner && !isAdmin && !isAuthorizedStaff) {
        console.warn(
          `QR de check-in denegado: usuario ${user.id} pidio el token de la reserva ${booking_id}`
        );
        return new Response(
          JSON.stringify({ error: "No tienes permiso sobre esta reserva" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const { data: existing } = await supabase
      .from("booking_checkin_tokens")
      .select("token")
      .eq("booking_id", booking_id)
      .maybeSingle();

    if (existing) {
      const qrUrl = `${siteUrl}/booking-checkin?token=${existing.token}`;
      return new Response(
        JSON.stringify({ success: true, token: existing.token, qr_url: qrUrl }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // tours.start_date es nullable. Sin este guard, `new Date(null)` daba
    // Invalid Date, expires_at salia NaN y el INSERT de abajo fallaba con un
    // error de Postgres que no decia nada de la fecha faltante.
    if (!booking.tour?.start_date) {
      return new Response(
        JSON.stringify({ error: "El tour de esta reserva no tiene fecha de inicio" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tourStartDate = new Date(booking.tour.start_date);
    const expiresAt = new Date(tourStartDate.getTime() + 24 * 60 * 60 * 1000);

    const { data: tokenRecord, error: insertError } = await supabase
      .from("booking_checkin_tokens")
      .insert({
        booking_id,
        expires_at: expiresAt.toISOString(),
      })
      .select("token")
      .maybeSingle();

    if (insertError || !tokenRecord) {
      console.error("Error creando token:", insertError);
      return new Response(
        JSON.stringify({ error: "Error al generar el token de check-in" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const qrUrl = `${siteUrl}/booking-checkin?token=${tokenRecord.token}`;

    return new Response(
      JSON.stringify({ success: true, token: tokenRecord.token, qr_url: qrUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error en generate-booking-qr-token:", error);
    if (sentryDsn) {
      Sentry.captureException(error, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return new Response(
      JSON.stringify({ error: "Error interno del servidor", details: mensajeDeError(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
