#!/usr/bin/env node
/**
 * Registro de logins: OAuth y fallidos.
 *
 * Dos defectos del 25-sep-2026 (bitacora, entrada 32):
 *   1. Los logins con Google nunca llegaban a `user_sessions`: el SIGNED_IN
 *      salia por la guarda de «mismo usuario» antes de registrar.
 *   2. `failed_login_attempts` sin filas desde el 16-jul-2026: record-session-
 *      event exigia JWT (gateway y codigo) a un evento que por definicion no
 *      tiene sesion. `check-login-risk` lee esa tabla para frenar fuerza bruta.
 *
 * USO
 *
 *   node scripts/test-registro-de-login.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const js = ts.transpileModule(readFileSync('src/utils/registroDeLogin.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const contexto = { exports: {}, atob };
vm.runInNewContext(js, contexto);
const { sessionIdDeToken, metodoDeLogin, vieneDeOAuth, debeRegistrarLogin, proveedorDelRetorno } = contexto.exports;

// ── Helpers ────────────────────────────────────────────────────────────────
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload) => `${b64url({ alg: 'ES256' })}.${b64url(payload)}.firma`;

assert.equal(sessionIdDeToken(jwt({ session_id: 'abc-123', sub: 'u' })), 'abc-123', 'lee session_id');
assert.equal(sessionIdDeToken(jwt({ sub: 'u' })), null, 'sin claim: null');
assert.equal(sessionIdDeToken('basura'), null, 'token roto: null');
assert.equal(sessionIdDeToken(undefined), null, 'sin token: null');

// El metodo sale del amr del token y de la ruta de regreso, NO de
// app_metadata.provider: el 25-sep-2026 una cuenta nacida con correo entro con
// Google y quedo como 'email_password'.
const conAmr = (...metodos) => jwt({ session_id: 's', amr: metodos.map(([method, timestamp]) => ({ method, timestamp })) });
assert.equal(metodoDeLogin(conAmr(['oauth', 100]), 'google'), 'google', 'OAuth por Google');
assert.equal(metodoDeLogin(conAmr(['oauth', 100]), null), 'oauth', 'OAuth sin saber el proveedor');
assert.equal(metodoDeLogin(conAmr(['password', 100]), 'google'), 'email_password',
  'contrasena, aunque la URL diga google: manda el token');
assert.equal(metodoDeLogin(conAmr(['oauth', 100], ['totp', 200]), 'azure'), 'azure', 'el factor de MFA no cuenta');
assert.equal(metodoDeLogin(conAmr(['otp', 100]), null), 'otp', 'otros metodos, tal cual');
assert.equal(metodoDeLogin('basura', 'google'), 'email_password', 'token roto: por defecto');

assert.equal(proveedorDelRetorno('https://x.app/auth/google-callback?code=1'), 'google');
assert.equal(proveedorDelRetorno('https://x.app/auth/linkedin-callback?code=1'), 'linkedin_oidc');
assert.equal(proveedorDelRetorno('https://x.app/auth/x-callback?code=1'), 'x');
assert.equal(proveedorDelRetorno('https://x.app/tours/google-callback-tour'), null, 'fuera de /auth/ no cuenta');

assert.equal(vieneDeOAuth('https://toursredmx.netlify.app/?code=xyz'), true, 'PKCE');
assert.equal(vieneDeOAuth('https://toursredmx.netlify.app/#access_token=xyz&type=bearer'), true, 'implicito');
assert.equal(vieneDeOAuth('https://toursredmx.netlify.app/tours/teotihuacan'), false, 'recarga normal');
assert.equal(vieneDeOAuth('https://toursredmx.netlify.app/?promo_code=X'), false, 'un parametro que solo termina en code no cuenta');

assert.equal(debeRegistrarLogin('s1', null), true, 'sesion nueva');
assert.equal(debeRegistrarLogin('s1', 's1'), false, 'ya registrada: SIGNED_IN repetido, otra pestana');
assert.equal(debeRegistrarLogin('s2', 's1'), true, 'otra sesion');
assert.equal(debeRegistrarLogin(null, null), false, 'sin session_id no se registra a ciegas');

// ── El servidor decide el metodo con el amr del token ──────────────────────
// El 25-sep-2026 cuatro logins con Google llegaron como 'email_password' desde
// el front aunque mfa_amr_claims decia 'oauth'. La decision paso al servidor.
const jsServidor = ts.transpileModule(readFileSync('supabase/functions/_shared/metodoDeSesion.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const ctxServidor = { exports: {}, atob, Set };
vm.runInNewContext(jsServidor, ctxServidor);
const { metodoDeLaSesion, metodosDelToken } = ctxServidor.exports;

// Token con la forma de GoTrue, con acentos en user_metadata (UTF-8 en base64url).
const tokenGoTrue = (amr) => 'Bearer ' + [
  b64url({ alg: 'ES256', kid: 'k' }),
  Buffer.from(JSON.stringify({
    sub: 'c67943e8', session_id: 'e440ce6b', aal: 'aal1', amr,
    user_metadata: { full_name: 'Alan Axel Álvarez Hernández' },
    app_metadata: { provider: 'email', providers: ['email', 'google'] },
  }), 'utf8').toString('base64url'),
  'firma',
].join('.');

assert.deepEqual([...metodosDelToken(tokenGoTrue([{ method: 'oauth', timestamp: 1 }]))], ['oauth'],
  'lee el amr de un token real con acentos');
assert.equal(metodoDeLaSesion(tokenGoTrue([{ method: 'oauth', timestamp: 1 }]), 'google', 'email_password'), 'google',
  'el caso del 25-sep: el cliente dice email_password, el token oauth, el proveedor google -> google');
assert.equal(metodoDeLaSesion(tokenGoTrue([{ method: 'oauth', timestamp: 1 }]), 'hackeo', 'x'), 'oauth',
  'un proveedor desconocido del cliente no se guarda');
assert.equal(metodoDeLaSesion(tokenGoTrue([{ method: 'password', timestamp: 1 }]), 'google', 'google'), 'email_password',
  'contrasena manda sobre lo que diga el cliente');
assert.equal(metodoDeLaSesion(tokenGoTrue([{ method: 'oauth', timestamp: 1 }, { method: 'totp', timestamp: 2 }]), 'azure', null), 'azure',
  'el factor de MFA no cuenta');
assert.equal(metodoDeLaSesion('Bearer basura', null, 'email_password'), 'email_password', 'sin amr: lo del cliente');
assert.equal(metodoDeLaSesion(null, null, undefined), 'email_password', 'sin nada: por defecto');
// Y el front, con el mismo token, tambien lo lee (si falla en el navegador, el servidor corrige).
assert.equal(metodoDeLogin(tokenGoTrue([{ method: 'oauth', timestamp: 1 }]).replace('Bearer ', ''), 'google'), 'google',
  'el helper del front con un token real con acentos');

// ── El front registra antes de la guarda ───────────────────────────────────
const sin = (f) => readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const auth = sin('src/context/AuthContext.tsx');
const bloque = auth.slice(auth.indexOf("if (event === 'SIGNED_IN')"), auth.indexOf("} else if (event === 'TOKEN_REFRESHED')"));
const iRegistro = bloque.indexOf('registrarLoginUnaVez(session)');
const iGuarda = bloque.indexOf('incomingUserId === initializedUserIdRef.current');
assert.ok(iRegistro > -1, 'SIGNED_IN tiene que registrar el login');
assert.ok(iRegistro < iGuarda, 'el registro va ANTES de la guarda de mismo usuario: si no, Google nunca se registra');
assert.match(auth, /session && VIENE_DE_OAUTH[\s\S]{0,40}registrarLoginUnaVez\(session\)/,
  'initializeAuth registra el retorno de OAuth');
assert.doesNotMatch(auth, /login_method:\s*'email_password'/, 'login_method ya no va fijo');

// ── La funcion acepta failed_login sin sesion, sin creerle el user_id ──────
const fn = sin('supabase/functions/record-session-event/index.ts');
assert.match(fn, /if \(!authHeader && !esIntentoFallido\)/, 'failed_login no exige Authorization');
assert.match(fn, /const failedUserId = isServiceRole \? \(body\.user_id \?\? null\) : null;/,
  'sin sesion, el user_id del cuerpo no se cree');
assert.match(fn, /error: failedInsertError/, 'el insert de failed_login revisa su error');
assert.match(fn, /onConflict: "session_id", ignoreDuplicates: true/,
  'el login es idempotente por session_id: dos pestanas no pueden duplicar la fila');
assert.match(fn, /metodoDeLaSesion\(authHeader, body\.oauth_provider, login_method\)/,
  'el servidor decide el metodo con el token, no con lo que diga el cliente');
// Dentro del upsert de user_sessions, no solo en el metadata de la bitacora:
// una primera version de esta asercion miraba el archivo entero y dejo
// sobrevivir una mutacion que quitaba el valor del upsert.
const upsertSesion = fn.slice(fn.indexOf('from("user_sessions").upsert('), fn.indexOf('onConflict: "session_id"'));
assert.match(upsertSesion, /login_method: metodoFinal,/, 'user_sessions guarda lo que decidio el servidor');
assert.match(fn, /duplicado: true/, 'una sesion ya registrada no escribe un segundo LOGIN en la bitacora');
const indice = readFileSync('supabase/migrations/20260926060000_user_sessions_una_fila_por_sesion.sql', 'utf8');
assert.match(indice, /CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_session_id_key\s+ON public\.user_sessions \(session_id\)/,
  'sin el indice unico, el ON CONFLICT no tiene contra que chocar');

// ── Y el gateway no lo rechaza ─────────────────────────────────────────────
const toml = readFileSync('supabase/config.toml', 'utf8');
assert.match(toml, /\[functions\."record-session-event"\]\s*\nverify_jwt = false/,
  'record-session-event tiene que estar declarada con verify_jwt = false: sin declarar, el CLI la despliega en true');

console.log('Registro de login: 30 casos de helpers y 13 comprobaciones de uso.');
