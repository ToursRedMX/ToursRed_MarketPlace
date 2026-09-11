#!/usr/bin/env node
/**
 * Un cobro de PayPal termina siempre con su comision, y nunca duplicado.
 *
 * ============================================================================
 * EL FALLO QUE ESTO CUBRE, MEDIDO EN PRODUCCION
 * ============================================================================
 *
 * Los caminos sincronos insertan la fila de PayPal con `status: "succeeded"` y
 * `processor_fee: 0` porque al cobrar no conocen la comision. En los demas
 * procesadores el webhook la rellena; en PayPal no lo hacia nadie:
 * `capture-paypal-order` solo insertaba filas nuevas y, al encontrar una
 * existente, se iba.
 *
 * Consulta sobre produccion el 11-sep-2026:
 *
 *     charge_context            cobros   monto      desde        hasta
 *     booking_deposit                1   3999.65    2026-07-22   2026-07-22
 *     payment_plan_installment       1   2162.79    2026-07-22   2026-07-22
 *
 * El de `booking_deposit` ya no se reproduce (PR #188, 09-sep). El de
 * `payment_plan_installment` si: ese camino seguia igual.
 *
 * ============================================================================
 * POR QUE ESTA PRUEBA EJECUTA Y NO LEE
 * ============================================================================
 *
 * Las otras pruebas de Edge Functions de este repo afirman sobre el FUENTE,
 * porque la logica vive dentro de un handler de Deno. Aqui la parte que importa
 * —cuando se escribe la comision y cuando NO— se extrajo a `_shared`, que es un
 * modulo plano sin imports de supabase-js. Eso permite importarlo y CORRERLO
 * con un cliente de mentira, que es lo unico que demuestra de verdad la regla
 * de no pisar una comision buena con un cero.
 *
 *   node scripts/test-cobros-paypal.mjs
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

const { asentarCobroPaypal } = await import(
  pathToFileURL(path.join(AQUI, '..', 'supabase', 'functions', '_shared', 'cobrosPaypal.ts')).href
);

/**
 * Cliente de mentira que registra lo que se le pidio. Devuelve la fila que se
 * le configure para `maybeSingle`, que es lo que decide la rama.
 */
const clienteFalso = (filaExistente) => {
  const hechos = { inserts: [], updates: [] };
  const api = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: filaExistente }) }),
      }),
      insert: async (fila) => { hechos.inserts.push(fila); return { error: null }; },
      update: (cambios) => ({
        eq: async (_col, valor) => { hechos.updates.push({ cambios, id: valor }); return { error: null }; },
      }),
    }),
  };
  return { api, hechos };
};

const FILA = {
  paypal_capture_id: 'CAP-123',
  payment_processor: 'paypal',
  amount: 2162.79,
  status: 'succeeded',
  processor_fee: 84.35,
  net_amount: 2078.44,
  charge_context: 'payment_plan_installment',
};

const casos = [];

// --- 1. Si no hay fila, se inserta ------------------------------------------
casos.push(async () => {
  const { api, hechos } = clienteFalso(null);
  const r = await asentarCobroPaypal(api, FILA);
  assert.equal(r.accion, 'insertado');
  assert.equal(hechos.inserts.length, 1);
  assert.equal(hechos.updates.length, 0);
  assert.equal(hechos.inserts[0].processor_fee, 84.35);
});

// --- 2. EL FALLO: fila existente en cero, se le pone la comision ------------
casos.push(async () => {
  // Esto es exactamente lo que dejaba `process-payment-plan-installment`.
  const { api, hechos } = clienteFalso({ id: 'tx-1', processor_fee: 0 });
  const r = await asentarCobroPaypal(api, FILA);
  assert.equal(r.accion, 'comision_rellenada',
    'una fila liquidada en cero tiene que recibir la comision, no quedarse asi');
  assert.equal(hechos.updates.length, 1);
  assert.equal(hechos.updates[0].id, 'tx-1');
  assert.equal(hechos.updates[0].cambios.processor_fee, 84.35);
  assert.equal(hechos.updates[0].cambios.net_amount, 2078.44);
  // Y NO se inserta: ahi estaba el riesgo del duplicado.
  assert.equal(hechos.inserts.length, 0,
    'insertar sobre una fila existente deja el cobro contado dos veces');
});

