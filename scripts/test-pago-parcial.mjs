/**
 * Pago con «más de un método» (19-oct-2026): cada procesador cobra EXACTAMENTE lo que el viajero eligió pagar ahora.
 *
 * EL DEFECTO: en el paso 4, «Pagar $350» sobre un total de $550 mandaba $550 a Openpay. El front prefiere
 * `bookingResult.amount_to_charge` (el exigible COMPLETO, desde el 24-ago-2026) y el parcial se ignoraba en las cinco
 * pasarelas; además Stripe no aceptaba un monto menor al total (cobra siempre las líneas del servidor) y MercadoPago /
 * PayPal medían el saldo contra sus propios cobros, no contra los de todos los procesadores.
 *
 * LO QUE VIGILA
 *  1. montoDelCobroAhora (ejecutada): parcial exacto, tope en el exigible del servidor, sin parcial = total.
 *  2. decidirCobroStripe (ejecutada): total, abono, segundo cobro del saldo, y rechazos (excede, mínimo, ya pagada).
 *  3. BookingFlowStep4: las CINCO llamadas a pasarela mandan `srvAmountNow`, no el total del servidor.
 *  4. Edge Functions: el saldo sale de lo pagado por TODOS los procesadores; Stripe decide con decidirCobroStripe;
 *     los webhooks de MercadoPago y Openpay confirman contra el exigible neto; el abono de Stripe guarda su comisión.
 *
 * LIMITES HONESTOS: las Edge Functions y la pantalla se vigilan por análisis estático; las dos funciones puras se
 * ejecutan. Cobrar de verdad contra cada pasarela (sandbox) no se puede desde aquí.
 *
 *   node scripts/test-pago-parcial.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const leer = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');
const sinComentarios = (ruta) => leer(ruta).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const cargar = (ruta) => {
  const js = ts.transpileModule(leer(ruta), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(js, { module: m, exports: m.exports, Number, Math, Error });
  return m.exports;
};
let n = 0;
const prueba = (nombre, fn) => { fn(); console.log(`ok ${++n} - ${nombre}`); };

// ---- 1. montoDelCobroAhora --------------------------------------------------------------------------------
const { montoDelCobroAhora } = cargar('src/lib/pagoParcial.ts');
prueba('parcial de 350 sobre 550 cobra 350 (no 550)', () => assert.equal(montoDelCobroAhora(550, 350), 350));
prueba('sin parcial cobra el total del servidor', () => {
  assert.equal(montoDelCobroAhora(550, null), 550);
  assert.equal(montoDelCobroAhora(550, undefined), 550);
  assert.equal(montoDelCobroAhora(550, 0), 550);
});
prueba('un parcial mayor al exigible se topa en el exigible del servidor', () => assert.equal(montoDelCobroAhora(550, 900), 550));
prueba('redondea a centavos', () => assert.equal(montoDelCobroAhora(550, 350.004), 350));

// ---- 2. decidirCobroStripe --------------------------------------------------------------------------------
const { decidirCobroStripe } = cargar('supabase/functions/_shared/pagoParcial.ts');
const base = { totalLineas: 550, saldo: 550, pagadoPrevio: 0, tolerancia: 1, minimo: 10 };
prueba('Stripe: monto igual al total y sin pagos previos = cobro completo con su desglose', () =>
  assert.deepEqual({ ...decidirCobroStripe({ ...base, montoCliente: 550 }) }, { modo: 'completo' }));
prueba('Stripe: 350 sobre 550 = abono de 350 (antes se rechazaba como «no coincide»)', () =>
  assert.deepEqual({ ...decidirCobroStripe({ ...base, montoCliente: 350 }) }, { modo: 'parcial', monto: 350 }));
prueba('Stripe: el segundo cobro cobra el saldo (200), no el total', () => {
  const r = decidirCobroStripe({ ...base, saldo: 200, pagadoPrevio: 350, montoCliente: 200 });
  assert.deepEqual({ ...r }, { modo: 'parcial', monto: 200 });
});
prueba('Stripe: con pagos previos, pedir el total completo se rechaza (excede el saldo)', () =>
  assert.equal(decidirCobroStripe({ ...base, saldo: 200, pagadoPrevio: 350, montoCliente: 550 }).modo, 'rechazo'));
prueba('Stripe: un monto mayor al total se rechaza, no se recorta en silencio', () =>
  assert.equal(decidirCobroStripe({ ...base, montoCliente: 700 }).modo, 'rechazo'));
prueba('Stripe: por debajo del mínimo y reserva ya pagada se rechazan', () => {
  assert.equal(decidirCobroStripe({ ...base, montoCliente: 5 }).modo, 'rechazo');
  assert.equal(decidirCobroStripe({ ...base, saldo: 0, pagadoPrevio: 550, montoCliente: 50 }).modo, 'rechazo');
});

// ---- 3. BookingFlowStep4 ----------------------------------------------------------------------------------
const paso4 = sinComentarios('src/pages/booking-flow/BookingFlowStep4.tsx');
prueba('Paso 4: las cinco pasarelas reciben srvAmountNow', () => {
  assert.equal((paso4.match(/amount:\s*srvAmountNow/g) ?? []).length, 5, 'stripe, mercadopago, paypal, conekta, openpay');
  const inicio = paso4.indexOf("flow.paymentProvider === 'stripe'");
  assert.ok(inicio > 0);
  assert.doesNotMatch(paso4.slice(inicio), /amount:\s*srvAmountToCharge/, 'ninguna llamada a pasarela manda el total del servidor');
});
prueba('Paso 4: srvAmountNow sale de montoDelCobroAhora con el parcial elegido', () => {
  assert.match(paso4, /srvAmountNow\s*=\s*flow\.payNowMode === 'partial'[^;]*montoDelCobroAhora\(srvAmountToCharge,\s*flow\.partialPaymentAmount\)/);
});
prueba('Mis reservas: «Completar pago» manda SIEMPRE el monto (con abonos previos, el saldo); MercadoPago lo exige', () => {
  const mb = sinComentarios('src/pages/traveler/TravelerBookings.tsx');
  // 19-oct-2026: omitir el monto con `processing` hacia que create-mercadopago-preference respondiera «Datos incompletos»
  assert.match(mb, /montoAEnviar\s*=\s*amountToCharge;/);
  assert.doesNotMatch(mb, /montoAEnviar[^;]*undefined/);
  assert.equal((mb.match(/amount:\s*montoAEnviar/g) ?? []).length, 5);
});

// ---- 4. Edge Functions ------------------------------------------------------------------------------------
const f = (nombre) => sinComentarios(`supabase/functions/${nombre}/index.ts`);
prueba('PayPal y MercadoPago miden el saldo contra TODOS los procesadores al crear el cobro', () => {
  for (const nombre of ['create-paypal-order', 'create-mercadopago-preference']) {
    const src = f(nombre);
    assert.match(src, /pagadoEnProcesadores\(supabase,\s*bookingId\)/, nombre);
    assert.doesNotMatch(src, /\.eq\("payment_processor",\s*"(paypal|mercadopago)"\)/, `${nombre} sigue filtrando por su propio procesador`);
  }
});
prueba('capture-paypal-order y mercadopago-webhook suman los cobros de todos los procesadores', () => {
  assert.match(f('capture-paypal-order'), /pagadoEnProcesadores\(supabase,\s*bookingId\)/);
  assert.doesNotMatch(f('capture-paypal-order'), /\.eq\("payment_processor",\s*"paypal"\)\s*\n?\s*\.eq\("charge_context"/);
  const mp = f('mercadopago-webhook');
  assert.match(mp, /pagadoEnProcesadores\(supabase,\s*externalReference\)/);
  assert.doesNotMatch(mp, /\.eq\("payment_processor",\s*"mercadopago"\);/, 'el total de confirmacion no puede ser solo de MP');
});
prueba('MercadoPago y Openpay confirman contra el exigible neto, no contra max(anticipo, exigible)', () => {
  assert.match(f('mercadopago-webhook'), /depositAmount\s*=\s*exigibleAlProcesador\(booking\)/);
  assert.match(f('openpay-webhook'), /requiredAmount\s*=\s*exigibleAlProcesador\(booking\)/);
  assert.doesNotMatch(f('openpay-webhook'), /Math\.max\(Number\(booking\.deposit_amount/);
});
prueba('create-checkout-session decide con decidirCobroStripe y cobra el abono tal cual', () => {
  const s = f('create-checkout-session');
  assert.match(s, /decidirCobroStripe\(\{/);
  assert.match(s, /decision\.modo === "parcial"/);
  assert.match(s, /unit_amount:\s*Math\.round\(decision\.monto \* 100\)/);
  assert.match(s, /pagadoEnProcesadores\(supabase,\s*bookingId\)/);
});
prueba('stripe-webhook: el abono por debajo del anticipo guarda su comision real', () => {
  const s = f('stripe-webhook');
  const i = s.indexOf('const comisionDelAbono');
  const j = s.indexOf('stripe-webhook/cobertura-insuficiente');
  assert.ok(i > 0 && j > i, 'el calculo de la comision va antes de dejar la reserva en processing');
  assert.match(s.slice(i, j), /getStripeProcessorFee\(stripe,\s*paymentIntentId\)/);
  assert.match(s.slice(i, j), /columnasDeComision\(feeDelAbono\)/);
});

console.log(`\n${n} pruebas ok`);
