import "jsr:@supabase/functions-js@2.112.4/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import * as Sentry from "npm:@sentry/deno@9.47.1";
import { requireUser } from "../_shared/auth.ts";
import { enviarCorreoSimple } from "../_shared/correoSimple.ts";
import { mensajeDeError } from "../_shared/errores.ts";

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    release: Deno.env.get("SENTRY_RELEASE"),
    tracesSampleRate: 0.1,
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Ventana en la que un cambio de vehiculo cuenta como "recien hecho": evita que quien vuelva a
// llamar la funcion reenvie el correo por un cambio de hace dias.
const VENTANA_MS = 15 * 60 * 1000;

const escapar = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const respuesta = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface FilaReserva {
  id: string;
  user_id: string;
  booking_code: string | null;
  selected_date: string | null;
  selected_time: string | null;
  tour: { name: string } | null;
  user: { first_name: string | null; email: string | null } | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const auth = await requireUser(req, { recurso: "notify-slot-vehicle-change", cors: corsHeaders });
    if (!auth.ok) return auth.response;

    const { tour_id, slot_ids } = await req.json() as { tour_id?: string; slot_ids?: string[] };
    if (!tour_id || !Array.isArray(slot_ids) || slot_ids.length === 0 || slot_ids.length > 200) {
      return respuesta({ error: "tour_id y slot_ids son requeridos" }, 400);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: tour } = await admin.from("tours").select("agency_id").eq("id", tour_id).maybeSingle();
    if (!tour) return respuesta({ error: "Tour no encontrado" }, 404);

    // Misma regla que la base para cambiar el vehiculo (external_sale_access 'manage'), evaluada
    // como la persona que llama: nadie manda correos a viajeros de una agencia ajena.
    if (!auth.llamador.esServiceRole && !auth.llamador.esAdmin) {
      const bearer = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
      const comoUsuario = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${bearer}` } },
      });
      const { data: permitido } = await comoUsuario.rpc("external_sale_access", { p_agency_id: tour.agency_id, p_action: "manage" });
      if (permitido !== true) return respuesta({ error: "No tienes permiso sobre este tour" }, 403);
    }

    const desde = new Date(Date.now() - VENTANA_MS).toISOString();
    const { data: reservas, error } = await admin
      .from("bookings")
      .select("id, user_id, booking_code, selected_date, selected_time, tour:tours(name), user:users!bookings_user_id_fkey(first_name, email)")
      .eq("tour_id", tour_id)
      .in("slot_id", slot_ids)
      .in("status", ["confirmed", "pending"])
      .eq("needs_seat_reselection", true)
      .eq("seat_reselection_reason", "vehicle_change")
      .gte("updated_at", desde);
    if (error) throw error;

    const platform = await admin.from("platform_settings").select("platform_url").maybeSingle();
    const appUrl = platform.data?.platform_url || "https://toursredmx.netlify.app";

    let enviados = 0;
    let fallidos = 0;
    for (const r of (reservas ?? []) as unknown as FilaReserva[]) {
      const email = r.user?.email;
      if (!email) { fallidos++; continue; }
      const fecha = r.selected_date
        ? new Date(r.selected_date + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
        : "";
      const nombre = escapar(r.user?.first_name || "viajero");
      const tourName = escapar(r.tour?.name || "tu tour");
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
<div style="background: #1e40af; padding: 24px; border-radius: 10px 10px 0 0; text-align: center;"><h1 style="color: white; margin: 0; font-size: 22px;">Cambio de transporte en tu salida</h1></div>
<div style="background: #f9f9f9; padding: 28px; border-radius: 0 0 10px 10px;">
<p>Hola ${nombre},</p>
<p>Por temas de logística, la agencia cambió el transporte de tu salida de <strong>${tourName}</strong>${fecha ? ` del <strong>${escapar(fecha)}</strong>` : ""}${r.booking_code ? ` (reserva <strong>${escapar(r.booking_code)}</strong>)` : ""}.</p>
<p>Como el nuevo vehículo tiene otra distribución, <strong>necesitas elegir de nuevo tus asientos</strong>. Tu reserva y tu pago no cambian.</p>
<p style="text-align: center; margin: 28px 0;"><a href="${escapar(appUrl)}/traveler/bookings" style="background: #1e40af; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">Elegir mis asientos</a></p>
<p style="font-size: 12px; color: #999; margin-top: 28px; padding-top: 16px; border-top: 1px solid #ddd;">ToursRed · Mensaje automático sobre tu reserva.</p>
</div></body></html>`;
      const ok = await enviarCorreoSimple(admin, email, "Cambio de transporte: elige de nuevo tus asientos", html);
      if (ok) enviados++; else fallidos++;
    }

    return respuesta({ success: true, enviados, fallidos });
  } catch (err) {
    console.error("notify-slot-vehicle-change:", mensajeDeError(err));
    Sentry.captureException(err);
    return respuesta({ error: "No se pudo enviar el aviso" }, 500);
  }
});
