// Suscripcion mensual de las notificaciones (SMS de reserva y avisos), cobrada con Stripe. Ver la migracion
// 20261023003356 (reglas de cobertura) y 20261023011842 (Price IDs).
//
// Una suscripcion de notificaciones viaja en Stripe con su PROPIA marca en el metadata, a proposito distinta a la de ToursRed
// Plus: el webhook de membresias lee `metadata.user_id` y hace `upsert` en `memberships`, asi que una suscripcion de
// notificaciones que usara esa llave se convertiria en una membresia Plus regalada. Por eso aqui el sujeto va en
// `notif_user_id` / `notif_agency_id`, y `stripe-webhook` pregunta primero a este modulo si el evento es suyo.
//
// El OTP nunca entra al cobro (ni aqui ni en la cobertura): es de seguridad y siempre es gratis.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import type Stripe from "npm:stripe@22.3.0";

export type TipoSuscripcion = "viajero" | "agencia";
export type EstadoSuscripcion = "incomplete" | "trialing" | "active" | "past_due" | "canceled" | "unpaid";

export const MARCA_SUSCRIPCION = "notificaciones";

type Metadata = Record<string, string> | null | undefined;

export function esSuscripcionDeNotificaciones(metadata: Metadata): boolean {
  return metadata?.tipo_suscripcion === MARCA_SUSCRIPCION;
}

/** El sujeto que paga. null si la marca no trae un sujeto coherente (no se adivina a quien cubrir). */
export function sujetoDeMetadata(
  metadata: Metadata,
): { tipo: "viajero"; userId: string; agencyId: null } | { tipo: "agencia"; userId: null; agencyId: string } | null {
  if (!esSuscripcionDeNotificaciones(metadata)) return null;
  if (metadata?.sujeto === "viajero" && metadata.notif_user_id) {
    return { tipo: "viajero", userId: metadata.notif_user_id, agencyId: null };
  }
  if (metadata?.sujeto === "agencia" && metadata.notif_agency_id) {
    return { tipo: "agencia", userId: null, agencyId: metadata.notif_agency_id };
  }
  return null;
}

/**
 * Estados de Stripe -> los de la tabla. Que una suscripcion este 'active' NO basta para estar cubierto: la cobertura tambien
 * exige el periodo vigente; y un pago fallido no la descubre al instante, la cubre la gracia.
 */
export function estadoLocal(estadoStripe: string): EstadoSuscripcion {
  switch (estadoStripe) {
    case "incomplete":
    case "trialing":
    case "active":
    case "past_due":
    case "unpaid":
      return estadoStripe;
    case "paused":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
    default:
      return "canceled";
  }
}

export function finDeGracia(ahora: Date, diasGracia: number): Date {
  return new Date(ahora.getTime() + Math.max(0, diasGracia) * 86_400_000);
}

/**
 * Que hacer con la gracia segun el estado resultante de la suscripcion.
 *   - al corriente (active/trialing) o dada de baja (canceled/unpaid): se limpia. Pagar cierra la gracia; y una suscripcion que
 *     Stripe ya dio por perdida no debe seguir cubriendo por una gracia vieja.
 *   - past_due / incomplete: no se toca (la fija el aviso del pago fallido, una sola vez).
 */
export function accionDeGracia(estado: EstadoSuscripcion): "limpiar" | "conservar" {
  return estado === "active" || estado === "trialing" || estado === "canceled" || estado === "unpaid" ? "limpiar" : "conservar";
}

function aFecha(segundos: number | null | undefined): string | null {
  return typeof segundos === "number" ? new Date(segundos * 1000).toISOString() : null;
}

/** Id de la suscripcion de una factura. Stripe la movio de `invoice.subscription` a `parent.subscription_details` (Basil). */
export function suscripcionDeFactura(invoice: Stripe.Invoice): string | null {
  const parent = invoice.parent;
  const nueva = parent?.type === "subscription_details" ? parent.subscription_details?.subscription : null;
  const vieja = (invoice as unknown as { subscription?: string | Stripe.Subscription | null }).subscription;
  const bruta = nueva ?? vieja ?? null;
  if (!bruta) return null;
  return typeof bruta === "string" ? bruta : bruta.id;
}

function metadataDeFactura(invoice: Stripe.Invoice): Metadata {
  const parent = invoice.parent;
  return parent?.type === "subscription_details" ? parent.subscription_details?.metadata : null;
}

