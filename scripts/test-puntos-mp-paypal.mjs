#!/usr/bin/env node
// Puntos + MercadoPago / PayPal en suplementos, extras y mensualidades, y la
// unificacion: estos cobros los crean y confirman las tres funciones de cobro
// (16-oct-2026). Antes el front los pedia a create-mercadopago-preference /
// create-paypal-order, con su propio calculo del monto y sin codigo MFA.
//
// La base (puntos_de_cargo) la prueba test-puntos-de-cargo.sql. Aqui, del
// codigo sin comentarios:
//   1. Cada funcion crea la preferencia / el pedido: aparta antes, cobra el
//      resto, caduca con puntos y libera si falla.
//   2. Al confirmar: lee los puntos apartados, verifica el monto contra el total
//      MENOS esos puntos y solo entonces consume.
//   3. Los errores previos corregidos no regresan.
//   4. El front ya no pide estos cobros directo.
//
//   node scripts/test-puntos-mp-paypal.mjs   (Node 24; en 22 agrega --experimental-strip-types)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const m = await import('../supabase/functions/_shared/puntosConTope.ts');

let casos = 0;
const prueba = (nombre, fn) => {
  try { fn(); casos++; } catch (e) { console.error(`FALLA: ${nombre}`); throw e; }
};
const sinComentarios = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .filter((l) => !/^\s*\/\//.test(l))
  .map((l) => l.replace(/\s\/\/.*$/, ''))
  .join('\n');
const fn = (n) => sinComentarios(readFileSync(`supabase/functions/${n}/index.ts`, 'utf8'));
const fuente = (f) => sinComentarios(readFileSync(f, 'utf8'));
const rama = (c, metodo) => {
  const i = c.indexOf(`if (payment_method === "${metodo}") {`);
  assert.ok(i > 0, `no hay rama ${metodo}`);
  return c.slice(i, c.indexOf('\n    }\n', i));
};
const orden = (texto, marcas, msj) => {
  let previo = -1;
  for (const marca of marcas) {
    const i = texto.indexOf(marca, previo + 1);
    assert.ok(i > previo, `${msj}: "${marca}" no aparece despues de lo anterior`);
    previo = i;
  }
};

prueba('MercadoPago y PayPal aceptan puntos; la caducidad de MP va en su formato', () => {
  for (const metodo of ['mercadopago', 'paypal']) assert.equal(m.validarPuntos(metodo, 25000, 500).ok, true, metodo);
  assert.match(m.expiracionMercadoPago(), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+00:00$/);
  assert.ok(m.MINUTOS_APARTADO_PAYPAL > 180, 'un pedido de PayPal sin aprobar dura 3 h');
});

const FUNCIONES = [
  ['process-supplement-payment', '"supplement"'],
  ['purchase-post-booking-extras', 'type === "insurance" ? "insurance" : "optional_service"'],
  ['process-payment-plan-installment', '"payment_plan_installment"'],
];

for (const [nombre, ctx] of FUNCIONES) {
  const c = fn(nombre);
  const mp = rama(c, 'mercadopago');
  const pp = rama(c, 'paypal');

  prueba(`${nombre} / MercadoPago: crea la preferencia apartando antes y cobrando el resto`, () => {
    orden(mp, ['if (!mercadopago_payment_id) {', 'await apartarPuntosDeCargo(', 'https://api.mercadopago.com/checkout/preferences'], 'crear');
    assert.ok(mp.includes(`apartarPuntosDeCargo(supabase, user.id, ${ctx}`), 'contexto');
    assert.match(mp, /unit_price: montoPasarela,/);
    assert.match(mp, /\.\.\.\(apartadoId \? \{ expires: true, expiration_date_to: expiracionMercadoPago\(\) \} : \{\}\)/);
    assert.match(mp, /if \(!prefResponse\.ok\) \{\s*if \(apartadoId\) await supabase\.rpc\("liberar_puntos_de_cargo"/);
  });
  prueba(`${nombre} / MercadoPago: verifica contra total menos puntos y solo despues consume`, () => {
    orden(mp, ['await puntosDeCargo(', 'const esperadoMp = parseFloat((totalToPay - puntosApartadosMp / 100)', 'if (Math.abs(mpAmount - esperadoMp) > 0.50)', 'await consumirPuntosDeCargo(', 'await finalizePayment("mercadopago"'], 'confirmar');
  });

  prueba(`${nombre} / PayPal: crea el pedido aqui, apartando antes y cobrando el resto`, () => {
    orden(pp, ['if (!paypal_order_id) {', 'await apartarPuntosDeCargo(', 'await crearOrdenPaypal(credPaypal, {', 'monto: montoPasarela,'], 'crear');
    assert.ok(pp.includes(`MINUTOS_APARTADO_PAYPAL`));
    assert.match(pp, /catch \(ppErr\) \{\s*if \(apartadoId\) await supabase\.rpc\("liberar_puntos_de_cargo"/);
  });
  prueba(`${nombre} / PayPal: captura, verifica contra total menos puntos y despues consume`, () => {
    orden(pp, ['await capturarOrdenPaypal(credPaypal, paypal_order_id)', 'await puntosDeCargo(', 'if (Math.abs(captura.monto - esperadoPp) > 0.5)', 'await consumirPuntosDeCargo(', 'await finalizePayment("paypal", captura.capturaId)'], 'confirmar');
  });

  prueba(`${nombre}: el cobro registrado es lo de la pasarela, sin los puntos`, () => {
    const i = c.indexOf('const finalizePayment = async');
    const f = c.slice(i, c.indexOf('\n    };\n', i));
    assert.doesNotMatch(f, /\bamount: totalToPay,/);
    assert.ok((f.match(/amount: parseFloat\(\(totalToPay - pesosEnPuntos\)\.toFixed\(2\)\),/g) || []).length >= 3);
  });
  prueba(`${nombre}: los puntos de la confirmacion salen de lo apartado (let)`, () => {
    assert.match(c, /let puntosUsados = puntosAplicados\.puntos;|let puntosUsados = 0;/);
    assert.match(c, /puntosUsados = await consumirPuntosDeCargo\(/);
  });
}

prueba('process-supplement-payment: los secretos se leen de platform_secrets', () => {
  const c = fn('process-supplement-payment');
  assert.doesNotMatch(c, /\.from\("platform_settings"\)\s*\.select\("[^"]*(mercadopago_access_token|paypal_client_secret)/, 'la consulta entera fallaba');
  assert.match(c, /\.from\("platform_secrets"\)\s*\.select\("mercadopago_access_token, paypal_client_secret"\)/);
});

prueba('purchase-post-booking-extras: al confirmar reusa la fila del servicio y el regreso sabe cual es', () => {
  const c = fn('purchase-post-booking-extras');
  assert.match(c, /if \(type === "optional_service" && booking_optional_service_id && \(mercadopago_payment_id \|\| paypal_order_id\)\) \{/);
  assert.match(c, /bookingOptionalServiceId = bosPrevio\.id;/);
  assert.match(c, /extra_type=\$\{type\}&bos_id=\$\{bookingOptionalServiceId \|\| ""\}/);
});

prueba('process-payment-plan-installment: el regreso de MercadoPago trae el monto del abono', () => {
  assert.match(fn('process-payment-plan-installment'), /&amount=\$\{effectiveAmount\}&pay_full_balance=\$\{pay_full_balance\}/);
});

prueba('mercadopago-webhook: el suplemento se marca pagado con columnas que existen y CFDI con la llave correcta', () => {
  const c = fn('mercadopago-webhook');
  const i = c.indexOf('if (bookingSupplement) {');
  const bloque = c.slice(i, c.indexOf('return new Response', i));
  assert.doesNotMatch(bloque, /payment_provider:|[^_]payment_id: String/, 'payment_provider y payment_id no existen en booking_supplements');
  assert.match(bloque, /payment_method: "mercadopago",/);
  assert.match(bloque, /booking_supplement_id: externalReference, payment_form/);
  assert.match(c, /\.in\("status", \["pending_payment", "approved"\]\)/);
});

prueba('mercadopago-webhook: consume los puntos en los tres cargos', () => {
  const c = fn('mercadopago-webhook');
  for (const ctx of ['insurance', 'optional_service', 'supplement']) {
    assert.match(c, new RegExp(`rpc\\("consumir_puntos_de_cargo", \\{ p_contexto: "${ctx}", p_referencia: externalReference \\}\\)`), ctx);
  }
});

prueba('front: suplementos, extras y mensualidades ya no piden MercadoPago/PayPal directo', () => {
  const tb = fuente('src/pages/traveler/TravelerBookings.tsx');
  for (const h of ['handleProcessDirectSupplementPayment', 'handleProcessExtrasPayment', 'handleRequestSupplement']) {
    const i = tb.indexOf(`const ${h} = async`);
    const j = tb.indexOf('\n  };\n', i);
    const cuerpo = tb.slice(i, j);
    assert.doesNotMatch(cuerpo, /create-mercadopago-preference|create-paypal-order/, h);
  }
  assert.doesNotMatch(fuente('src/components/PaymentPlanCalendar.tsx'), /create-paypal-order/);
});

prueba('PaymentReturnPage: los extras reusan su fila y el abono de MercadoPago manda su monto', () => {
  const r = fuente('src/pages/PaymentReturnPage.tsx');
  assert.equal((r.match(/\.\.\.\(extraBosId \? \{ booking_optional_service_id: extraBosId \} : \{\}\)/g) || []).length, 2);
  assert.match(r, /amount: parseFloat\(searchParams\.get\('amount'\) \|\| '0'\) \|\| 1,/);
});

console.log(`Puntos + MercadoPago/PayPal: ${casos} casos OK`);
