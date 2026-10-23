import assert from 'node:assert/strict';
import {
  accionDeGracia, estadoLocal, esSuscripcionDeNotificaciones, finDeGracia, procesarEventoNotificaciones, sujetoDeMetadata, suscripcionDeFactura,
} from '../../supabase/functions/_shared/suscripcionNotificaciones.ts';

// Un cliente de Supabase de mentira que anota que se le pidio. Cada consulta devuelve `respuesta` (por tabla) y registra el encadenado.
type Llamada = { tabla: string; ops: string[] };
function falso(respuestas: Record<string, { data?: unknown; error?: { message: string } | null }> = {}) {
  const llamadas: Llamada[] = [];
  const cliente = {
    from(tabla: string) {
      const llamada: Llamada = { tabla, ops: [] };
      llamadas.push(llamada);
      const res = { data: null, error: null, ...(respuestas[tabla] ?? {}) };
      const q: Record<string, unknown> = {};
      for (const op of ['select', 'update', 'upsert', 'eq', 'neq', 'is', 'in', 'not', 'order', 'limit']) {
        q[op] = (...args: unknown[]) => { llamada.ops.push(`${op}(${args.map((a) => JSON.stringify(a)).join(',')})`); return q; };
      }
      q.maybeSingle = () => { llamada.ops.push('maybeSingle'); return Promise.resolve(res); };
      q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(res).then(ok, ko);
      return q;
    },
  };
  return { cliente: cliente as never, llamadas };
}
const stripeSinRed = { subscriptions: { retrieve: () => { throw new Error('no debe llamar a Stripe'); } } } as never;

const MARCA = { tipo_suscripcion: 'notificaciones', sujeto: 'viajero', notif_user_id: 'u-1' };

Deno.test('la marca de notificaciones NO se parece a la de Plus: user_id solo, sin la marca, no es nuestra', () => {
  assert.equal(esSuscripcionDeNotificaciones({ user_id: 'u-1', plan_type: 'monthly' }), false);
  assert.equal(esSuscripcionDeNotificaciones(MARCA), true);
  assert.equal(esSuscripcionDeNotificaciones(null), false);
});

Deno.test('el sujeto sale del metadata y no se adivina cuando falta', () => {
  assert.deepEqual(sujetoDeMetadata(MARCA), { tipo: 'viajero', userId: 'u-1', agencyId: null });
  assert.deepEqual(sujetoDeMetadata({ tipo_suscripcion: 'notificaciones', sujeto: 'agencia', notif_agency_id: 'a-1' }), { tipo: 'agencia', userId: null, agencyId: 'a-1' });
  assert.equal(sujetoDeMetadata({ tipo_suscripcion: 'notificaciones', sujeto: 'agencia', notif_user_id: 'u-1' }), null, 'agencia sin agencia');
  assert.equal(sujetoDeMetadata({ tipo_suscripcion: 'notificaciones', sujeto: 'viajero' }), null, 'viajero sin usuario');
  assert.equal(sujetoDeMetadata({ sujeto: 'viajero', notif_user_id: 'u-1' }), null, 'sin la marca');
});

