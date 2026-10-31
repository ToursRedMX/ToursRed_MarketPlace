import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import Stripe from "npm:stripe@22.3.0";
import * as Sentry from "npm:@sentry/deno@9.47.1";
import { corsHeaders as corsDe, origenParaRedirigir } from "../_shared/cors.ts";
import { mensajeDeError } from "../_shared/errores.ts";
import { requireUser } from "../_shared/auth.ts";
import { clienteStripeVigente } from "../_shared/clienteStripe.ts";
import { opcionesConContexto, sinUserAgentDeNavegador } from "../_shared/contextoAuditoria.ts";
import { MARCA_SUSCRIPCION } from "../_shared/suscripcionNotificaciones.ts";

// Abre el Checkout de Stripe de la suscripcion mensual de notificaciones: la del viajero, o la de una agencia (la paga su dueno
// y cubre al dueno y a su personal). El OTP no entra: es gratis siempre. La suscripcion la registra stripe-webhook.

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
    const auth = await requireUser(req, { recurso: "create-notification-subscription", cors });
    if (!auth.ok) return auth.response;
    const userId = auth.llamador.userId;
    // Una suscripcion es de una persona: el service role no paga por nadie.
    if (!userId) return responder({ error: "No autorizado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) throw new ErrorDeNegocio("Stripe no esta configurado");

    const { tipo, agency_id: agencyId } = await req.json();
    if (tipo !== "viajero" && tipo !== "agencia") throw new ErrorDeNegocio("Tipo de suscripcion invalido");
    if (tipo === "agencia" && !agencyId) throw new ErrorDeNegocio("Falta la agencia");

    // Lo que ve ESTA persona (RLS y auth.uid()): si es dueno, si ya esta cubierta y por que.
    const usuario = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    });
    const { data: estado, error: errorEstado } = await usuario.rpc("mi_cobertura_notificaciones", {
      p_agency: tipo === "agencia" ? agencyId : null,
    });
    if (errorEstado || !estado) return responder({ error: "No tienes acceso a esta agencia" }, 403);

    if (!estado.es_dueno) throw new ErrorDeNegocio("Solo el dueno de la agencia puede contratar las notificaciones");
    if (!estado.activo) throw new ErrorDeNegocio("El cobro de notificaciones aun no esta activo");
    if (estado.cobertura === "plus") throw new ErrorDeNegocio("Con ToursRed Plus las notificaciones ya van incluidas");
    const sub = estado.suscripcion;
    if (sub && ["active", "trialing", "past_due"].includes(sub.status)) {
      throw new ErrorDeNegocio("Ya tienes una suscripcion de notificaciones. Administrala desde tu perfil");
    }

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, sinUserAgentDeNavegador(opcionesConContexto(req)));
    const { data: ajustes } = await admin.from("platform_settings")
      .select("stripe_price_notificaciones_viajero, stripe_price_notificaciones_agencia").maybeSingle();
    const priceId = tipo === "viajero" ? ajustes?.stripe_price_notificaciones_viajero : ajustes?.stripe_price_notificaciones_agencia;
    if (!priceId) throw new ErrorDeNegocio("El precio de esta suscripcion aun no esta configurado");

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2026-06-24.dahlia" });

    // Cliente de Stripe: el de una suscripcion anterior de este mismo sujeto, si todavia existe en la cuenta de la llave actual.
    const previa = await admin.from("suscripciones_notificaciones").select("stripe_customer_id")
      .eq("tipo", tipo)
      .eq(tipo === "viajero" ? "user_id" : "agency_id", tipo === "viajero" ? userId : agencyId)
      .not("stripe_customer_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    let customerId: string | null = previa.data?.stripe_customer_id ?? null;
    if (customerId && !(await clienteStripeVigente(stripe, customerId))) customerId = null;

    if (!customerId) {
      const { data: persona } = await admin.from("users").select("email, first_name, last_name").eq("id", userId).maybeSingle();
      let nombre = `${persona?.first_name ?? ""} ${persona?.last_name ?? ""}`.trim();
      if (tipo === "agencia") {
        const { data: agencia } = await admin.from("agencies").select("name").eq("id", agencyId).maybeSingle();
        nombre = agencia?.name ?? nombre;
      }
      const cliente = await stripe.customers.create({
        email: persona?.email ?? undefined,
        name: nombre || persona?.email || undefined,
        metadata: { supabase_user_id: userId, ...(tipo === "agencia" ? { agency_id: agencyId } : {}) },
      });
      customerId = cliente.id;
    }

    // La marca va en la sesion Y en la suscripcion. NO se usa `user_id`: es la llave del webhook de Plus.
    const metadata: Record<string, string> = {
      tipo_suscripcion: MARCA_SUSCRIPCION,
      sujeto: tipo,
      ...(tipo === "viajero" ? { notif_user_id: userId } : { notif_agency_id: agencyId, notif_pagador_id: userId }),
    };
    const origen = origenParaRedirigir(req);
    const volver = tipo === "viajero" ? "/traveler/profile" : "/agency/profile";
    const sesion = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origen}${volver}?notificaciones=ok`,
      cancel_url: `${origen}${volver}?notificaciones=cancelado`,
      metadata,
      subscription_data: { metadata },
    });

    return responder({ url: sesion.url }, 200);
  } catch (error) {
    if (!(error instanceof ErrorDeNegocio)) {
      console.error("create-notification-subscription:", error);
      if (sentryDsn) {
        Sentry.captureException(error, {
          tags: { execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown", region: Deno.env.get("SB_REGION") || "unknown" },
        });
        await Sentry.flush(2000);
      }
    }
    return responder({ error: mensajeDeError(error) || "No se pudo iniciar la suscripcion" }, 400);
  }
});