/** Deja la tabla igual que Stripe. No toca `en_gracia_hasta` (eso lo deciden los pagos). Devuelve false si no pudo. */
export async function sincronizarSuscripcion(
  supabase: SupabaseClient,
  sub: Stripe.Subscription,
): Promise<boolean> {
  const sujeto = sujetoDeMetadata(sub.metadata);
  if (!sujeto) {
    console.error(`suscripcion-notificaciones: ${sub.id} trae la marca pero no un sujeto coherente; no se registra`);
    return false;
  }
  const item = sub.items.data[0];
  const estado = estadoLocal(sub.status);

  // Un intento de pago que nunca se completo (queda 'incomplete') ocuparia el unico lugar de suscripcion viva del sujeto y
  // haria fallar el alta de la buena. Se da de baja el viejo antes de guardar el nuevo.
  if (estado === "active" || estado === "trialing") {
    let viejas = supabase.from("suscripciones_notificaciones")
      .update({ status: "canceled", cancelled_at: new Date().toISOString() })
      .eq("status", "incomplete").neq("stripe_subscription_id", sub.id);
    viejas = sujeto.tipo === "viajero" ? viejas.eq("tipo", "viajero").eq("user_id", sujeto.userId) : viejas.eq("tipo", "agencia").eq("agency_id", sujeto.agencyId);
    const { error: errViejas } = await viejas;
    if (errViejas) {
      console.error(`suscripcion-notificaciones: no se pudo limpiar el intento anterior de ${sub.id}: ${errViejas.message}`);
      return false;
    }
  }

  const { error } = await supabase.from("suscripciones_notificaciones").upsert({
    tipo: sujeto.tipo,
    user_id: sujeto.userId,
    agency_id: sujeto.agencyId,
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripe_subscription_id: sub.id,
    status: estado,
    current_period_start: aFecha(item?.current_period_start),
    current_period_end: aFecha(item?.current_period_end),
    cancel_at_period_end: sub.cancel_at_period_end || false,
    cancelled_at: aFecha(sub.canceled_at),
    price_paid: typeof item?.price?.unit_amount === "number" ? item.price.unit_amount / 100 : null,
    moneda: (item?.price?.currency ?? "mxn").toUpperCase(),
  }, { onConflict: "stripe_subscription_id" });
  if (error) {
    console.error(`suscripcion-notificaciones: no se pudo guardar ${sub.id}: ${error.message}`);
    return false;
  }
  if (accionDeGracia(estado) === "limpiar") {
    await supabase.from("suscripciones_notificaciones").update({ en_gracia_hasta: null }).eq("stripe_subscription_id", sub.id);
  }
  return true;
}

async function esNuestra(
  supabase: SupabaseClient,
  subscriptionId: string,
  metadata: Metadata,
): Promise<boolean> {
  if (esSuscripcionDeNotificaciones(metadata)) return true;
  const { data } = await supabase.from("suscripciones_notificaciones")
    .select("id").eq("stripe_subscription_id", subscriptionId).maybeSingle();
  return Boolean(data);
}

/**
 * Punto de entrada desde stripe-webhook. Devuelve true si el evento era de una suscripcion de notificaciones y ya se atendio
 * (el webhook responde 200 y NO lo pasa a los handlers de membresias, reservas y pagos). false = no es nuestro.
 * Si algo falla al guardar se LANZA: Stripe reintenta, y un evento propio no debe caer en el handler de Plus.
 */
export async function procesarEventoNotificaciones(
  supabase: SupabaseClient,
  stripe: Stripe,
  event: Stripe.Event,
): Promise<boolean> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      if (!esSuscripcionDeNotificaciones(sub.metadata)) return false;
      if (event.type === "customer.subscription.deleted") {
        // Stripe da de baja la suscripcion al terminar el periodo o al agotar los reintentos: cubre hasta aqui y ya no mas.
        const { error } = await supabase.from("suscripciones_notificaciones").update({
          status: "canceled", cancel_at_period_end: false, cancelled_at: new Date().toISOString(), en_gracia_hasta: null,
        }).eq("stripe_subscription_id", sub.id);
        if (error) throw new Error(`suscripcion-notificaciones: no se pudo dar de baja ${sub.id}: ${error.message}`);
        return true;
      }
      if (!(await sincronizarSuscripcion(supabase, sub))) throw new Error(`suscripcion-notificaciones: no se pudo sincronizar ${sub.id}`);
      return true;
    }

    case "invoice.payment_succeeded":
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = suscripcionDeFactura(invoice);
      if (!subscriptionId) return false;
      if (!(await esNuestra(supabase, subscriptionId, metadataDeFactura(invoice)))) return false;

      // La factura puede llegar antes que customer.subscription.created: se trae la suscripcion y se guarda ya.
      const { data: fila } = await supabase.from("suscripciones_notificaciones")
        .select("id").eq("stripe_subscription_id", subscriptionId).maybeSingle();
      if (!fila) {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        if (!(await sincronizarSuscripcion(supabase, sub))) throw new Error(`suscripcion-notificaciones: no se pudo sincronizar ${subscriptionId}`);
      }

      if (event.type === "invoice.payment_succeeded") {
        // Pagar cierra la gracia; el periodo nuevo lo trae customer.subscription.updated.
        const { error } = await supabase.from("suscripciones_notificaciones")
          .update({ en_gracia_hasta: null }).eq("stripe_subscription_id", subscriptionId);
        if (error) throw new Error(`suscripcion-notificaciones: no se pudo limpiar la gracia de ${subscriptionId}: ${error.message}`);
        return true;
      }

      // El primer cobro que falla NO da gracia: nunca se pago, y la gracia es para quien ya estaba cubierto y se le vencio la tarjeta.
      if (invoice.billing_reason === "subscription_create") return true;

      // Pago fallido: se abre la gracia UNA vez. Los reintentos de Stripe no la estiran (si no, nunca se acabaria).
      const { data: ajustes } = await supabase.from("platform_settings")
        .select("cobro_notificaciones_dias_gracia").maybeSingle();
      const dias = ajustes?.cobro_notificaciones_dias_gracia ?? 3;
      const { error } = await supabase.from("suscripciones_notificaciones")
        .update({ en_gracia_hasta: finDeGracia(new Date(), dias).toISOString() })
        .eq("stripe_subscription_id", subscriptionId)
        .is("en_gracia_hasta", null);
      if (error) throw new Error(`suscripcion-notificaciones: no se pudo abrir la gracia de ${subscriptionId}: ${error.message}`);
      return true;
    }

    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (!esSuscripcionDeNotificaciones(session.metadata)) return false;
      // La suscripcion se registra con sus propios eventos; aqui solo se evita que el handler de reservas la tome por suya.
      return true;
    }

    default:
      return false;
  }
}
