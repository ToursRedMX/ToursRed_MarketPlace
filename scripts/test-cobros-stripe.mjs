#!/usr/bin/env node
/**
 * Generar una CLABE no es cobrar, y confirmar un SPEI no duplica la fila.
 *
 * ============================================================================
 * EL FALLO QUE ESTO CUBRE, MEDIDO EN PRODUCCION
 * ============================================================================
 *
 * En `stripe-webhook` el insert de `payment_transactions` del anticipo estaba
 * FUERA del if/else que mira `session.payment_status`, con `status:
 * 'succeeded'` escrito a mano. Para SPEI (`customer_balance`) y OXXO ese mismo
 * bloque corre primero con 'unpaid' —Stripe solo emitio la CLABE o el
 * voucher— asi que se registraba un ingreso por dinero que no habia llegado.
 *
 * Cruzado contra la API de Stripe el 11-sep-2026 (acct_1Roc3vEs5wtTyCYm):
 *
 *     pi_3TyfTt...  $601.50    29-jul-2026   requires_action, amount_received 0
 *     pi_3U2cet...  $3,125.69  09-ago-2026   requires_action, amount_received 0
 *
 * $3,727.19 que nunca llegaron. Las dos reservas estaban bien en `bookings`
 * ('pending', `paid_at` nulo) y `stripe_orders` tambien distinguia 'unpaid':
 * el unico que mentia era `payment_transactions`.
 *
 * En `vista_movimientos_financieros` las dos filas entran como caja +3,727.19
 * y pasivo +3,727.19, con `ingreso` en 0: no infla la utilidad, infla el saldo
 * de EFECTIVO. Y por eso el invariante `activo = pasivo + ingreso` no lo caza
 * nunca — 3727.19 = 3727.19 + 0 cuadra. Mismo patron que el tipo de cambio de
 * relleno en los gastos recurrentes: un numero mal que suma bien.
 *
 * Y habia un duplicado latente: `checkout.session.completed` y
 * `checkout.session.async_payment_succeeded` comparten `case`, y el insert no
 * comprobaba si la fila ya existia. Un SPEI pagado de verdad habria dejado dos
 * filas, y el UPDATE de la comision —que filtra por `stripe_payment_intent_id`
 * sin `.limit`— le habria pegado a las dos. Cero duplicados en produccion solo
 * porque ninguno de los dos SPEI llego a pagarse.
 *
 * ============================================================================
 * POR QUE ESTA PRUEBA EJECUTA Y NO SOLO LEE
 * ============================================================================
 *
 * La decision —que estado se escribe y cuando se toca una fila existente— vive
 * en `_shared/cobrosStripe.ts`, un modulo plano sin imports de supabase-js. Se
 * puede importar y CORRER con un cliente de mentira, que es lo unico que
 * demuestra la regla de verdad. Los dos ultimos casos si leen el fuente, para
 * que nadie reintroduzca el 'succeeded' a mano por otro camino.
 *
 *   node scripts/test-cobros-stripe.mjs
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
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

const { asentarCobroStripe, estadoSegunStripe } = await import(
  pathToFileURL(path.join(AQUI, '..', 'supabase', 'functions', '_shared', 'cobrosStripe.ts')).href
);

/**
 * Cliente de mentira que registra lo que se le pidio. `filasExistentes` es lo
 * que devuelve el select acotado con `.limit(1)`, que es lo que decide la rama.
 */
const clienteFalso = (filasExistentes) => {
  const hechos = { inserts: [], updates: [] };
  const api = {
    from: () => ({
      select: () => ({
        eq: () => ({ limit: async () => ({ data: filasExistentes }) }),
      }),
      insert: async (fila) => { hechos.inserts.push(fila); return { error: null }; },
      update: (cambios) => ({
        eq: async (_col, valor) => { hechos.updates.push({ cambios, id: valor }); return { error: null }; },
      }),
    }),
  };
  return { api, hechos };
};

/** La fila tal cual la arma el webhook, con el cero de comision de siempre. */
const FILA = {
  booking_id: 'bk-1',
  stripe_payment_intent_id: 'pi_3TyfTt',
  payment_processor: 'stripe',
  amount: 601.5,
  currency: 'mxn',
  payment_method_type: 'Transferencia Bancaria',
  net_amount: 601.5,
  processor_fee: 0,
  charge_context: 'booking_deposit',
  charge_reference_id: 'bk-1',
  metadata: { id: 'cs_test_1' },
};

const casos = [];

