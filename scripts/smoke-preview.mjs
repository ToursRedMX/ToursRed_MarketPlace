#!/usr/bin/env node
/**
 * Smoke test post-deploy (pieza H).
 *
 * El check `netlify/toursredmx/deploy-preview` solo verifica que el build
 * COMPILE. Los previews de los PR #20 y #21 estuvieron en verde mientras la app
 * moria al inicializar con `Uncaught Error: supabaseKey is required`, porque
 * VITE_SUPABASE_PUBLISHABLE_KEY no llegaba a los previews.
 *
 * Esto abre la pagina de verdad y falla si la app no arranca.
 *
 * Uso:  node scripts/smoke-preview.mjs <url-base>
 *       SMOKE_ROUTES="/,/tours" node scripts/smoke-preview.mjs https://...
 */

import { chromium } from 'playwright';

const BASE = (process.argv[2] || process.env.SMOKE_URL || '').replace(/\/$/, '');
if (!BASE) {
  console.error('ERROR: falta la URL base. Uso: node scripts/smoke-preview.mjs <url>');
  process.exit(2);
}

// ---------- la URL tiene que ser la app, no cualquier pagina ----------
// Netlify reporta el commit status como `success` incluso cuando el deploy se
// CANCELA, y en ese caso su target_url apunta al panel de administracion
// (app.netlify.com/projects/<sitio>/deploys/<id>) en vez de al preview.
//
// Cargar esa pagina producia un rojo enganoso: el panel es una app React con
// su propio #root (243 nodos, por encima de MIN_NODES) y sus propios errores
// de consola de reCAPTCHA, que no estan en THIRD_PARTY. El script terminaba
// reportando "la app NO arranca" sin haber abierto nunca la app. Paso en el
// PR #116, donde el commit solo tocaba un .sql y Netlify salto el build.
//
// Ante una URL que no es un destino de despliegue se sale con codigo 2
// (error de invocacion, igual que la URL faltante), no con 1: 1 significa
// "la app esta rota" y aqui no se llego a probar nada.
const ALLOWED_HOSTS = (process.env.SMOKE_ALLOWED_HOSTS || 'netlify.app,toursred.com')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

let baseUrl;
try {
  baseUrl = new URL(BASE);
} catch {
  console.error(`ERROR: la URL base no es una URL valida: ${BASE}`);
  process.exit(2);
}

if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
  console.error(`ERROR: la URL base debe ser http(s), se recibio: ${baseUrl.protocol}//`);
  process.exit(2);
}

const HOST = baseUrl.hostname.toLowerCase();

if (HOST === 'app.netlify.com') {
  console.error(`ERROR: la URL apunta al panel de Netlify, no a la app: ${BASE}`);
  console.error('');
  console.error('Netlify devuelve esta URL cuando el deploy fue CANCELADO (por ejemplo');
  console.error('si el commit no toco archivos de frontend), aunque el commit status');
  console.error('siga marcado como success. No hay preview que probar.');
  console.error('');
  console.error('Esto NO significa que la app este rota: significa que no se construyo');
  console.error('un preview para este commit.');
  process.exit(2);
}

if (!ALLOWED_HOSTS.some((h) => HOST === h || HOST.endsWith(`.${h}`))) {
  console.error(`ERROR: el host "${HOST}" no es un destino de despliegue conocido.`);
  console.error(`Permitidos: ${ALLOWED_HOSTS.join(', ')} (y sus subdominios).`);
  console.error('Ajustable con SMOKE_ALLOWED_HOSTS si se agrega un dominio nuevo.');
  process.exit(2);
}

const ROUTES = (process.env.SMOKE_ROUTES || '/,/tours').split(',').map((r) => r.trim()).filter(Boolean);

// Medido sobre produccion el 28-ago: "/" rinde 708 nodos y "/tours" 406.
// El umbral solo tiene que distinguir "monto" de "pantalla en blanco".
const MIN_NODES = Number(process.env.SMOKE_MIN_NODES || 50);
const NAV_TIMEOUT = Number(process.env.SMOKE_TIMEOUT_MS || 45000);
// Margen tras el load para que arranquen los fetch de datos y afloren errores.
const SETTLE_MS = Number(process.env.SMOKE_SETTLE_MS || 4000);

