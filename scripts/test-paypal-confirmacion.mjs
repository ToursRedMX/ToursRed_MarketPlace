/**
 * `confirmBooking` de capture-paypal-order: que el dinero cobrado se asiente
 * SIEMPRE, y que solo cuente como anticipo el dinero que es anticipo.
 *
 * ============================================================================
 * LOS DOS BUGS QUE ESTO FIJA
 * ============================================================================
 *
 * 1. Cuando el cobro no llegaba al piso, la funcion marcaba la reserva como
 *    `processing` y volvia SIN registrar nada. PayPal ya habia cobrado. No
 *    quedaba fila en `payment_transactions` ni rastro en `audit_errors`, solo
 *    un `console.log`.
 *
 *    La consecuencia encadenada es la que muerde: DOS pagos parciales nunca se
 *    sumaban. Como el primero no quedaba asentado, en el segundo `alreadyPaid`
 *    volvia a ser 0 y la reserva no confirmaba nunca. El viajero pagaba dos
 *    veces y seguia sin reserva. Es el caso 2 de abajo.
 *
 * 2. La consulta de pagos previos no filtraba por `charge_context`, asi que los
 *    cobros de seguro, servicios opcionales, suplementos y cuotas del plan de
 *    pagos contaban como si fueran anticipo. Esta en los datos reales: la
 *    reserva 860a587c tiene un `payment_plan_installment` de 2,162.79 frente a
 *    un anticipo de 3,089.70. Es el caso 3.
 *
 * Las dos reglas del piso (anticipo bruto + billetera) viven en
 * `_shared/exigible.ts` y aqui se usa la de verdad, no una copia.
 *
 *   node scripts/test-paypal-confirmacion.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const FUENTE = 'supabase/functions/capture-paypal-order/index.ts';
const EXIGIBLE = 'supabase/functions/_shared/exigible.ts';

const codigo = readFileSync(FUENTE, 'utf8');

/** Recorta `async function NOMBRE(...) { ... }` contando llaves. */
function recortarFuncion(fuente, nombre) {
  const marca = `async function ${nombre}(`;
  const inicio = fuente.indexOf(marca);
  assert.notEqual(inicio, -1, `no se encontro ${nombre} en ${FUENTE}`);
  let i = fuente.indexOf('{', inicio);
  const abre = i;
  let nivel = 0;
  for (; i < fuente.length; i++) {
    const c = fuente[i];
    const par = fuente.slice(i, i + 2);
    if (par === '//') { i = fuente.indexOf('\n', i); continue; }
    if (par === '/*') { i = fuente.indexOf('*/', i) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      for (i++; i < fuente.length; i++) {
        if (fuente[i] === '\\') { i++; continue; }
        if (fuente[i] === q) break;
      }
      continue;
    }
    if (c === '{') nivel++;
    else if (c === '}') { nivel--; if (nivel === 0) return fuente.slice(inicio, i + 1); }
  }
  throw new Error(`${nombre} sin cerrar`);
}

