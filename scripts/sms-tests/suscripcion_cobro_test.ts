import assert from 'node:assert/strict';
import { procesarEventoNotificaciones } from '../../supabase/functions/_shared/suscripcionNotificaciones.ts';
import { dependencias, depsInertes, falso, MARCA, stripeSinRed, type Respuesta } from './falsos_suscripcion.ts';

// El cobro de una suscripcion de notificaciones: transaccion, comision real, asiento y CFDI (fase 3 del cobro).

const facturaPagada = (extra: Record<string, unknown> = {}) => ({
  type: 'invoice.payment_succeeded',
  data: { object: {
    id: 'in_1', amount_paid: 8900, billing_reason: 'subscription_cycle', payment_intent: 'pi_1',
    parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_n', metadata: MARCA } },
    ...extra,
  } },
});

type Tabla = Respuesta & { cola?: Respuesta[]; insercion?: Respuesta };
const tablas = (extra: Record<string, Tabla> = {}): Record<string, Tabla> => ({
  suscripciones_notificaciones: { data: { id: 'sub-fila', tipo: 'viajero' } },
  payment_transactions: { cola: [{ data: null }], insercion: { data: { id: 'tx-1' } } },
  ...extra,
});

Deno.test('un cobro confirmado deja UNA transaccion, su comision real, su asiento y su CFDI, en ese orden', async () => {
  const { cliente, llamadas, rpcs, orden } = falso(tablas());
  const { deps, registro } = dependencias();
  assert.equal(await procesarEventoNotificaciones(cliente, stripeSinRed, facturaPagada() as never, deps), true);

  const insercion = llamadas.find((l) => l.tabla === 'payment_transactions' && l.ops.some((o) => o.startsWith('insert')))!;
  const texto = insercion.ops.join(' ');
  assert.match(texto, /"charge_context":"notification_subscription"/);
  assert.match(texto, /"amount":89/, '8900 centavos = $89');
  assert.match(texto, /"charge_reference_id":"sub-fila"/);
  assert.match(texto, /"stripe_invoice_id":"in_1"/, 'la factura queda en el metadata (la llave de idempotencia)');
  assert.match(texto, /"stripe_payment_intent_id":"pi_1"/, 'el pi_ real, para ligar una disputa');
  assert.match(texto, /"currency":"mxn"/);

  assert.deepEqual(registro.comisiones, ['pi_1']);
  assert.deepEqual(rpcs, [{ nombre: 'create_accounting_entry_for_notificaciones', args: { p_payment_transaction_id: 'tx-1' } }]);
  assert.ok(orden.indexOf('update:payment_transactions') < orden.indexOf('rpc:create_accounting_entry_for_notificaciones'), 'la comision se guarda ANTES del asiento');
  assert.deepEqual(registro.funciones, [{ nombre: 'generate-notification-cfdi', cuerpo: { payment_transaction_id: 'tx-1' } }]);
  assert.equal(registro.segundoPlano, 1, 'el CFDI no bloquea la respuesta al webhook');
});

Deno.test('una factura en cero no es un cobro: sin transaccion, sin asiento, sin CFDI', async () => {
  const { cliente, llamadas, rpcs } = falso(tablas());
  const { deps, registro } = dependencias();
  await procesarEventoNotificaciones(cliente, stripeSinRed, facturaPagada({ amount_paid: 0 }) as never, deps);
  assert.ok(llamadas.every((l) => l.tabla !== 'payment_transactions'));
  assert.equal(rpcs.length, 0);
  assert.equal(registro.funciones.length, 0);
});

Deno.test('Stripe reentrega el evento: no se duplica la transaccion, pero asiento y CFDI se reintentan (son idempotentes)', async () => {
  const { cliente, llamadas, rpcs } = falso(tablas({ payment_transactions: { data: { id: 'tx-viva' } } }));
  const { deps, registro } = dependencias();
  await procesarEventoNotificaciones(cliente, stripeSinRed, facturaPagada() as never, deps);
  assert.ok(!llamadas.some((l) => l.ops.some((o) => o.startsWith('insert'))), 'no se inserta otra');
  assert.deepEqual(rpcs, [{ nombre: 'create_accounting_entry_for_notificaciones', args: { p_payment_transaction_id: 'tx-viva' } }]);
  assert.equal(registro.funciones.length, 1);
  assert.equal(registro.comisiones.length, 0, 'no se vuelve a pedir la comision de un cobro ya registrado');
});