// Errores de terceros: se reportan como aviso pero NO tumban el build. El
// allowlist de hostnames de Turnstile cambia con cada preview, y un fallo de
// GA o Sentry no significa que la app este rota.
const THIRD_PARTY = [
  'challenges.cloudflare.com',
  'google-analytics.com',
  'googletagmanager.com',
  'ingest.us.sentry.io',
  'ingest.sentry.io',
  // Netlify inyecta su propio widget de feedback en los deploy previews.
  // No es parte de la app y solo existe en previews, no en produccion.
  'app.netlify.com',
];
const isThirdParty = (text = '') => THIRD_PARTY.some((h) => text.includes(h));

// Un preload de media abortado es comportamiento normal del navegador, no un
// fallo de la app. Se acota a extensiones de media para no relajar el chequeo
// en peticiones de JS o de API, donde un ERR_ABORTED si importa.
const isAbortedMedia = (url = '', err = '') =>
  err.includes('ERR_ABORTED') && /\.(mp4|webm|ogg|mp3|wav|mov)(\?|$)/i.test(url);

const results = [];

const browser = await chromium.launch();

for (const route of ROUTES) {
  const url = `${BASE}${route}`;
  const errors = [];   // rompen el build
  const warnings = []; // solo se reportan

  const context = await browser.newContext({ ignoreHTTPSErrors: false });
  const page = await context.newPage();

  // Excepciones no capturadas: aqui cae `Uncaught Error: supabaseKey is required`
  page.on('pageerror', (err) => {
    const msg = `[pageerror] ${err.message}`;
    (isThirdParty(err.stack || '') ? warnings : errors).push(msg);
  });

  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = m.location?.().url || '';
    const msg = `[console.error] ${m.text()}${loc ? `  (${loc})` : ''}`;
    (isThirdParty(loc) || isThirdParty(m.text()) ? warnings : errors).push(msg);
  });

  page.on('requestfailed', (req) => {
    const u = req.url();
    if (/favicon|\.map$/.test(u)) return;
    const errText = req.failure()?.errorText || 'error';
    const msg = `[requestfailed] ${errText} ${u}`;
    (isThirdParty(u) || isAbortedMedia(u, errText) ? warnings : errors).push(msg);
  });

  let status = null;
  let dom = { nodes: 0, text: 0, title: '' };

  try {
    const resp = await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT });
    status = resp?.status() ?? null;
    await page.waitForTimeout(SETTLE_MS);

    dom = await page.evaluate(() => {
      const r = document.getElementById('root');
      return {
        nodes: r ? r.querySelectorAll('*').length : 0,
        text: r ? r.innerText.trim().length : 0,
        title: document.title,
      };
    });

    if (status === null || status >= 400) errors.push(`[http] status ${status}`);

    // La comprobacion que de verdad importa: la app monto algo.
    // Ojo: el catch-all del SPA devuelve 200 con index.html para cualquier
    // ruta, asi que el status por si solo no prueba nada.
    if (dom.nodes < MIN_NODES) {
      errors.push(`[render] #root tiene ${dom.nodes} nodos (minimo ${MIN_NODES}). La app no monto.`);
    }
  } catch (e) {
    errors.push(`[navegacion] ${e.message}`);
  }

  await context.close();
  results.push({ route, url, status, dom, errors, warnings });
}

await browser.close();

// ---------- reporte ----------
let failed = 0;
console.log(`\nSmoke test post-deploy — ${BASE}\n${'='.repeat(60)}`);

for (const r of results) {
  const ok = r.errors.length === 0;
  if (!ok) failed++;
  console.log(`\n${ok ? 'OK  ' : 'FALLA'}  ${r.route}`);
  console.log(`        http ${r.status ?? '-'} | nodos ${r.dom.nodes} | texto ${r.dom.text} | "${r.dom.title}"`);
  for (const w of r.warnings) console.log(`        aviso (tercero): ${w}`);
  for (const e of r.errors) console.log(`        ERROR: ${e}`);
}

console.log(`\n${'='.repeat(60)}`);

if (failed) {
  console.log(`${failed} de ${results.length} rutas fallaron.\n`);
  console.log('El preview compilo, pero la app NO arranca correctamente.');
  process.exit(1);
}

console.log(`${results.length} rutas OK: la app arranca y renderiza.\n`);
