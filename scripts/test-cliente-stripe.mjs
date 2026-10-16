#!/usr/bin/env node
// Un `cus_...` guardado solo vale en la cuenta de Stripe donde se creo.
//
// El 16-oct-2026 un pago mixto (puntos + Stripe) murio con «No such customer:
// 'cus_Uq6pStHfPsq9w7'»: create-checkout-session reutilizaba el cliente de
// `stripe_customers` sin preguntar, y la llave del servidor ya apuntaba a otra
// cuenta. El mismo fallo espera a todo usuario con cliente de prueba guardado
// el dia que la llave pase a livemode.
//
// Esta prueba EJECUTA clienteStripeVigente() contra un Stripe falso y despues
// lee las dos funciones que reutilizan un cliente guardado, para que no
// vuelvan a pasarlo directo a Stripe.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

function cargar(ruta) {
  const fuente = readFileSync(ruta, 'utf8');
  const compilado = ts.transpileModule(fuente, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compilado, { exports, module: { exports } });
  return exports;
}

const { clienteStripeVigente } = cargar('supabase/functions/_shared/clienteStripe.ts');

function stripeQue(responde) {
  const pedidos = [];
  return {
    pedidos,
    customers: {
      async retrieve(id) {
        pedidos.push(id);
        return responde(id);
      },
    },
  };
}

// La forma real del error, copiada del log del 16-oct (stripe@22.3.0).
function noExiste(id) {
  const error = new Error(`No such customer: '${id}'`);
  error.type = 'StripeInvalidRequestError';
  error.code = 'resource_missing';
  error.raw = { code: 'resource_missing', param: 'customer' };
  return error;
}

let casos = 0;

// 1. Existe en esta cuenta: se reutiliza.
{
  const stripe = stripeQue((id) => ({ id }));
  assert.equal(await clienteStripeVigente(stripe, 'cus_vivo'), true);
  assert.deepEqual(stripe.pedidos, ['cus_vivo']);
  casos++;
}

// 2. Otra cuenta u otro modo: el caso del 16-oct.
{
  const stripe = stripeQue((id) => { throw noExiste(id); });
  assert.equal(await clienteStripeVigente(stripe, 'cus_Uq6pStHfPsq9w7'), false);
  casos++;
}

// 3. Mismo error con el codigo solo en `raw`.
{
  const stripe = stripeQue(() => { throw { raw: { code: 'resource_missing' } }; });
  assert.equal(await clienteStripeVigente(stripe, 'cus_x'), false);
  casos++;
}

// 4. Borrado en esta cuenta: Stripe lo devuelve con deleted: true, sin error.
{
  const stripe = stripeQue((id) => ({ id, deleted: true }));
  assert.equal(await clienteStripeVigente(stripe, 'cus_borrado'), false);
  casos++;
}

// 5. Cualquier otro error se relanza: una caida no justifica crear un duplicado.
for (const error of [
  Object.assign(new Error('timeout'), { type: 'StripeConnectionError' }),
  Object.assign(new Error('Invalid API Key'), { type: 'StripeAuthenticationError', code: 'api_key_invalid' }),
  Object.assign(new Error('rate'), { code: 'rate_limit' }),
]) {
  const stripe = stripeQue(() => { throw error; });
  await assert.rejects(() => clienteStripeVigente(stripe, 'cus_x'), error);
  casos++;
}

// --- Las dos funciones que reutilizan un cliente guardado ---------------------

const checkout = readFileSync('supabase/functions/create-checkout-session/index.ts', 'utf8');
const membresia = readFileSync('supabase/functions/create-membership-subscription/index.ts', 'utf8');

for (const [nombre, fuente] of [['create-checkout-session', checkout], ['create-membership-subscription', membresia]]) {
  assert.match(
    fuente,
    /^\s*if \(customerId && !\(await clienteStripeVigente\(stripe, customerId\)\)\) \{/m,
    `${nombre} debe comprobar el cliente guardado antes de reutilizarlo`,
  );
  assert.doesNotMatch(
    fuente,
    /^\s*customer = await stripe\.customers\.retrieve\(/m,
    `${nombre} no debe recuperar el cliente guardado sin clienteStripeVigente`,
  );
  casos++;
}

// Si habia fila, es la del cliente muerto: un insert chocaria con UNIQUE(user_id)
// y el siguiente intento volveria a leer el cliente viejo.
assert.match(
  checkout,
  /\.from\("stripe_customers"\)\s*\.upsert\(\{[\s\S]*?\}, \{ onConflict: "user_id" \}\)/,
  'create-checkout-session debe reemplazar la fila de stripe_customers, no insertar otra',
);
casos++;

console.log(`clienteStripeVigente: ${casos} casos OK`);
