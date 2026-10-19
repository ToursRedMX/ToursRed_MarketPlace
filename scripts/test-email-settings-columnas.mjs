#!/usr/bin/env node
/**
 * Que ninguna Edge Function pida a `email_settings` una columna que no existe.
 *
 * POR QUE EXISTE (13-oct-2026): notify-ops-refund-failed, send-payment-plan-reminder y
 * _shared/avisosDePago.ts pedian `platform_url` (y `sender_email`) a email_settings. Esas
 * columnas no existen (platform_url vive en platform_settings; el remitente es contact_email),
 * asi que PostgREST devolvia 42703, `data` quedaba en null y, como nadie miraba el `error`,
 * parecia "SMTP no configurado": el aviso de reembolso fallido nunca salia.
 *
 * QUE VIGILA
 * 1. Todo `.from("email_settings").select("...")` en supabase/functions pide solo columnas reales.
 * 2. notify-ops-refund-failed, send-payment-plan-reminder y alertarOps leen el `error` de esa consulta
 *    y NO registran la llave SMTP.
 *
 * LO QUE NO PUEDE HACER: no conoce la base. Si se agrega una columna a email_settings hay que
 * sumarla a COLUMNAS_REALES (lista verificada contra information_schema el 13-oct-2026; sin smtp_host/port/user/password desde su retiro, 19-oct-2026; con email_provider/_fallback_* desde la migracion 20261019214718).
 * Un `.select()` armado dinamicamente (no literal) no se analiza.
 *
 * whatsapp-webhook-entrante queda fuera SOLO hasta que se mergee ToursRed_MarketPlace#379, que lo
 * corrige; despues de eso, quitar la excepcion.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const COLUMNAS_REALES = new Set([
  'id', 'contact_email',
  'updated_at', 'updated_by', 'smtp_api_key', 'internal_service_key', '*',
  'email_provider', 'email_fallback_provider', 'email_fallback_enabled',
]);
const EXCEPCIONES = new Set(['whatsapp-webhook-entrante']);
const RAIZ = 'supabase/functions';

function archivos(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const RE = /from\(\s*["'`]email_settings["'`]\s*\)\s*\.select\(\s*(["'`])([\s\S]*?)\1/g;
let consultas = 0;
for (const f of archivos(RAIZ)) {
  if (EXCEPCIONES.has(f.split(path.sep)[2])) continue;
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(RE)) {
    consultas++;
    for (const col of m[2].split(',').map((c) => c.trim()).filter(Boolean)) {
      assert.ok(COLUMNAS_REALES.has(col), `${f}: email_settings no tiene la columna "${col}" (platform_url vive en platform_settings)`);
    }
  }
}
assert.ok(consultas >= 3, `se esperaban >= 3 consultas a email_settings y se vieron ${consultas}: ¿el patron dejo de coincidir?`);

for (const [f, etiqueta] of [
  ['supabase/functions/notify-ops-refund-failed/index.ts', 'emailSettingsError'],
  ['supabase/functions/send-payment-plan-reminder/index.ts', 'emailSettingsError'],
]) {
  const src = readFileSync(f, 'utf8');
  assert.match(src, new RegExp(`error:\\s*${etiqueta}`), `${f}: debe capturar el error de email_settings`);
  assert.match(src, new RegExp(`if\\s*\\(\\s*${etiqueta}\\s*\\)`), `${f}: debe actuar sobre el error de email_settings`);
  assert.doesNotMatch(src, /console\.\w+\([^)]*\.smtp_api_key/, `${f}: la llave SMTP no se registra`);
}
const mod = readFileSync('supabase/functions/_shared/correo/enviarCorreo.ts', 'utf8');
assert.match(mod, /const \{ data, error \} = await admin\s*\.from\("email_settings"\)/, 'enviarCorreo captura el error de email_settings');
assert.match(mod, /if \(error\)/, 'enviarCorreo actua sobre el error de email_settings');
assert.doesNotMatch(mod, /console\.\w+\([^)]*smtp_api_key/, 'enviarCorreo no registra la llave');
const ops = readFileSync('supabase/functions/notify-ops-refund-failed/index.ts', 'utf8');
assert.match(ops, /from\("platform_settings"\)\.select\("platform_url"\)/, 'platform_url se lee de platform_settings');

console.log(`OK: ${consultas} consultas a email_settings sin columnas inexistentes; el error se revisa y la llave no se registra.`);
