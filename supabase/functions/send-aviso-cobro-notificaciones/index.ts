import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import Stripe from "npm:stripe@22.3.0";
import * as Sentry from "npm:@sentry/deno@9.47.1";
import { corsHeaders as corsDe } from "../_shared/cors.ts";
import { mensajeDeError } from "../_shared/errores.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { opcionesConContexto, sinUserAgentDeNavegador } from "../_shared/contextoAuditoria.ts";
import { enviarCorreo, leerAjustesCorreo } from "../_shared/correo/enviarCorreo.ts";
import { construirAviso, REMITENTE_AVISO, type TipoAviso } from "../_shared/avisoCobroNotificaciones.ts";

// Avisa por correo, ANTES de que empiece el cobro, que los avisos por SMS pasan a ser una suscripcion. Solo administradores.
//   modo 'simular' (por omision): cuenta a quien se avisaria, sin mandar nada.
//   modo 'enviar': manda un correo por persona. Quien ya recibio el aviso para ESTA fecha de inicio no lo recibe otra vez, asi que
//   reintentar tras un corte no duplica. Se manda por tandas (TOPE_POR_LLAMADA) y la respuesta dice cuantos faltan.
// Solo avisa a quien perderia algo (ver la migracion 20261023064502). El codigo de verificacion nunca entra al cobro.

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    release: Deno.env.get("SENTRY_RELEASE"),
    tracesSampleRate: 0.1,
  });
}

const TOPE_POR_LLAMADA = 200;

class ErrorDeNegocio extends Error {}

interface Destinatario {
  user_id: string;
  tipo: TipoAviso;
  agency_id: string | null;
  email: string;
  nombre: string | null;
  agencia: string | null;
}

Deno.serve(async (req: Request) => {
  const cors = corsDe(req);
  const responder = (cuerpo: Record<string, unknown>, status: number) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });

  try {
    const auth = await requireAdmin(req, { recurso: "send-aviso-cobro-notificaciones", cors });
    if (!auth.ok) return auth.response;

    const cuerpo = await req.json().catch(() => ({}));
    const modo = cuerpo?.modo === "enviar" ? "enviar" : "simular";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, sinUserAgentDeNavegador(opcionesConContexto(req)));

    const { data: ajustes } = await admin.from("platform_settings")
      .select("cobro_notificaciones_activo, cobro_notificaciones_desde, stripe_price_notificaciones_viajero, stripe_price_notificaciones_agencia, platform_url")
      .maybeSingle();
    if (!ajustes) throw new ErrorDeNegocio("No se pudo leer la configuracion");

    // Solo tiene sentido avisar de algo que esta programado y todavia no empieza.
    if (!ajustes.cobro_notificaciones_activo) throw new ErrorDeNegocio("Enciende el cobro de notificaciones antes de avisar (con la fecha de inicio a futuro)");
    const desde = ajustes.cobro_notificaciones_desde ? new Date(ajustes.cobro_notificaciones_desde) : null;
    if (!desde || Number.isNaN(desde.getTime())) throw new ErrorDeNegocio("Fija la fecha de inicio del cobro antes de avisar");
    if (desde.getTime() <= Date.now()) throw new ErrorDeNegocio("El cobro ya empezo: un aviso previo ya no tiene sentido");
    if (!ajustes.stripe_price_notificaciones_viajero || !ajustes.stripe_price_notificaciones_agencia) {
      throw new ErrorDeNegocio("Captura los dos Price IDs de Stripe antes de avisar: el correo dice cuanto cuesta");
    }

    // El monto sale de Stripe (la misma fuente que ve el usuario en su perfil); si no se puede leer, el correo lo dice sin cifra.
    const montos: Record<TipoAviso, number | null> = { viajero: null, agencia: null };
    const llave = Deno.env.get("STRIPE_SECRET_KEY");
    if (llave) {
      const stripe = new Stripe(llave, { apiVersion: "2026-06-24.dahlia" });
      for (const [tipo, id] of [["viajero", ajustes.stripe_price_notificaciones_viajero], ["agencia", ajustes.stripe_price_notificaciones_agencia]] as const) {
        try {
          const precio = await stripe.prices.retrieve(id);
          montos[tipo] = typeof precio.unit_amount === "number" ? precio.unit_amount / 100 : null;
        } catch (e) {
          console.error(`send-aviso-cobro-notificaciones: no se pudo leer el precio ${tipo}: ${mensajeDeError(e)}`);
        }
      }
    }

    const { data: audiencia, error: errAudiencia } = await admin.rpc("audiencia_aviso_cobro_notificaciones");
    if (errAudiencia) throw new Error(`No se pudo calcular la audiencia: ${errAudiencia.message}`);
    const destinatarios = (audiencia ?? []) as Destinatario[];
    const resumen = {
      desde: desde.toISOString(),
      por_avisar: destinatarios.length,
      viajeros: destinatarios.filter((d) => d.tipo === "viajero").length,
      agencias: destinatarios.filter((d) => d.tipo === "agencia").length,
      montos,
    };
    if (modo === "simular") return responder({ modo, ...resumen }, 200);

    const urlBase = (ajustes.platform_url || "https://toursred.com").replace(/\/+$/, "");
    const cfg = await leerAjustesCorreo(admin);
    let enviados = 0;
    let fallidos = 0;
    for (const d of destinatarios.slice(0, TOPE_POR_LLAMADA)) {
      // Se reserva la fila ANTES de mandar: si dos llamadas corren a la vez, la segunda choca con la unicidad y no duplica.
      const { error: errReserva } = await admin.from("avisos_cobro_notificaciones").insert({
        user_id: d.user_id, tipo: d.tipo, agency_id: d.agency_id, correo: d.email, fecha_inicio: desde.toISOString(),
      });
      if (errReserva) {
        if ((errReserva as { code?: string }).code !== "23505") console.error(`send-aviso-cobro-notificaciones: no se pudo reservar el aviso: ${errReserva.message}`);
        continue;
      }
      const aviso = construirAviso({ tipo: d.tipo, nombre: d.nombre, agencia: d.agencia, desde, montoMxn: montos[d.tipo], urlBase });
      const r = await enviarCorreo(admin, { para: d.email, asunto: aviso.asunto, html: aviso.html, texto: aviso.texto, remitente: REMITENTE_AVISO }, cfg);
      if (r.ok) {
        enviados++;
      } else {
        // No salio: se libera la reserva para poder reintentar. Si fue «incierto» el proveedor pudo haberlo aceptado, pero un
        // reintento duplicado es mejor que un aviso que nunca llega.
        fallidos++;
        await admin.from("avisos_cobro_notificaciones").delete()
          .eq("user_id", d.user_id).eq("tipo", d.tipo).eq("fecha_inicio", desde.toISOString());
      }
    }
    return responder({ modo, ...resumen, enviados, fallidos, faltan: Math.max(0, destinatarios.length - TOPE_POR_LLAMADA) }, 200);
  } catch (error) {
    if (!(error instanceof ErrorDeNegocio)) {
      console.error("send-aviso-cobro-notificaciones:", error);
      if (sentryDsn) {
        Sentry.captureException(error, {
          tags: { execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown", region: Deno.env.get("SB_REGION") || "unknown" },
        });
        await Sentry.flush(2000);
      }
    }
    return responder({ error: mensajeDeError(error) || "No se pudo avisar" }, 400);
  }
});
