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
];
const isThirdParty = (text = '') => THIRD_PARTY.some((h) => text.includes(h));

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
    const msg = `[requestfailed] ${req.failure()?.errorText || 'error'} ${u}`;
    (isThirdParty(u) ? warnings : errors).push(msg);
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