// --- 1. La traduccion de payment_status -------------------------------------
casos.push(async () => {
  assert.equal(estadoSegunStripe('paid'), 'succeeded');
  assert.equal(estadoSegunStripe('no_payment_required'), 'succeeded',
    'una sesion cubierta al 100% no tiene nada pendiente de cobrar');
  assert.equal(estadoSegunStripe('unpaid'), 'pending',
    'unpaid es SPEI u OXXO esperando el dinero, no un cobro');
  // Conservador a proposito: quedarse corto se ve en la conciliacion, pasarse
  // infla ingreso, margen y base de IVA sin que nadie lo note.
  assert.equal(estadoSegunStripe(undefined), 'pending');
  assert.equal(estadoSegunStripe('lo_que_stripe_invente_mañana'), 'pending');
});

// --- 2. EL FALLO: sesion unpaid NO puede quedar como cobro ------------------
casos.push(async () => {
  const { api, hechos } = clienteFalso([]);
  const r = await asentarCobroStripe(api, FILA, 'unpaid');
  assert.equal(r.accion, 'insertado');
  assert.equal(hechos.inserts.length, 1);
  assert.equal(hechos.inserts[0].status, 'pending',
    'generar la CLABE de un SPEI no es cobrar: esto registraba $3,727.19 que nunca entraron');
});

// --- 3. Sesion paid si se registra como cobro -------------------------------
casos.push(async () => {
  const { api, hechos } = clienteFalso([]);
  const r = await asentarCobroStripe(api, FILA, 'paid');
  assert.equal(r.accion, 'insertado');
  assert.equal(hechos.inserts[0].status, 'succeeded');
  assert.equal(hechos.inserts[0].processor_fee, 0,
    'la comision la rellena el paso siguiente con el dato real de Stripe');
});

// --- 4. EL DUPLICADO: el SPEI se paga y la fila pending se CONFIRMA ---------
casos.push(async () => {
  const { api, hechos } = clienteFalso([{ id: 'tx-1', status: 'pending' }]);
  const r = await asentarCobroStripe(api, FILA, 'paid');
  assert.equal(r.accion, 'confirmado');
  assert.equal(hechos.inserts.length, 0,
    'insertar sobre la fila pending deja el cobro contado dos veces, y el UPDATE de la comision le pega a ambas');
  assert.equal(hechos.updates.length, 1);
  assert.equal(hechos.updates[0].id, 'tx-1');
  assert.equal(hechos.updates[0].cambios.status, 'succeeded');
});

// --- 5. La confirmacion NO pisa la comision ya guardada ---------------------
casos.push(async () => {
  const { api, hechos } = clienteFalso([{ id: 'tx-1', status: 'pending' }]);
  await asentarCobroStripe(api, FILA, 'paid');
  assert.ok(!('processor_fee' in hechos.updates[0].cambios),
    'escribir el 0 de la fila encima de una comision buena es el error que cerro el #211 en MercadoPago');
});

// --- 6. Reenvio del webhook ya liquidado: no se toca nada -------------------
casos.push(async () => {
  const { api, hechos } = clienteFalso([{ id: 'tx-1', status: 'succeeded' }]);
  const r = await asentarCobroStripe(api, FILA, 'paid');
  assert.equal(r.accion, 'sin_cambio');
  assert.equal(hechos.inserts.length, 0);
  assert.equal(hechos.updates.length, 0);
});

// --- 7. Un evento viejo 'unpaid' NO degrada un cobro liquidado --------------
casos.push(async () => {
  // Stripe reintenta y los eventos pueden llegar desordenados.
  const { api, hechos } = clienteFalso([{ id: 'tx-1', status: 'succeeded' }]);
  const r = await asentarCobroStripe(api, FILA, 'unpaid');
  assert.equal(r.accion, 'sin_cambio');
  assert.equal(hechos.updates.length, 0,
    'devolver a pending un cobro ya liquidado borraria ingreso real');
});

// --- 8. El `status` que mande quien llama se IGNORA -------------------------
casos.push(async () => {
  // Esta es la defensa de fondo: si se pudiera mandar en la fila, el proximo
  // que copie el bloque volveria a escribir 'succeeded' a mano.
  const { api, hechos } = clienteFalso([]);
  await asentarCobroStripe(api, { ...FILA, status: 'succeeded' }, 'unpaid');
  assert.equal(hechos.inserts[0].status, 'pending',
    'manda payment_status, no lo que traiga la fila');
});

// --- 9. Sin PaymentIntent se inserta igual, no se pierde el cobro -----------
casos.push(async () => {
  const { api, hechos } = clienteFalso([{ id: 'tx-1', status: 'pending' }]);
  const r = await asentarCobroStripe(api, { ...FILA, stripe_payment_intent_id: null }, 'paid');
  assert.equal(r.accion, 'insertado',
    'sin PaymentIntent no hay con que buscar; perder el cobro seria peor');
  assert.equal(hechos.inserts.length, 1);
});

