import "jsr:@supabase/functions-js@2.112.4/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import * as Sentry from "npm:@sentry/deno@9.47.1";
import { opcionesConContexto, sinUserAgentDeNavegador } from "../_shared/contextoAuditoria.ts";
import { mensajeDeError } from "../_shared/errores.ts";

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

interface ApproveBookingRequest {
  booking_id: string;
  action: "approve" | "reject";
  notes?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey, sinUserAgentDeNavegador(opcionesConContexto(req)));

    // Verificar que el usuario autenticado sea agencia o admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, opcionesConContexto(req, {
      global: { headers: { Authorization: authHeader } },
    }));

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { booking_id, action, notes }: ApproveBookingRequest = await req.json();

    if (!booking_id || !action) {
      return new Response(JSON.stringify({ error: "Parámetros requeridos: booking_id, action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Leer la reserva con todos los campos necesarios
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, status, agency_id")
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      return new Response(JSON.stringify({ error: "Reserva no encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (booking.status === 'cancellation_processing') {
      return new Response(JSON.stringify({ error: "Esta reserva tiene una cancelación en proceso" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verificar permisos: admin/super_admin, dueño de agencia, o staff de la agencia
    const { data: currentUser } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    const isAdmin = currentUser?.role === "admin" || currentUser?.role === "super_admin";

    // El dueño de la agencia tiene agencies.user_id = user.id
    const { data: ownedAgency } = await supabase
      .from("agencies")
      .select("id")
      .eq("user_id", user.id)
      .eq("id", booking.agency_id)
      .maybeSingle();

    const isAgencyOwner = !!ownedAgency;

    // Staff de agencia: agency_staff.user_id = user.id y agency_staff.agency_id = booking.agency_id
    let isAgencyStaff = false;
    if (!isAdmin && !isAgencyOwner) {
      const { data: staffRecord } = await supabase
        .from("agency_staff")
        .select("id")
        .eq("user_id", user.id)
        .eq("agency_id", booking.agency_id)
        .eq("is_active", true)
        .maybeSingle();
      isAgencyStaff = !!staffRecord;
    }

    if (!isAdmin && !isAgencyOwner && !isAgencyStaff) {
      return new Response(JSON.stringify({ error: "Sin permisos para esta reserva" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();

    // Si es rechazo, solo actualizar approval_status
    if (action === "reject") {
      const { error: updateError } = await supabase
        .from("bookings")
        .update({
          approval_status: "rejected",
          approval_notes: notes || null,
          approved_at: null,
          approved_by: user.id,
          updated_at: now,
        })
        .eq("id", booking_id);

      if (updateError) throw new Error(updateError.message);

      return new Response(
        JSON.stringify({ success: true, auto_confirmed: false, action: "rejected" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- FLUJO DE APROBACION ---
    //
    // Aprobar NUNCA mueve dinero del viajero (13-oct-2026). Hasta esa fecha, si el saldo y los puntos
    // comprometidos al crear la reserva cubrian el 100%, esta funcion —que la dispara la AGENCIA— descontaba
    // ToursRed Cash y puntos del viajero y confirmaba la reserva: gastar saldo sin que el viajero escribiera
    // su codigo MFA, que es lo que exigen todos los demas caminos de gasto. Ahora la aprobacion solo abre la
    // ventana de pago de 12 h y el viajero completa el pago desde «Completar Pago»
    // (confirm-booking-wallet-payment / procesadores), donde SI se pide el codigo.
    //
    // Medido contra la base el 13-oct-2026: 0 reservas se habian autoconfirmado por este camino.

    // Aprobar: actualizar approval_status y dar 12h para que el viajero pague (con su codigo MFA si usa saldo).
    const paymentDueAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        approval_status: "approved",
        approval_notes: notes || null,
        approved_at: now,
        approved_by: user.id,
        payment_due_at: paymentDueAt,
        updated_at: now,
      })
      .eq("id", booking_id);

    if (updateError) throw new Error(updateError.message);

    return new Response(
      JSON.stringify({ success: true, auto_confirmed: false, action: "approved" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error en approve-booking:", error);
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
      JSON.stringify({ success: false, error: mensajeDeError(error) || "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
