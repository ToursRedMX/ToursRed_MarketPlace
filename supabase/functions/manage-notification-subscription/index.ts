import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import Stripe from "npm:stripe@22.3.0";
import * as Sentry from "npm:@sentry/deno@9.47.1";
import { corsHeaders as corsDe, origenParaRedirigir } from "../_shared/cors.ts";
import { mensajeDeError } from "../_shared/errores.ts";
import { requireUser } from "../_shared/auth.ts";
import { opcionesConContexto, sinUserAgentDeNavegador } from "../_shared/contextoAuditoria.ts";
import { sincronizarSuscripcion } from "../_shared/suscripcionNotificaciones.ts";

// Administra la suscripcion de notificaciones del viajero o de una agencia (solo su dueno):
//   precio  -> el monto mensual que cobra Stripe por ese plan (se lee del Price, no se captura dos veces)
//   portal  -> sesion del portal de Stripe para cambiar de tarjeta o ver facturas
//   cancel  -> cancela al terminar el periodo (sigue cubierta hasta entonces)
//   resume  -> deshace la cancelacion pendiente
// Los estados los confirma despues stripe-webhook; aqui se sincroniza tambien para que la pantalla no espere al evento.

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    release: Deno.env.get("SENTRY_RELEASE"),
    tracesSampleRate: 0.1,
  });
}

class ErrorDeNegocio extends Error {}

Deno.serve(async (req: Request) => {
  const cors = corsDe(req);
  const responder = (cuerpo: Record<string, unknown>, status: number) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });

  try {
    const auth = await requireUser(req, { recurso: "manage-notification-subscription", cors });
    if (!auth.ok) return auth.response;
    const userId = auth.llamador.userId;
    if (!userId) return responder({ error: "No autorizado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) throw new ErrorDeNegocio("Stripe no esta configurado");

    const { action, tipo, agency_id: agencyId } = await req.json();
    if (!["precio", "portal", "cancel", "resume"].includes(action)) throw new ErrorDeNegocio("Accion invalida");
    if (tipo !== "viajero" && tipo !== "agencia") throw new ErrorDeNegocio("Tipo de suscripcion invalido");
    if (tipo === "agencia" && !agencyId) throw new ErrorDeNegocio("Falta la agencia");

    const usuario = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    });
    const { data: estado, error: errorEstado } = await usuario.rpc("mi_cobertura_notificaciones", {
      p_agency: tipo === "agencia" ? agencyId : null,
    });
    if (errorEstado || !estado) return responder({ error: "No tienes acceso a esta agencia" }, 403);
    if (!estado.es_dueno) throw new ErrorDeNegocio("Solo el dueno de la agencia administra las notificaciones");

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, sinUserAgentDeNavegador(opcionesConContexto(req)));
    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2026-06-24.dahlia" });

    if (action === "precio") {
      const { data: ajustes } = await admin.from("platform_settings")
        .select("stripe_price_notificaciones_viajero, stripe_price_notificaciones_agencia").maybeSingle();
      const priceId = tipo === "viajero" ? ajustes?.stripe_price_notificaciones_viajero : ajustes?.stripe_price_notificaciones_agencia;
      if (!priceId) return responder({ monto: null, moneda: null }, 200);
      const precio = await stripe.prices.retrieve(priceId);
      return responder({
        monto: typeof precio.unit_amount === "number" ? precio.unit_amount / 100 : null,
        moneda: precio.currency.toUpperCase(),
        intervalo: precio.recurring?.interval ?? null,
      }, 200);
    }

    // Las demas acciones recaen sobre la suscripcion viva del sujeto.
    const consulta = admin.from("suscripciones_notificaciones")
      .select("stripe_subscription_id, stripe_customer_id, status")
      .eq("tipo", tipo)
      .in("status", ["active", "trialing", "past_due"]);
    const { data: fila } = await (tipo === "viajero" ? consulta.eq("user_id", userId) : consulta.eq("agency_id", agencyId))
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!fila?.stripe_subscription_id) throw new ErrorDeNegocio("No hay una suscripcion de notificaciones activa");

    if (action === "portal") {
      if (!fila.stripe_customer_id) throw new ErrorDeNegocio("La suscripcion no tiene cliente de Stripe");
      const volver = tipo === "viajero" ? "/traveler/profile" : "/agency/profile";
      const sesion = await stripe.billingPortal.sessions.create({
        customer: fila.stripe_customer_id,
        return_url: `${origenParaRedirigir(req)}${volver}`,
      });
      return responder({ url: sesion.url }, 200);
    }

    const sub = await stripe.subscriptions.update(fila.stripe_subscription_id, { cancel_at_period_end: action === "cancel" });
    await sincronizarSuscripcion(admin, sub);
    return responder({ ok: true, cancel_at_period_end: sub.cancel_at_period_end }, 200);
  } catch (error) {
    if (!(error instanceof ErrorDeNegocio)) {
      console.error("manage-notification-subscription:", error);
      if (sentryDsn) {
        Sentry.captureException(error, {
          tags: { execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown", region: Deno.env.get("SB_REGION") || "unknown" },
        });
        await Sentry.flush(2000);
      }
    }
    return responder({ error: mensajeDeError(error) || "No se pudo completar la accion" }, 400);
  }
});