// --- 10. En el webhook, todo booking_deposit pasa por el ayudante -----------
casos.push(async () => {
  const fuente = readFileSync('supabase/functions/stripe-webhook/index.ts', 'utf8');
  const lineas = fuente.split('\n');

  const sitios = lineas
    .map((linea, i) => (linea.includes("charge_context: 'booking_deposit'") ? i : -1))
    .filter((i) => i >= 0);

  assert.equal(sitios.length, 3,
    `se esperaban 3 sitios de booking_deposit (cobertura insuficiente, camino normal y payment_intent.succeeded) y hay ${sitios.length}`);

  for (const i of sitios) {
    // Hacia arriba hasta el inicio de la llamada: tiene que ser el ayudante y
    // no un `.insert({` suelto.
    let inicio = -1;
    for (let j = i; j >= 0 && i - j < 40; j--) {
      if (lineas[j].includes('asentarCobroStripe(') || lineas[j].includes('.insert(')) { inicio = j; break; }
    }
    assert.ok(inicio >= 0, `no se encontro el inicio de la llamada de la linea ${i + 1}`);
    assert.ok(lineas[inicio].includes('asentarCobroStripe('),
      `el booking_deposit de la linea ${i + 1} se inserta directo: se salta la regla del estado`);

    const cuerpo = lineas.slice(inicio, i + 1).join('\n');
    assert.ok(!/\bstatus:/.test(cuerpo),
      `el booking_deposit de la linea ${i + 1} vuelve a fijar el status a mano`);
  }
});

// --- 11. No se le pide la comision a Stripe si no hubo cobro ---------------
casos.push(async () => {
  const fuente = readFileSync('supabase/functions/stripe-webhook/index.ts', 'utf8');

  // La condicion misma del ternario, no «que aparezca cerca»: mirar el
  // vecindario dejaba pasar quitarle el `&& cobroLiquidado` mientras la
  // declaracion seguia arriba sin usarse.
  const decl = fuente.match(/const stripeFee = ([^\n]*)\n\s*\? await getStripeProcessorFee/);
  assert.ok(decl, 'no se encontro la declaracion de stripeFee del anticipo');
  assert.ok(/\bcobroLiquidado\b/.test(decl[1]),
    `con la sesion en unpaid todavia no hay charge ni balance_transaction que leer; la condicion es "${decl[1]}"`);

  // Y que `cobroLiquidado` signifique lo que dice llamarse.
  assert.ok(/const cobroLiquidado = estadoSegunStripe\(paymentStatus\) === 'succeeded';/.test(fuente),
    'cobroLiquidado tiene que salir de estadoSegunStripe, no de otra cosa');
});

// --- 12. payment_intent.succeeded CONFIRMA, no se salta -------------------
casos.push(async () => {
  // El endpoint de Stripe NO esta suscrito a
  // `checkout.session.async_payment_succeeded` (leido en `enabled_events` el
  // 11-sep-2026), asi que cuando el dinero de un SPEI entra, el UNICO evento
  // que llega es payment_intent.succeeded. Si esa rama se salta la fila
  // existente —como hacia con `if (!existingTransaction)`— el cobro se queda
  // en 'pending' para siempre: el arreglo del cobro fantasma habria cambiado
  // contar de mas por contar de menos.
  const fuente = readFileSync('supabase/functions/stripe-webhook/index.ts', 'utf8');
  const caso = fuente.slice(fuente.indexOf("case 'payment_intent.succeeded':"));
  const bloque = caso.slice(0, caso.indexOf("case 'customer.subscription.created':"));

  assert.ok(/asentarCobroStripe\(/.test(bloque),
    'payment_intent.succeeded tiene que pasar por el ayudante para poder confirmar una fila pending');
  assert.ok(!/if \(!existingTransaction\)/.test(bloque),
    'volvio el "solo si no existe": deja el SPEI pagado en pending para siempre');
  assert.ok(/charge_context: 'booking_deposit'/.test(bloque),
    "sin charge_context la vista arma la categoria como 'cobro_' || NULL");
});

// --- 13. Y la comision se pide tambien al confirmar ------------------------
casos.push(async () => {
  const fuente = readFileSync('supabase/functions/stripe-webhook/index.ts', 'utf8');
  const caso = fuente.slice(fuente.indexOf("case 'payment_intent.succeeded':"));
  const bloque = caso.slice(0, caso.indexOf("case 'customer.subscription.created':"));
  assert.ok(/accionCobroPi !== 'sin_cambio'/.test(bloque),
    'la fila pending de un SPEI nacio sin comision: al confirmarla hay que pedirla');
});

let ok = 0;
for (const caso of casos) { await caso(); ok++; }
console.log(`Cobros de Stripe: ${ok}/${casos.length} casos OK`);
