#!/usr/bin/env node
/**
 * Guardia de autorizacion en Edge Functions.
 *
 * Es el tercer punto de las recomendaciones estructurales de la auditoria del
 * 05-sep-2026, el unico que quedaba sin hacer. El documento lo describe asi:
 *
 *   "Ese tercer punto es el que convierte esta auditoria en algo que no hay
 *    que repetir en seis meses. Los puntos 1 y 2 bajan el costo de ponerse el
 *    guard; solo el 3 impide que la funcion 172 nazca sin el."
 *
 * QUE VIGILA
 *
 * Que toda Edge Function tome ALGUNA decision de autorizacion, o este en la
 * linea base con un motivo escrito. Una funcion nueva sin guard y sin entrada
 * en la linea base rompe el build.
 *
 * QUE **NO** VIGILA -- y esto importa
 *
 * Que el guard sea CORRECTO. Detecta que la funcion mira quien llama, no que
 * decida bien. Un `auth.getUser()` cuyo resultado se ignora cuenta como guard
 * aqui. Es un piso, no un techo: sirve para que nadie nazca sin nada, no para
 * sustituir la revision de un camino de dinero.
 *
 * POR QUE LA LINEA BASE LLEVA MOTIVO Y NO ES UNA LISTA PELADA
 *
 * Hay funciones que son publicas a proposito: recuperar contrasena, darse de
 * alta al boletin, el formulario de contacto. Y hay otras que hoy no tienen
 * guard y **deberian tenerlo**. Una lista pelada las mezcla y las vuelve
 * invisibles a las dos. Por eso cada entrada declara `motivo`:
 *
 *   "publica"    -- publica por diseno; no lleva guard y esta bien
 *   "pendiente"  -- hueco real, aun sin arreglar; se reporta en voz alta
 *
 * Las "pendiente" se imprimen en cada corrida para que no se vuelvan paisaje.
 *
 * USO
 *
 *   node scripts/check-edge-guards.mjs
 *
 * Sale con 1 si aparece una funcion sin guard que no este en la linea base.
 * Una funcion de la linea base que YA gano su guard sale como aviso, no como
 * fallo: bloquear un PR ajeno por eso cuesta mas de lo que aporta. El aviso
 * dice exactamente que linea borrar.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const RAIZ = "supabase/functions";
const LINEA_BASE = "scripts/edge-guards-linea-base.json";

/**
 * Un "guard" es cualquiera de estos. La lista sale de leer las 171 funciones,
 * no de imaginar como deberian estar escritas: en este repo conviven los
 * helpers de `_shared/auth.ts` con comparaciones a mano que son igual de
 * validas (`notify-ops-refund-failed`, `process-payment-refund` y
 * `process-payment-plan-tour-deadline` comparan el bearer contra
 * SUPABASE_SERVICE_ROLE_KEY sin usar el helper, y estan bien).
 */
