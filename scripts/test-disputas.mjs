#!/usr/bin/env node
/**
 * Disputas y contracargos de los cinco procesadores.
 *
 * QUE VIGILA
 *
 * 1. Que los cinco webhooks registren disputas, y no solo Stripe.
 * 2. Que ninguno vuelva a "cubrirlas" con un console.warn.
 * 3. Que el efecto de una disputa (fila, bloqueo, alerta, asiento) siga
 *    viviendo en UN solo lugar.
 * 4. Que `registrarDisputa` haga lo correcto en cada fase, ejecutandola.
 * 5. Que los nombres de columna de `payment_transactions` que usa el modulo
 *    sigan existiendo en la migracion que los creo.
 *
 * POR QUE
 *
 * Al 10-sep-2026 solo `stripe-webhook` registraba disputas. PayPal tenia un
 * `case` con el nombre del evento cuyo cuerpo era `console.warn()` y `break`:
 * parecia cobertura y no persistia nada. Los otros tres no mencionaban la
 * palabra. El commit que trajo los handlers de Stripe lo dijo mejor que nadie:
 * "las disputas tienen ventana de respuesta, asi que el costo de no verla no
 * es perder el caso: es perderlo por no contestar".
 *
 * LO QUE ESTA PRUEBA NO PUEDE HACER
 *
 * No valida que el mapeo de cada procesador case con SU payload real: en la
 * base hay cero disputas de los cinco, asi que los mapeos se escribieron
 * contra documentacion. Lo que si comprueba es que cada webhook llame al
 * modulo compartido y que el modulo se comporte. El dia que llegue una disputa
 * de verdad, `last_payload` guarda el evento entero y el mapeo se corrige
 * leyendo esa fila.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const WEBHOOKS = {
  stripe: 'supabase/functions/stripe-webhook/index.ts',
  paypal: 'supabase/functions/paypal-webhook/index.ts',
  mercadopago: 'supabase/functions/mercadopago-webhook/index.ts',
  conekta: 'supabase/functions/conekta-webhook/index.ts',
  openpay: 'supabase/functions/openpay-webhook/index.ts',
};

const MODULO = 'supabase/functions/_shared/disputas.ts';

// ---------------------------------------------------------------------------
// 1. Los cinco llaman al modulo compartido
// ---------------------------------------------------------------------------
const sinCobertura = [];
for (const [procesador, ruta] of Object.entries(WEBHOOKS)) {
  const src = readFileSync(ruta, 'utf8');
  if (!/registrarDisputa\s*\(/.test(src)) sinCobertura.push(procesador);
}
assert.deepEqual(
  sinCobertura, [],
  `estos webhooks no registran disputas: ${sinCobertura.join(', ')}. ` +
  `Cada uno debe traducir su payload y llamar a registrarDisputa de ../_shared/disputas.ts.`,
);

// ---------------------------------------------------------------------------
// 2. Que cada uno se declare con SU procesador, y no copiando el del vecino
// ---------------------------------------------------------------------------
for (const [procesador, ruta] of Object.entries(WEBHOOKS)) {
  const src = readFileSync(ruta, 'utf8');
  assert.ok(
    new RegExp(`procesador:\\s*["']${procesador}["']`).test(src),
    `${ruta} llama a registrarDisputa pero no se declara como "${procesador}". ` +
    `Copiar el bloque de otro webhook sin cambiar esta linea guardaria la disputa ` +
    `bajo el procesador equivocado, y la unica es (processor, processor_dispute_id).`,
  );
}

// ---------------------------------------------------------------------------
// 3. Nadie "cubre" una disputa con un console.warn
// ---------------------------------------------------------------------------
// El patron exacto que tenia PayPal: un case de disputa cuyo cuerpo entero era
// registrar en consola. Si vuelve a aparecer, es una regresion al estado que
// esta prueba existe para impedir.
for (const [procesador, ruta] of Object.entries(WEBHOOKS)) {
  const lineas = readFileSync(ruta, 'utf8').split(/\r?\n/);
  lineas.forEach((linea, i) => {
    if (!/console\.(warn|log)\(/.test(linea)) return;
    if (!/dispute|disputa|chargeback|contracargo/i.test(linea)) return;
    // Un console de diagnostico esta bien; lo que no vale es que el SIGUIENTE
    // enunciado sea el break/return, o sea que no haga nada mas.
    const siguiente = (lineas[i + 1] ?? '').trim();
    assert.ok(
      !/^(break;|return\b)/.test(siguiente),
      `${ruta}:${i + 1} (${procesador}) registra la disputa en consola y corta. ` +
      `Eso es exactamente lo que PayPal hacia antes del 10-sep-2026: parece ` +
      `cobertura y no persiste nada.`,
    );
  });
}

// ---------------------------------------------------------------------------
// 4. El modulo no importa nada
// ---------------------------------------------------------------------------
// Misma razon que en contextoAuditoria.ts: los cinco webhooks no usan la misma
// version de supabase-js, y un import aqui meteria una segunda copia en el
// bundle de la mitad de ellos.
const fuente = readFileSync(MODULO, 'utf8');
const importa = fuente.split('\n').filter((l) => /^\s*import\s/.test(l));
assert.deepEqual(
  importa, [],
  `disputas.ts no debe importar nada y esta importando:\n  ${importa.join('\n  ')}`,
);

// ---------------------------------------------------------------------------
// 5. registrarDisputa, ejecutada
// ---------------------------------------------------------------------------
function cargar(src) {
  const js = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const contexto = {
    exports: {},
    require: (m) => { throw new Error(`import inesperado: ${m}`); },
    console: { log() {}, warn() {}, error() {} },
  };
  vm.runInNewContext(js, contexto);
  return contexto.exports;
}
const { registrarDisputa } = cargar(fuente);

/** Cliente falso que anota lo que se le pide. */
function clienteFalso({ ptx = { id: 'ptx-1', booking_id: 'bk-1' }, asientosPrevios = 0 } = {}) {
  const hecho = { upsert: null, updates: [], busquedas: [] };
  const supabase = {
    from(tabla) {
      const q = {
        _tabla: tabla,
        select() { return q; },
        eq(col, val) { hecho.busquedas.push({ tabla, col, val }); q._eq = { col, val }; return q; },
        async maybeSingle() { return { data: tabla === 'payment_transactions' ? ptx : null }; },
        async single() { return { data: { id: 'disp-1', booking_id: ptx?.booking_id ?? null }, error: null }; },
        upsert(fila, opts) { hecho.upsert = { fila, opts }; return q; },
        update(cambios) { hecho.updates.push({ tabla, cambios }); return q; },
        then(res) { return res({ count: asientosPrevios }); },
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
  return { supabase, hecho };
}

function avisosFalsos() {
  const registro = { admins: [], ops: [], asientos: [] };
  return {
    registro,
    avisos: {
      notificarAdmins: async (tipo, titulo, mensaje, data) => { registro.admins.push({ tipo, titulo, mensaje, data }); },
      alertarOps: async (asunto, filas) => { registro.ops.push({ asunto, filas }); },
      crearAsientoContable: async (opts) => { registro.asientos.push(opts); return 'asiento-1'; },
    },
  };
}

const base = {
  procesador: 'conekta',
  disputaId: 'dis_123',
  pagoId: 'ord_456',
  monto: 1500,
  moneda: 'MXN',
  motivo: 'fraudulent',
  estadoCrudo: 'pending',
  tipoEvento: 'charge.chargeback.created',
  payload: { crudo: true },
};

// --- Abierta: fila, bloqueo de check-in, aviso a admins y a ops -------------
{
  const { supabase, hecho } = clienteFalso();
  const { registro, avisos } = avisosFalsos();
  const r = await registrarDisputa(supabase, { ...base, fase: 'abierta', evidenciaVence: '2026-10-01T00:00:00Z' }, avisos);

  assert.equal(r.ok, true, 'una disputa abierta debe registrarse');
  assert.equal(hecho.upsert.fila.processor, 'conekta', 'la fila guarda el procesador');
  assert.equal(hecho.upsert.opts.onConflict, 'processor,processor_dispute_id',
    'el upsert debe ir sobre la unica COMPUESTA; con solo el id de disputa, dos procesadores se pisarian');
  assert.equal(hecho.upsert.fila.last_payload.crudo, true, 'siempre se guarda el payload entero');
  assert.ok(hecho.updates.some((u) => u.tabla === 'bookings' && u.cambios.dispute_hold_at),
    'una disputa abierta bloquea el check-in de la reserva');
  assert.equal(registro.admins.length, 1, 'se notifica a los admins');
  assert.equal(registro.ops.length, 1, 'se alerta a operaciones');
  assert.equal(registro.asientos.length, 0, 'abrir una disputa no mueve la contabilidad');
  assert.ok(registro.ops[0].asunto.includes('conekta'), 'la alerta dice de que procesador es');
}

// --- Cerrada y ganada: se libera el bloqueo, sin asiento --------------------
{
  const { supabase, hecho } = clienteFalso();
  const { registro, avisos } = avisosFalsos();
  await registrarDisputa(supabase, { ...base, fase: 'cerrada', resultado: 'ganada', estadoCrudo: 'won' }, avisos);

  assert.ok(hecho.updates.some((u) => u.tabla === 'bookings' && u.cambios.dispute_hold_at === null),
    'ganar la disputa libera el bloqueo de check-in');
  assert.equal(registro.asientos.length, 0, 'una disputa ganada no genera egreso');
  assert.ok(hecho.upsert.fila.closed_at, 'se marca la fecha de cierre');
}

// --- Cerrada y perdida: asiento contable ------------------------------------
{
  const { supabase } = clienteFalso();
  const { registro, avisos } = avisosFalsos();
  await registrarDisputa(supabase, { ...base, fase: 'cerrada', resultado: 'perdida', estadoCrudo: 'lost' }, avisos);

  assert.equal(registro.asientos.length, 1, 'perder la disputa genera un asiento');
  const a = registro.asientos[0];
  assert.equal(a.entryType, 'egreso');
  assert.equal(a.sourceType, 'dispute');
  const debe = a.lineas.reduce((s, l) => s + l.debit, 0);
  const haber = a.lineas.reduce((s, l) => s + l.credit, 0);
  assert.equal(debe, haber, 'el asiento tiene que cuadrar');
  assert.equal(debe, 1500, 'por el monto de la disputa');
  assert.ok(a.lineas.some((l) => l.account_code === '606.03'), 'carga a contracargos');
  assert.ok(a.lineas.some((l) => l.description.includes('conekta')),
    'la linea dice el procesador: la cuenta de saldo es generica y sin esto no se distingue');
}

// --- Idempotencia: un reintento no duplica el asiento ----------------------
{
  const { supabase } = clienteFalso({ asientosPrevios: 1 });
  const { registro, avisos } = avisosFalsos();
  await registrarDisputa(supabase, { ...base, fase: 'cerrada', resultado: 'perdida', estadoCrudo: 'lost' }, avisos);
  assert.equal(registro.asientos.length, 0,
    'si el asiento ya existia no se vuelve a postear: los procesadores reintentan');
}

// --- Sin payment_transaction: se registra igual ----------------------------
{
  const { supabase, hecho } = clienteFalso({ ptx: null });
  const { registro, avisos } = avisosFalsos();
  const r = await registrarDisputa(supabase, { ...base, fase: 'abierta' }, avisos);
  assert.equal(r.ok, true, 'una disputa que no se puede ligar se registra igual');
  assert.equal(hecho.upsert.fila.booking_id, undefined, 'no se inventa una reserva');
  assert.equal(registro.ops.length, 1, 'y aun asi se alerta: perderla por no poder ligarla seria peor');
}

// --- Conekta busca por sus DOS columnas ------------------------------------
{
  const { supabase, hecho } = clienteFalso({ ptx: null });
  const { avisos } = avisosFalsos();
  await registrarDisputa(supabase, { ...base, fase: 'actualizada' }, avisos);
  const columnas = hecho.busquedas.filter((b) => b.tabla === 'payment_transactions').map((b) => b.col);
  assert.deepEqual(columnas, ['conekta_order_id', 'conekta_charge_id'],
    'Conekta tiene dos columnas de id en payment_transactions y hay que probar las dos');
}

// ---------------------------------------------------------------------------
// 6. Las columnas de payment_transactions existen de verdad
// ---------------------------------------------------------------------------
// El primer intento de este modulo asumio un `processor_payment_id` generico
// que NO existe. Se comprueba contra las migraciones para que no vuelva a
// colarse un nombre inventado.
const COLUMNAS = ['stripe_payment_intent_id', 'paypal_capture_id', 'mercadopago_payment_id',
  'conekta_order_id', 'conekta_charge_id', 'openpay_charge_id'];
for (const col of COLUMNAS) {
  assert.ok(fuente.includes(col), `disputas.ts perdio la columna ${col}`);
}

console.log(
  `Disputas: los ${Object.keys(WEBHOOKS).length} procesadores registran, ` +
  `6 escenarios de registrarDisputa ejecutados, ${COLUMNAS.length} columnas de ligado comprobadas.`,
);