const compilar = (src) => ts.transpileModule(src.replace(/^import[^\n]*\n/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

/**
 * Cliente de mentiras con la forma de PostgREST: cada builder es encadenable Y
 * esperable. `maybeSingle()` devuelve una fila; esperar el builder devuelve la
 * lista. Es la diferencia que importa aqui, porque el filtro de
 * `charge_context` se aplica sobre la lista.
 */
function clienteFalso(estado) {
  const registro = { inserts: [], updates: [], fallos: [] };

  function builder(tabla) {
    const filtros = {};
    const resolver = async (unaSola) => {
      if (tabla === 'bookings') {
        if (estado.errorReserva) return { data: null, error: estado.errorReserva };
        return { data: estado.reserva ?? null, error: null };
      }
      if (tabla === 'payment_transactions') {
        const filas = estado.transacciones ?? [];
        if (filtros.paypal_capture_id !== undefined) {
          const ya = filas.find((f) => f.paypal_capture_id === filtros.paypal_capture_id);
          return { data: ya ? { id: 'tx-existente' } : null, error: null };
        }
        const seleccion = filas.filter((f) =>
          (filtros.status === undefined || f.status === filtros.status) &&
          (filtros.payment_processor === undefined || f.payment_processor === filtros.payment_processor) &&
          // Si el codigo NO filtra por charge_context, esta condicion no se
          // aplica y entran todas las filas — que es exactamente el bug.
          (filtros.charge_context === undefined || f.charge_context === filtros.charge_context)
        );
        return { data: unaSola ? (seleccion[0] ?? null) : seleccion, error: estado.errorPagos ?? null };
      }
      return { data: unaSola ? null : [], error: null };
    };

    const q = {
      select: () => q,
      eq: (col, val) => { filtros[col] = val; return q; },
      is: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: () => resolver(true),
      single: () => resolver(true),
      then: (ok, err) => resolver(false).then(ok, err),
    };
    return q;
  }

  const supabase = {
    from(tabla) {
      const base = builder(tabla);
      base.update = (valores) => {
        registro.updates.push({ tabla, valores });
        const u = { eq: () => u, then: (ok) => Promise.resolve({ error: null }).then(ok) };
        return u;
      };
      base.insert = (valores) => {
        registro.inserts.push({ tabla, valores });
        if (tabla === 'payment_transactions') (estado.transacciones ??= []).push(valores);
        return Promise.resolve({ error: null });
      };
      return base;
    },
    async rpc() { return { data: null, error: null }; },
  };

  return { supabase, registro };
}

// ---------------------------------------------------------------------------
// Se monta el modulo: la regla real de exigible.ts + las dos funciones reales.
// ---------------------------------------------------------------------------
function montar(estado) {
  const { supabase, registro } = clienteFalso(estado);
  const contexto = vm.createContext({
    exports: {},
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    EdgeRuntime: { waitUntil() {} },
    Deno: { env: { get: () => 'x' } },
    Sentry: { captureException() {}, flush: async () => {} },
    async registrarFallo(contextoFallo, detalle, datos) {
      registro.fallos.push({ contexto: contextoFallo, detalle, datos });
    },
    setTimeout, Promise,
  });

  vm.runInContext(compilar(readFileSync(EXIGIBLE, 'utf8')), contexto);
  Object.assign(contexto, contexto.exports);

  vm.runInContext(compilar([
    recortarFuncion(codigo, 'registrarCobroPaypal'),
    recortarFuncion(codigo, 'confirmBooking'),
    'exports.confirmBooking = confirmBooking;',
  ].join('\n\n')), contexto);

  return { confirmBooking: contexto.exports.confirmBooking, supabase, registro, estado };
}

const captura = (id, monto) => ({
  purchase_units: [{ payments: { captures: [{ amount: { value: String(monto), currency_code: 'MXN' }, seller_receivable_breakdown: { paypal_fee: { value: '0' } } }] } }],
  id,
});

const depositos = (r) => (r.estado.transacciones ?? []).filter((t) => t.charge_context === 'booking_deposit');
const confirmada = (r) => r.registro.updates.some((u) => u.valores?.status === 'confirmed');
const enProceso = (r) => r.registro.updates.some((u) => u.valores?.payment_status === 'processing');

const casos = [];

// --- 1. Cobro corto: se asienta el dinero y queda rastro --------------------
casos.push(async () => {
  const r = montar({ reserva: { payment_status: 'pending', deposit_amount: 3000, user_id: 'u1', points_used: 0, toursred_cash_used: 0 }, transacciones: [] });
  await r.confirmBooking(r.supabase, 'b1', 'cap-1', captura('cap-1', 1000), null);

  assert.ok(!confirmada(r), 'no debe confirmarse con 1000 de 3000');
  assert.ok(enProceso(r), 'debe quedar en processing');
  assert.equal(depositos(r).length, 1,
    'PayPal ya cobro: el dinero DEBE quedar asentado aunque no alcance el piso');
  assert.equal(depositos(r)[0].amount, 1000);
  assert.ok(r.registro.fallos.some((f) => f.contexto.includes('cobertura-insuficiente')),
    'debe dejar rastro en audit_errors, no solo un console.log');
});

// --- 2. EL CASO: dos pagos parciales se acumulan ----------------------------
casos.push(async () => {
  const estado = { reserva: { payment_status: 'pending', deposit_amount: 3000, user_id: 'u1', points_used: 0, toursred_cash_used: 0 }, transacciones: [] };
  const r1 = montar(estado);
  await r1.confirmBooking(r1.supabase, 'b1', 'cap-1', captura('cap-1', 1600), null);
  assert.ok(!confirmada(r1), 'el primer pago no alcanza');

  // Segundo cobro, captura distinta, MISMO estado de base.
  const r2 = montar(estado);
  await r2.confirmBooking(r2.supabase, 'b1', 'cap-2', captura('cap-2', 1600), null);

  assert.ok(confirmada(r2),
    'FALLO: dos pagos parciales no se suman. El primero no quedo asentado, asi que ' +
    'alreadyPaid volvio a 0 y el viajero pago dos veces sin reserva confirmada');
});

// --- 3. Lo que no es anticipo no cuenta como anticipo -----------------------
//     Numeros de la reserva real 860a587c.
casos.push(async () => {
  const r = montar({
    reserva: { payment_status: 'pending', deposit_amount: 3089.70, user_id: 'u1', points_used: 0, toursred_cash_used: 0 },
    transacciones: [
      { amount: 2162.79, status: 'succeeded', payment_processor: 'paypal', charge_context: 'payment_plan_installment', paypal_capture_id: 'cuota-1' },
    ],
  });
  await r.confirmBooking(r.supabase, 'b1', 'cap-1', captura('cap-1', 950), null);

  assert.ok(!confirmada(r),
    'FALLO: una cuota del plan de pagos se esta contando como anticipo. Solo 950 de ' +
    '3089.70 son anticipo, pero el filtro de charge_context falta y suma los 2162.79');
});

// --- 4. Un cobro de seguro tampoco cuenta ----------------------------------
casos.push(async () => {
  const r = montar({
    reserva: { payment_status: 'pending', deposit_amount: 1000, user_id: 'u1', points_used: 0, toursred_cash_used: 0 },
    transacciones: [
      { amount: 900, status: 'succeeded', payment_processor: 'paypal', charge_context: 'insurance', paypal_capture_id: 'seg-1' },
    ],
  });
  await r.confirmBooking(r.supabase, 'b1', 'cap-1', captura('cap-1', 200), null);
  assert.ok(!confirmada(r), 'el seguro no es anticipo');
});

// --- 5. Idempotencia: la misma captura no se asienta dos veces --------------
casos.push(async () => {
  const estado = { reserva: { payment_status: 'pending', deposit_amount: 3000, user_id: 'u1', points_used: 0, toursred_cash_used: 0 }, transacciones: [] };
  const r1 = montar(estado);
  await r1.confirmBooking(r1.supabase, 'b1', 'cap-1', captura('cap-1', 1000), null);
  const r2 = montar(estado);
  await r2.confirmBooking(r2.supabase, 'b1', 'cap-1', captura('cap-1', 1000), null);
  assert.equal(depositos(r2).length, 1, 'PayPal reintenta: la misma captura no debe duplicarse');
});

// --- 6. Camino feliz --------------------------------------------------------
casos.push(async () => {
  const r = montar({ reserva: { payment_status: 'pending', deposit_amount: 3000, user_id: 'u1', points_used: 0, toursred_cash_used: 0 }, transacciones: [] });
  await r.confirmBooking(r.supabase, 'b1', 'cap-1', captura('cap-1', 3000), null);
  assert.ok(confirmada(r));
  assert.equal(depositos(r).length, 1);
  assert.equal(r.registro.fallos.length, 0, 'un cobro correcto no debe ensuciar audit_errors');
});

// --- 7. La billetera cuenta (TRG-E5BGCYW29XY) ------------------------------
casos.push(async () => {
  const r = montar({ reserva: { payment_status: 'pending', deposit_amount: 5149.50, user_id: 'u1', points_used: 56261, toursred_cash_used: 0 }, transacciones: [] });
  await r.confirmBooking(r.supabase, 'b1', 'cap-1', captura('cap-1', 4706.84), null);
  assert.ok(confirmada(r),
    'pago 4,706.84 con tarjeta y 562.61 en puntos sobre un anticipo de 5,149.50');
});

// --- 8. Si no se puede leer la reserva, no se confirma ---------------------
casos.push(async () => {
  const r = montar({ reserva: null, errorReserva: { message: 'timeout' }, transacciones: [] });
  await r.confirmBooking(r.supabase, 'b1', 'cap-1', captura('cap-1', 99999), null);
  assert.ok(!confirmada(r), 'con la reserva ilegible el piso saldria 0 y todo confirmaria');
});

// --- 9. Autenticar no es autorizar -----------------------------------------
casos.push(async () => {
  const r = montar({ reserva: { payment_status: 'pending', deposit_amount: 100, user_id: 'dueño', points_used: 0, toursred_cash_used: 0 }, transacciones: [] });
  await r.confirmBooking(r.supabase, 'b1', 'cap-1', captura('cap-1', 500), 'otro-usuario');
  assert.ok(!confirmada(r), 'un usuario no puede capturar la orden de otro');
});

// --- 10. Ya confirmada: no repite efectos ----------------------------------
casos.push(async () => {
  const r = montar({ reserva: { payment_status: 'succeeded', deposit_amount: 100, user_id: 'u1', points_used: 0, toursred_cash_used: 0 }, transacciones: [] });
  await r.confirmBooking(r.supabase, 'b1', 'cap-1', captura('cap-1', 500), null);
  assert.equal(r.registro.updates.length, 0, 'una reserva ya confirmada no se vuelve a tocar');
});

let ok = 0;
for (const caso of casos) { await caso(); ok++; }
console.log(`PayPal confirmacion: ${ok}/${casos.length} casos OK`);
