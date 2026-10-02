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

const { centavosDeSuscripcion, repartirComision } = await import(
  pathToFileURL(path.join(RAIZ, 'supabase', 'functions', '_shared', 'repartoCobroMixto.ts')).href
);

let casos = 0;
const caso = (nombre, fn) => { fn(); casos += 1; console.log(`  ok  ${nombre}`); };

// Las dos lineas de la factura real, con la forma que devuelve la API.
const LINEAS_02_OCT = [
  { amount: 50000, parent: { type: 'invoice_item_details' } },
  { amount: 8900, parent: { type: 'subscription_item_details' } },
];
const COMISION_02_OCT = { fee: 31.49, net: 557.51, base: 27.15, iva: 4.34 };

caso('de la factura del 02-oct, la membresia son 8900 centavos (no los 58900)', () => {
  assert.equal(centavosDeSuscripcion(LINEAS_02_OCT), 8900);
});

caso('una renovacion (solo suscripcion) es toda membresia', () => {
  assert.equal(centavosDeSuscripcion([{ amount: 8900, parent: { type: 'subscription_item_details' } }]), 8900);
});

caso('sin lineas o con basura no truena', () => {
  assert.equal(centavosDeSuscripcion(undefined), 0);
  assert.equal(centavosDeSuscripcion([{ amount: null, parent: null }]), 0);
});

caso('el cobro del 02-oct: la comision se reparte 89/589 y suma exacto', () => {
  const { membresia, reserva } = repartirComision(COMISION_02_OCT, 8900, 58900);
  assert.deepEqual(membresia, { fee: 4.76, net: 84.24, base: 4.1, iva: 0.66 });
  assert.deepEqual(reserva, { fee: 26.73, net: 473.27, base: 23.05, iva: 3.68 });
});

caso('las dos partes suman al centavo lo que dice Stripe (fee, base, iva, net)', () => {
  const { membresia: m, reserva: r } = repartirComision(COMISION_02_OCT, 8900, 58900);
  const c = (x) => Math.round(x * 100);
  assert.equal(c(m.fee) + c(r.fee), 3149);
  assert.equal(c(m.base) + c(r.base), 2715);
  assert.equal(c(m.iva) + c(r.iva), 434);
  assert.equal(c(m.net) + c(r.net), 55751);
  assert.equal(c(m.base) + c(m.iva), c(m.fee), 'base + iva = fee en la membresia');
  assert.equal(c(r.base) + c(r.iva), c(r.fee), 'base + iva = fee en la reserva');
});

caso('sin desglose de IVA (Stripe no mando fee_details), base e iva quedan nulos en las dos', () => {
  const { membresia, reserva } = repartirComision({ fee: 31.49, net: 557.51, base: null, iva: null }, 8900, 58900);
  assert.equal(membresia.base, null); assert.equal(membresia.iva, null);
  assert.equal(reserva.base, null); assert.equal(reserva.iva, null);
  assert.equal(Math.round(membresia.fee * 100) + Math.round(reserva.fee * 100), 3149);
});

caso('sin membresia, toda la comision es de la reserva', () => {
  const { membresia, reserva } = repartirComision(COMISION_02_OCT, 0, 58900);
  assert.equal(membresia.fee, 0);
  assert.equal(reserva.fee, 31.49);
});

// --- El webhook usa el reparto en los dos eventos -------------------------------

const webhook = fs.readFileSync(path.join(RAIZ, 'supabase', 'functions', 'stripe-webhook', 'index.ts'), 'utf8');

caso('checkout.session.completed registra la reserva SIN la membresia', () => {
  const montos = webhook.match(/\(\(session\.amount_total \?\? 0\) - centavosMembresia\) \/ 100/g) ?? [];
  assert.ok(montos.length >= 4, `amount y net_amount de las dos inserciones de reserva deben restar la membresia (hay ${montos.length})`);
  assert.match(webhook, /repartirComision\(comisionDelCobro, centavosMembresia, session\.amount_total \?\? 0\)\.reserva/);
});

caso('invoice.paid registra solo la membresia y le toca su parte de comision', () => {
  assert.match(webhook, /const membershipAmount = facturaMixta\s*\?\s*centavosMembresia \/ 100/);
  assert.match(webhook, /repartirComision\(comisionDelCobro, centavosMembresia, invoice\.amount_paid \?\? 0\)\.membresia/);
});

caso('invoice.paid consulta la factura con sus pagos cuando el evento no los trae', () => {
  assert.match(webhook, /stripe\.invoices\.retrieve\(invoice\.id, \{ expand: \['payments'\] \}\)/);
});

console.log(`\n${casos} casos OK: un cobro mixto se registra una vez, repartido.`);