Deno.test('estados de Stripe -> tabla, y la gracia se limpia solo cuando corresponde', () => {
  assert.deepEqual(['incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'paused', 'canceled', 'incomplete_expired', 'otro'].map(estadoLocal),
    ['incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'past_due', 'canceled', 'canceled', 'canceled']);
  assert.deepEqual((['active', 'trialing', 'canceled', 'unpaid', 'past_due', 'incomplete'] as const).map(accionDeGracia),
    ['limpiar', 'limpiar', 'limpiar', 'limpiar', 'conservar', 'conservar']);
});

Deno.test('la gracia dura los dias configurados y nunca es negativa', () => {
  const t = new Date('2026-11-01T00:00:00Z');
  assert.equal(finDeGracia(t, 3).toISOString(), '2026-11-04T00:00:00.000Z');
  assert.equal(finDeGracia(t, 0).toISOString(), t.toISOString());
  assert.equal(finDeGracia(t, -5).toISOString(), t.toISOString());
});

Deno.test('la suscripcion de una factura se lee de las dos ubicaciones de Stripe', () => {
  assert.equal(suscripcionDeFactura({ parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_1' } } } as never), 'sub_1');
  assert.equal(suscripcionDeFactura({ subscription: 'sub_2' } as never), 'sub_2');
  assert.equal(suscripcionDeFactura({} as never), null);
});

Deno.test('un evento de Plus (sin la marca, sin fila nuestra) no se toca: devuelve false y no escribe', async () => {
  const { cliente, llamadas } = falso({ suscripciones_notificaciones: { data: null } });
  const sub = { type: 'customer.subscription.updated', data: { object: { id: 'sub_plus', metadata: { user_id: 'u-1', plan_type: 'monthly' } } } };
  assert.equal(await procesarEventoNotificaciones(cliente, stripeSinRed, sub as never), false);
  assert.equal(llamadas.length, 0, 'ni una consulta');

  const factura = { type: 'invoice.payment_succeeded', data: { object: { parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_plus', metadata: { user_id: 'u-1' } } } } } };
  assert.equal(await procesarEventoNotificaciones(cliente, stripeSinRed, factura as never), false);
  assert.ok(llamadas.every((l) => !l.ops.some((o) => o.startsWith('update') || o.startsWith('upsert'))), 'solo pregunto si era nuestra, no escribio');
});

Deno.test('una factura sin la marca pero con fila nuestra SI se atiende (el metadata de la factura puede faltar)', async () => {
  const { cliente, llamadas } = falso({ suscripciones_notificaciones: { data: { id: 'f-1' } } });
  const factura = { type: 'invoice.payment_succeeded', data: { object: { parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_n' } } } } };
  assert.equal(await procesarEventoNotificaciones(cliente, stripeSinRed, factura as never), true);
  assert.ok(llamadas.some((l) => l.ops.some((o) => o.startsWith('update({"en_gracia_hasta":null}'))), 'pagar limpia la gracia');
});

Deno.test('pago fallido: abre la gracia UNA vez (is null), con los dias de la configuracion', async () => {
  const { cliente, llamadas } = falso({
    suscripciones_notificaciones: { data: { id: 'f-1' } },
    platform_settings: { data: { cobro_notificaciones_dias_gracia: 5 } },
  });
  const factura = { type: 'invoice.payment_failed', data: { object: { billing_reason: 'subscription_cycle', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_n', metadata: MARCA } } } } };
  const antes = Date.now();
  assert.equal(await procesarEventoNotificaciones(cliente, stripeSinRed, factura as never), true);
  const abre = llamadas.find((l) => l.tabla === 'suscripciones_notificaciones' && l.ops.some((o) => o.includes('"en_gracia_hasta":"')));
  assert.ok(abre, 'se escribio una fecha de gracia');
  assert.ok(abre.ops.includes('is("en_gracia_hasta",null)'), 'solo si no habia una abierta: los reintentos no la estiran');
  const fecha = Date.parse(/"en_gracia_hasta":"([^"]+)"/.exec(abre.ops.join(' '))![1]);
  assert.ok(Math.abs(fecha - (antes + 5 * 86_400_000)) < 60_000, '5 dias');
});

Deno.test('el primer cobro que falla (subscription_create) NO da gracia: nunca estuvo cubierta', async () => {
  const { cliente, llamadas } = falso({ suscripciones_notificaciones: { data: { id: 'f-1' } } });
  const factura = { type: 'invoice.payment_failed', data: { object: { billing_reason: 'subscription_create', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_n', metadata: MARCA } } } } };
  assert.equal(await procesarEventoNotificaciones(cliente, stripeSinRed, factura as never), true);
  assert.ok(llamadas.every((l) => !l.ops.some((o) => o.includes('en_gracia_hasta'))), 'no se toco la gracia');
});

Deno.test('subscription.deleted da de baja y limpia la gracia; un error al guardar se lanza para que Stripe reintente', async () => {
  const ok = falso();
  const evento = { type: 'customer.subscription.deleted', data: { object: { id: 'sub_n', metadata: MARCA } } };
  assert.equal(await procesarEventoNotificaciones(ok.cliente, stripeSinRed, evento as never), true);
  const baja = ok.llamadas[0].ops.join(' ');
  assert.match(baja, /"status":"canceled"/);
  assert.match(baja, /"en_gracia_hasta":null/);

  const mal = falso({ suscripciones_notificaciones: { error: { message: 'boom' } } });
  await assert.rejects(() => procesarEventoNotificaciones(mal.cliente, stripeSinRed, evento as never), /boom/);
});

Deno.test('el checkout de una suscripcion nuestra no cae en el handler de reservas', async () => {
  const { cliente } = falso();
  const nuestra = { type: 'checkout.session.completed', data: { object: { mode: 'subscription', metadata: MARCA } } };
  assert.equal(await procesarEventoNotificaciones(cliente, stripeSinRed, nuestra as never), true);
  const reserva = { type: 'checkout.session.completed', data: { object: { mode: 'payment', metadata: { booking_id: 'b-1' } } } };
  assert.equal(await procesarEventoNotificaciones(cliente, stripeSinRed, reserva as never), false);
});
