/**
 * Prueba de supabase/functions/_shared/repartoCobroMixto.ts.
 *
 * El 02-oct-2026 un carrito mixto cobro $589 (deposito $500 + membresia
 * mensual $89) en un solo payment intent, y stripe-webhook lo registraba DOS
 * veces completo: $589 de reserva (checkout.session.completed) y $589 de
 * membresia (invoice.paid). La comision de la membresia quedo en 0 porque el
 * evento no trae invoice.payments.
 *
 * Los numeros de abajo son los de ese cobro, leidos de la API de Stripe:
 *   factura in_1ULyzVEs5wtTyCYmHAKcoUrd: lineas 50000 (suelta) + 8900 (suscripcion)
 *   balance_transaction: fee 3149 = 2715 stripe_fee + 434 tax, net 55751
 *
 *   node scripts/test-reparto-cobro-mixto.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..');

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

const { centavosDeSuscripcion, repartirComision, lineasCompletasDeFactura } = await import(
  pathToFileURL(path.join(RAIZ, 'supabase', 'functions', '_shared', 'repartoCobroMixto.ts')).href
);

let casos = 0;
const caso = async (nombre, fn) => { await fn(); casos += 1; console.log(`  ok  ${nombre}`); };

// Las dos lineas de la factura real, con la forma que devuelve la API.
const LINEAS_02_OCT = [
  { amount: 50000, parent: { type: 'invoice_item_details' } },
  { amount: 8900, parent: { type: 'subscription_item_details' } },
];
const COMISION_02_OCT = { fee: 31.49, net: 557.51, base: 27.15, iva: 4.34 };

await caso('de la factura del 02-oct, la membresia son 8900 centavos (no los 58900)', () => {
  assert.equal(centavosDeSuscripcion(LINEAS_02_OCT), 8900);
});

await caso('una renovacion (solo suscripcion) es toda membresia', () => {
  assert.equal(centavosDeSuscripcion([{ amount: 8900, parent: { type: 'subscription_item_details' } }]), 8900);
});

await caso('sin lineas o con basura no truena', () => {
  assert.equal(centavosDeSuscripcion(undefined), 0);
  assert.equal(centavosDeSuscripcion([{ amount: null, parent: null }]), 0);
});

await caso('el cobro del 02-oct: la comision se reparte 89/589 y suma exacto', () => {
  const { membresia, reserva } = repartirComision(COMISION_02_OCT, 8900, 58900);
  assert.deepEqual(membresia, { fee: 4.76, net: 84.24, base: 4.1, iva: 0.66 });
  assert.deepEqual(reserva, { fee: 26.73, net: 473.27, base: 23.05, iva: 3.68 });
});

await caso('las dos partes suman al centavo lo que dice Stripe (fee, base, iva, net)', () => {
  const { membresia: m, reserva: r } = repartirComision(COMISION_02_OCT, 8900, 58900);
  const c = (x) => Math.round(x * 100);
  assert.equal(c(m.fee) + c(r.fee), 3149);
  assert.equal(c(m.base) + c(r.base), 2715);
  assert.equal(c(m.iva) + c(r.iva), 434);
  assert.equal(c(m.net) + c(r.net), 55751);
  assert.equal(c(m.base) + c(m.iva), c(m.fee), 'base + iva = fee en la membresia');
  assert.equal(c(r.base) + c(r.iva), c(r.fee), 'base + iva = fee en la reserva');
});

await caso('sin desglose de IVA (Stripe no mando fee_details), base e iva quedan nulos en las dos', () => {
  const { membresia, reserva } = repartirComision({ fee: 31.49, net: 557.51, base: null, iva: null }, 8900, 58900);
  assert.equal(membresia.base, null); assert.equal(membresia.iva, null);
  assert.equal(reserva.base, null); assert.equal(reserva.iva, null);
  assert.equal(Math.round(membresia.fee * 100) + Math.round(reserva.fee * 100), 3149);
});

await caso('sin membresia, toda la comision es de la reserva', () => {
  const { membresia, reserva } = repartirComision(COMISION_02_OCT, 0, 58900);
  assert.equal(membresia.fee, 0);
  assert.equal(reserva.fee, 31.49);
});

// --- Pendiente 11 (entrada 33), problema A: facturas de mas de 10 lineas -------
//
// El objeto `invoice` que llega en el webhook trae como mucho 10 lineas en
// `lines.data`. Si la factura tiene mas (varios opcionales), la linea de
// membresia puede quedar en la segunda pagina y `centavosDeSuscripcion` la
// pierde. `lineasCompletasDeFactura` tiene que volver a pedir TODO con el
// paginador de Stripe en ese caso, y no tocar nada si cabe en una pagina.

await caso('con has_more=false, usa la primera pagina tal cual (sin llamar a Stripe)', async () => {
  let llamadas = 0;
  const stripeFalso = { invoices: { listLineItems() { llamadas++; } } };
  const lineas = [{ amount: 50000, parent: { type: 'invoice_item_details' } }];
  const r = await lineasCompletasDeFactura(stripeFalso, 'in_1', { data: lineas, has_more: false });
  assert.deepEqual(r, lineas);
  assert.equal(llamadas, 0, 'sin has_more no debe pedirle nada a Stripe');
});

await caso('con has_more=true, pagina completa con Stripe y la membresia aparece', async () => {
  const TODAS_LAS_LINEAS = [
    ...Array.from({ length: 10 }, (_, i) => ({ amount: 1000 + i, parent: { type: 'invoice_item_details' } })),
    { amount: 8900, parent: { type: 'subscription_item_details' } }, // linea 11a, la que se perdia
  ];
  const stripeFalso = {
    invoices: {
      listLineItems(id, params) {
        assert.equal(id, 'in_mixta_11lineas');
        assert.equal(params.limit, 100);
        return { async autoPagingToArray() { return TODAS_LAS_LINEAS; } };
      },
    },
  };
  // La "primera pagina" que trae el evento (incompleta, SIN la membresia) no
  // debe importar: se descarta y se repite la consulta entera.
  const primeraPaginaDelEvento = TODAS_LAS_LINEAS.slice(0, 10);
  const r = await lineasCompletasDeFactura(stripeFalso, 'in_mixta_11lineas', { data: primeraPaginaDelEvento, has_more: true });
  assert.equal(centavosDeSuscripcion(r), 8900, 'con la factura completa, la membresia SI aparece');
  assert.equal(r.length, 11);
});

await caso('sin `lines` en absoluto no truena (factura sin invoice.lines expandido)', async () => {
  const r = await lineasCompletasDeFactura({ invoices: { listLineItems() { throw new Error('no deberia llamarse'); } } }, 'in_1', undefined);
  assert.deepEqual(r, []);
});

// --- El webhook usa el reparto en los dos eventos -------------------------------

const webhook = fs.readFileSync(path.join(RAIZ, 'supabase', 'functions', 'stripe-webhook', 'index.ts'), 'utf8');

await caso('checkout.session.completed registra la reserva SIN la membresia', () => {
  const montos = webhook.match(/\(\(session\.amount_total \?\? 0\) - centavosMembresia\) \/ 100/g) ?? [];
  assert.ok(montos.length >= 4, `amount y net_amount de las dos inserciones de reserva deben restar la membresia (hay ${montos.length})`);
  assert.match(webhook, /repartirComision\(comisionDelCobro, centavosMembresia, session\.amount_total \?\? 0\)\.reserva/);
});

await caso('invoice.paid registra solo la membresia y le toca su parte de comision', () => {
  assert.match(webhook, /const membershipAmount = facturaMixta\s*\?\s*centavosMembresia \/ 100/);
  assert.match(webhook, /repartirComision\(comisionDelCobro, centavosMembresia, invoice\.amount_paid \?\? 0\)\.membresia/);
});

await caso('invoice.paid consulta la factura con sus pagos cuando el evento no los trae', () => {
  assert.match(webhook, /stripe\.invoices\.retrieve\(invoice\.id, \{ expand: \['payments'\] \}\)/);
});

await caso('los DOS eventos paginan con lineasCompletasDeFactura antes de sumar la membresia', () => {
  const llamadas = webhook.match(/lineasCompletasDeFactura\(stripe,/g) ?? [];
  assert.equal(llamadas.length, 2, `deberian ser 2 (checkout.session.completed e invoice.paid), hay ${llamadas.length}`);
});

await caso('invoice.paid tambien deja rastro si la factura viene paginada (antes solo lo hacia checkout.session.completed)', () => {
  const iInvoicePaid = webhook.indexOf("case 'invoice.payment_succeeded':");
  const iInvoicePaymentFailed = webhook.indexOf("case 'invoice.payment_failed':");
  assert.ok(iInvoicePaid > 0 && iInvoicePaymentFailed > iInvoicePaid);
  const rama = webhook.slice(iInvoicePaid, iInvoicePaymentFailed);
  assert.match(rama, /if \(invoice\.lines\?\.has_more\) \{/);
  assert.match(rama, /registrarFallo\(\s*\n\s*'stripe-webhook\/factura-mixta-paginada'/);
});

// --- CFDI: un cobro, un CFDI ------------------------------------------------------
//
// La segunda prueba del 02-oct-2026 timbro F-91 (membresia, $89) y F-92
// (reserva, $589 con la membresia como concepto): la membresia facturada dos
// veces. Y cfdi_invoices guardo F-91 con total $589, el monto cobrado, aunque se
// timbro por $89.

await caso('en un alta de carrito mixto NO se genera el CFDI de membresia', () => {
  const i = webhook.indexOf('if (isSubscriptionCreate && facturaMixta) {');
  assert.ok(i > 0, 'falta la rama del alta mixta antes del CFDI de alta nueva');
  const rama = webhook.slice(i, webhook.indexOf('} else if (isSubscriptionCreate) {', i));
  assert.ok(rama.length > 0, 'la rama mixta debe ir antes de la de alta nueva');
  assert.doesNotMatch(rama, /generate-membership-cfdi/, 'la rama mixta no debe pedir el CFDI de membresia');
});

await caso('el CFDI de la reserva SI incluye la membresia (de eso depende omitir el otro)', () => {
  const cfdiReserva = fs.readFileSync(path.join(RAIZ, 'supabase', 'functions', 'generate-booking-cfdi', 'index.ts'), 'utf8');
  assert.match(cfdiReserva, /if \(precioMembresiaBruto > 0\) \{[\s\S]{0,400}conceptos\.push\(/,
    'si el CFDI de la reserva deja de traer la membresia, el alta mixta se quedaria sin facturar');
});

await caso('cfdi_invoices guarda de la membresia lo que se TIMBRA, no lo cobrado', () => {
  const cfdiMembresia = fs.readFileSync(path.join(RAIZ, 'supabase', 'functions', 'generate-membership-cfdi', 'index.ts'), 'utf8');
  assert.match(cfdiMembresia, /const exactTotal = hasDiscount \? amountPaidMxn! : membershipPrice;/);
  assert.doesNotMatch(cfdiMembresia, /const exactTotal = amountPaidMxn \?\? membershipPrice/);
});

// --- Pendiente 11 (entrada 33), problema B: puntos+Cash superan las lineas ------
//
// create-checkout-session/buildDesgloseLineItems reparte el descuento entre
// deposito -> opcionales -> seguro -> cargo por servicio, pero NO conoce la
// membresia (va aparte, a precio fijo de Stripe). El tope del front SI cuenta
// la membresia (netBeforeCharges en BookingFlowStep4), asi que puntos+Cash
// pueden superar lo que esta funcion puede absorber: lo que sobra ("sobrante")
// tiene que salir de la funcion para que el llamador lo cubra con un cupon de
// un solo uso sobre la suscripcion. Se ejecuta la funcion REAL del archivo
// (extraida y compilada con `typescript`), no una reimplementacion.

function extraerFuncion(src, nombre) {
  const inicio = src.indexOf(`function ${nombre}(`);
  assert.ok(inicio > 0, `no se encontro function ${nombre} en el archivo`);
  // El tipo de retorno puede ser un objeto (`): { a: X; b: Y } {`), que tiene
  // su propia llave balanceada ANTES de la del cuerpo real. Se repite el
  // emparejado mientras lo que se acaba de cerrar sea seguido de otra `{`.
  let pos = inicio, fin;
  for (;;) {
    let i = src.indexOf('{', pos);
    let profundidad = 0;
    for (; i < src.length; i++) {
      if (src[i] === '{') profundidad++;
      else if (src[i] === '}') { profundidad--; if (profundidad === 0) { i++; break; } }
    }
    fin = i;
    if (!/^\s*\{/.test(src.slice(fin))) break;
    pos = fin;
  }
  return src.slice(inicio, fin);
}

const ccsSrc = fs.readFileSync(path.join(RAIZ, 'supabase', 'functions', 'create-checkout-session', 'index.ts'), 'utf8');
const buildDesgloseLineItemsSrc = extraerFuncion(ccsSrc, 'buildDesgloseLineItems');
const buildDesgloseLineItemsJs = ts.transpileModule(buildDesgloseLineItemsSrc, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const buildDesgloseLineItems = new Function(`${buildDesgloseLineItemsJs}\nreturn buildDesgloseLineItems;`)();

const bookingBase = { deposit_amount: 500, service_charge: 25, travel_insurance_included: false, travel_insurance_cost: 0 };

await caso('descuento que cabe en depósito+cargo: sobrante 0, se cobra el resto', () => {
  // 400 pesos de descuento sobre 500+25: el deposito absorbe 400, el cargo
  // absorbe los 25 que quedan exactos. Nada se va a la membresia.
  const { lineItems, sobrante } = buildDesgloseLineItems(bookingBase, [], /* puntos */ 40000, /* cash */ 0, 'mxn', 'Tour');
  assert.equal(sobrante, 0);
  const totalLineas = lineItems.reduce((s, li) => s + li.price_data.unit_amount, 0) / 100;
  assert.equal(totalLineas, 500 + 25 - 400, 'deposito+cargo menos los 400 ya aplicados');
});