const SENALES = [
  // Los helpers compartidos, que es a donde deberia tender todo.
  { nombre: "helper de _shared/auth.ts", re: /\brequire(ServiceRole|User|Admin|OwnerOrAdmin)\s*\(/ },
  { nombre: "helper de cfdiAuth.ts", re: /from\s+["']\.\.\/_shared\/cfdiAuth\.ts["']/ },

  // Identificar al usuario que llama.
  { nombre: "auth.getUser()", re: /auth\s*\.\s*getUser\s*\(/ },

  // Comparacion del bearer a mano. En este repo conviven con los helpers y son
  // igual de validas: notify-ops-refund-failed, process-payment-refund,
  // process-payment-plan-tour-deadline (contra SUPABASE_SERVICE_ROLE_KEY) y
  // facturapi-webhook (contra FACTURAPI_WEBHOOK_TOKEN) lo hacen asi.
  { nombre: "compara Authorization y rechaza", re: /headers\s*\.\s*get\(\s*["']Authorization["']\s*\)[\s\S]{0,800}?\b(401|403)\b/ },

  // Firma criptografica del proveedor: stripe-webhook (constructEventAsync),
  // conekta-webhook (verifyConektaSignature), paypal-webhook (PAYPAL_WEBHOOK_ID).
  { nombre: "firma de webhook", re: /constructEventAsync|verify\w*Signature\s*\(|PAYPAL_WEBHOOK_ID/ },

  // openpay-webhook no puede verificar firma: el panel de OpenPay no la ofrece
  // (esa fue la decision de M-3). Su defensa es re-consultar el cargo contra la
  // API antes de creerle al cuerpo, y eso cuenta como decision de autorizacion.
  { nombre: "re-consulta del cargo (M-3)", re: /getChargeMerchant\s*\(|getCharge\s*\(/ },

  // Un formulario publico no puede pedir sesion; su control es el captcha.
  { nombre: "captcha Turnstile", re: /TURNSTILE_SECRET_KEY/ },

  // Un stub que no hace nada no necesita guard.
  { nombre: "stub deprecado", re: /deprecated:\s*true/ },
];

function funciones() {
  return readdirSync(RAIZ)
    .filter((n) => !n.startsWith("_"))
    .filter((n) => statSync(join(RAIZ, n)).isDirectory())
    .filter((n) => existsSync(join(RAIZ, n, "index.ts")))
    .sort();
}

function guardDe(nombre) {
  const src = readFileSync(join(RAIZ, nombre, "index.ts"), "utf8");
  return SENALES.find((s) => s.re.test(src)) ?? null;
}

const base = JSON.parse(readFileSync(LINEA_BASE, "utf8"));
const enBase = new Map(base.funciones.map((f) => [f.nombre, f]));

const nuevasSinGuard = [];
const yaNoHacenFalta = [];
const pendientes = [];
let conGuard = 0;

for (const nombre of funciones()) {
  const guard = guardDe(nombre);
  const entrada = enBase.get(nombre);

  if (guard) {
    conGuard++;
    if (entrada) yaNoHacenFalta.push({ nombre, guard: guard.nombre, motivo: entrada.motivo });
    continue;
  }

  if (!entrada) {
    nuevasSinGuard.push(nombre);
    continue;
  }

  if (entrada.motivo === "pendiente") pendientes.push(entrada);
}

const total = funciones().length;
console.log(`Guardia de autorizacion: ${total} Edge Functions`);
console.log(`  con alguna decision de autorizacion .... ${conGuard}`);
console.log(`  en la linea base ...................... ${total - conGuard}`);
console.log(`    de esas, publicas por diseno ........ ${total - conGuard - pendientes.length}`);
console.log(`    de esas, huecos aun sin arreglar .... ${pendientes.length}`);

if (pendientes.length) {
  console.log(`\nHuecos declarados en la linea base (no rompen el build, pero siguen abiertos):`);
  for (const p of pendientes) console.log(`  - ${p.nombre}: ${p.nota}`);
}

if (yaNoHacenFalta.length) {
  console.log(`\nAviso: estas ya tienen guard y sobran en ${LINEA_BASE}:`);
  for (const y of yaNoHacenFalta) console.log(`  - ${y.nombre}  (detectado: ${y.guard})`);
  console.log(`  Borra su entrada para que la linea base no se pudra.`);
}

if (nuevasSinGuard.length) {
  console.error(`\n${nuevasSinGuard.length} Edge Function(s) sin ninguna decision de autorizacion y sin entrada en la linea base:\n`);
  for (const n of nuevasSinGuard) console.error(`  - ${n}`);
  console.error(`\nPon un guard de supabase/functions/_shared/auth.ts:`);
  console.error(`  requireServiceRole(req, {...})  requireUser(req, {...})`);
  console.error(`  requireAdmin(req, {...})        requireOwnerOrAdmin(req, {...})`);
  console.error(`\nSi la funcion es publica a proposito, agregala a ${LINEA_BASE}`);
  console.error(`con motivo "publica" y una nota que explique por que.`);
  process.exit(1);
}

console.log(`\nOK: ninguna funcion nueva sin guard.`);