// --- 3. Una comision buena NO se pisa con un cero ---------------------------
casos.push(async () => {
  // PayPal no siempre manda `seller_receivable_breakdown`; entonces el parseo
  // cae en "0", que es indistinguible de "no hubo comision". Escribir ese 0
  // encima de una comision ya guardada seria peor que no tocar nada.
  const { api, hechos } = clienteFalso({ id: 'tx-1', processor_fee: 84.35 });
  const r = await asentarCobroPaypal(api, { ...FILA, processor_fee: 0, net_amount: 2162.79 });
  assert.equal(r.accion, 'sin_cambio');
  assert.equal(hechos.updates.length, 0, 'se piso una comision buena con un cero');
  assert.equal(hechos.inserts.length, 0);
});

// --- 4. Y tampoco se pisa una comision buena con otra ------------------------
casos.push(async () => {
  const { api, hechos } = clienteFalso({ id: 'tx-1', processor_fee: 84.35 });
  const r = await asentarCobroPaypal(api, { ...FILA, processor_fee: 99.99 });
  assert.equal(r.accion, 'sin_cambio',
    'la primera comision asentada manda: reescribirla cambiaria un numero ya contabilizado');
  assert.equal(hechos.updates.length, 0);
});

// --- 5. Cero sobre cero no escribe nada -------------------------------------
casos.push(async () => {
  const { api, hechos } = clienteFalso({ id: 'tx-1', processor_fee: 0 });
  const r = await asentarCobroPaypal(api, { ...FILA, processor_fee: 0 });
  assert.equal(r.accion, 'sin_cambio');
  assert.equal(hechos.updates.length, 0, 'escribir 0 sobre 0 es ruido en la bitacora');
});

// --- 6. `processor_fee` nulo en la fila guardada cuenta como cero ------------
casos.push(async () => {
  const { api, hechos } = clienteFalso({ id: 'tx-1', processor_fee: null });
  const r = await asentarCobroPaypal(api, FILA);
  assert.equal(r.accion, 'comision_rellenada',
    'NULL y 0 significan lo mismo aqui: comision desconocida');
  assert.equal(hechos.updates.length, 1);
});

// --- 7. Sin id de captura se inserta, no se pierde el cobro -----------------
casos.push(async () => {
  const { api, hechos } = clienteFalso({ id: 'tx-1', processor_fee: 0 });
  const r = await asentarCobroPaypal(api, { ...FILA, paypal_capture_id: null });
  assert.equal(r.accion, 'insertado',
    'sin id de captura no hay con que buscar; perder el cobro seria peor');
  assert.equal(hechos.inserts.length, 1);
});

// --- 8. Los cinco caminos de capture-paypal-order pasan por aqui ------------
casos.push(async () => {
  const { readFileSync } = await import('node:fs');
  const fuente = readFileSync('supabase/functions/capture-paypal-order/index.ts', 'utf8');
  const llamadas = (fuente.match(/asentarCobroPaypal\(supabase/g) || []).length;
  assert.equal(llamadas, 5,
    `se esperaban 5 llamadas (booking_deposit, supplement, optional_service, insurance, payment_plan_installment) y hay ${llamadas}`);
  // Ningun insert directo puede quedar: seria un camino que se salta la regla.
  assert.ok(!/from\("payment_transactions"\)\.insert/.test(fuente),
    'quedo un insert directo a payment_transactions que no pasa por el ayudante');
});

let ok = 0;
for (const caso of casos) { await caso(); ok++; }
console.log(`Cobros de PayPal: ${ok}/${casos.length} casos OK`);