await caso('puntos+Cash superan depósito+cargo: el sobrante es justo lo que excede (caso del pendiente 11)', () => {
  // 50000 puntos ($500) + $100 cash = $600 de descuento contra 500+0+0+25=525
  // absorbibles. El sobrante tiene que ser exactamente 75, ni mas ni menos
  // (antes de la correccion de remainingDiscount, salia 100: el cargo por
  // servicio se zafaba sin que su consumo se reflejara).
  const { lineItems, sobrante } = buildDesgloseLineItems(bookingBase, [], 50000, 100, 'mxn', 'Tour');
  assert.equal(sobrante, 75);
  // Todo se fue a 0: la funcion mete el fallback de una sola linea en $0.
  assert.equal(lineItems.length, 1);
  assert.equal(lineItems[0].price_data.unit_amount, 0);
});

await caso('descuento exacto al total absorbible: sobrante 0, no sobra ni falta', () => {
  const { sobrante } = buildDesgloseLineItems(bookingBase, [], 0, 525, 'mxn', 'Tour');
  assert.equal(sobrante, 0);
});

await caso('el sobrante tambien cuenta lo que ya absorbieron los opcionales', () => {
  const opcionales = [{ id: 'o1', service_kind: 'pickup', description: 'Pick Up', subtotal: 200, service_charge: 0 }];
  // Absorbible: 500 (deposito) + 200 (opcional) + 0 (seguro) + 25 (cargo) = 725.
  // Descuento de 800: sobrante = 75.
  const { sobrante } = buildDesgloseLineItems(bookingBase, opcionales, 0, 800, 'mxn', 'Tour');
  assert.equal(sobrante, 75);
});