Deno.test('dos entregas a la vez: si la insercion choca (23505) se sigue con la transaccion que gano', async () => {
  const { cliente, rpcs } = falso(tablas({
    payment_transactions: { cola: [{ data: null }, { data: { id: 'tx-ganadora' } }], insercion: { error: { message: 'duplicate', code: '23505' } } },
  }));
  await procesarEventoNotificaciones(cliente, stripeSinRed, facturaPagada() as never, depsInertes());
  assert.deepEqual(rpcs[0].args, { p_payment_transaction_id: 'tx-ganadora' });
});

Deno.test('cualquier otro error al registrar el cobro o asentarlo se LANZA (Stripe reintenta)', async () => {
  // La factura llega antes que la suscripcion y ni trayendola de Stripe queda registrada: no se inventa un cobro huerfano.
  const stripeConSuscripcion = { subscriptions: { retrieve: () => Promise.resolve({ id: 'sub_n', metadata: MARCA, status: 'active', customer: 'cus_1', items: { data: [{}] }, cancel_at_period_end: false }) } } as never;
  const sinSuscripcion = falso({ suscripciones_notificaciones: { data: null } });
  await assert.rejects(() => procesarEventoNotificaciones(sinSuscripcion.cliente, stripeConSuscripcion, facturaPagada() as never, depsInertes()), /no se encontro la suscripcion/);

  const fallaInsert = falso(tablas({ payment_transactions: { cola: [{ data: null }], insercion: { error: { message: 'boom', code: '42501' } } } }));
  await assert.rejects(() => procesarEventoNotificaciones(fallaInsert.cliente, stripeSinRed, facturaPagada() as never, depsInertes()), /no se pudo registrar el cobro/);

  const fallaAsiento = falso(tablas(), { error: { message: 'sin cuenta 410' } });
  await assert.rejects(() => procesarEventoNotificaciones(fallaAsiento.cliente, stripeSinRed, facturaPagada() as never, depsInertes()), /no se pudo asentar el cobro/);
});

Deno.test('sin payment_intent o sin comision el cobro se registra igual y queda dicho; un CFDI que falla no tumba el webhook', async () => {
  const sinPi = falso(tablas());
  const a = dependencias();
  const stripeSinPagos = { invoices: { retrieve: () => Promise.resolve({ payments: { data: [] } }) } } as never;
  await procesarEventoNotificaciones(sinPi.cliente, stripeSinPagos, facturaPagada({ payment_intent: undefined }) as never, a.deps);
  assert.equal(a.registro.comisiones.length, 0, 'sin pi no hay a quien pedirle la comision');
  assert.equal(sinPi.rpcs.length, 1, 'el asiento se hace igual');
  assert.deepEqual(a.registro.fallos, ['suscripcion-notificaciones/sin-payment-intent'], 'queda dicho');

  const sinComision = falso(tablas());
  const b = dependencias({ comision: null });
  await procesarEventoNotificaciones(sinComision.cliente, stripeSinRed, facturaPagada() as never, b.deps);
  assert.equal(sinComision.rpcs.length, 1);
  assert.deepEqual(b.registro.fallos, ['suscripcion-notificaciones/sin-comision'], 'sin esto el cero pasa por dato bueno');

  // Un PAC caido: invocarFuncion rechaza, queda registrado y eso no sale hacia Stripe.
  const cfdiCaido = falso(tablas());
  const c = dependencias();
  let promesa: Promise<unknown> = Promise.resolve();
  const deps = { ...(c.deps as object), invocarFuncion: () => Promise.reject(new Error('PAC caido')), enSegundoPlano: (t: Promise<unknown>) => { promesa = t; } };
  assert.equal(await procesarEventoNotificaciones(cfdiCaido.cliente, stripeSinRed, facturaPagada() as never, deps as never), true);
  await promesa; // la promesa de fondo ya trae su .catch: no debe rechazar
  assert.deepEqual(c.registro.fallos, ['suscripcion-notificaciones/cfdi']);
});

Deno.test('el primer cobro (subscription_create) tambien factura, y un cobro fallido NO registra nada', async () => {
  const alta = falso(tablas());
  await procesarEventoNotificaciones(alta.cliente, stripeSinRed, facturaPagada({ billing_reason: 'subscription_create' }) as never, depsInertes());
  assert.equal(alta.rpcs.length, 1);

  const fallido = falso(tablas());
  const evento = {
    type: 'invoice.payment_failed',
    data: { object: { id: 'in_2', amount_paid: 0, billing_reason: 'subscription_cycle', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_n', metadata: MARCA } } } },
  };
  await procesarEventoNotificaciones(fallido.cliente, stripeSinRed, evento as never, depsInertes());
  assert.ok(fallido.llamadas.every((l) => l.tabla !== 'payment_transactions'), 'un pago fallido no deja transaccion ni factura');
  assert.equal(fallido.rpcs.length, 0);
});