await caso('create-checkout-session cubre el sobrante con un cupon de UN SOLO USO, no con la suscripcion', () => {
  assert.match(ccsSrc, /const \{ lineItems: desgloseItemsSub, sobrante: sobranteSuscripcion \} = buildDesgloseLineItems\(/);
  assert.match(ccsSrc, /if \(sobranteSuscripcion > 0\) \{/);
  assert.match(ccsSrc, /duration: 'once'/);
  assert.match(ccsSrc, /sessionConfig\.discounts = \[\{ coupon: cupon\.id \}\];/);
  // La membresia NUNCA se descuenta directamente -- sigue siendo la linea de
  // precio fijo de Stripe, intacta.
  assert.doesNotMatch(ccsSrc, /priceId.*sobrante/);
});

await caso('la validacion de monto absorbe el sobrante en las dos convenciones de `amount`', () => {
  // Antes de este fix, si sobrante > TOLERANCIA (1 peso) ninguna de las dos
  // ramas cuadraba y validarMontoDelCliente siempre tiraba 400.
  assert.match(
    ccsSrc,
    /Math\.abs\(Number\(amount\) - membershipCost \+ sobranteSuscripcion - sumarLineas\(desgloseItemsSub\)\) <= TOLERANCIA_MONTO_MXN/,
  );
  assert.match(ccsSrc, /\? Number\(amount\) - membershipCost \+ sobranteSuscripcion/);
  assert.match(ccsSrc, /: Number\(amount\) \+ sobranteSuscripcion;/);
});

console.log(`\n${casos} casos OK: un cobro mixto se registra una vez, repartido, y se factura una vez.`);
