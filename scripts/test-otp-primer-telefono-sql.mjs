/**
 * issue_phone_challenge no debe exigir inicio de sesion reciente para poner el PRIMER
 * telefono de una cuenta, solo para CAMBIAR uno que ya existe.
 *
 * ============================================================================
 * EL DEFECTO
 * ============================================================================
 *
 * La funcion decidia la reautenticacion con
 *
 *     normalizar_telefono(u.phone_number) IS DISTINCT FROM p_phone
 *
 * Con un perfil sin telefono (NULL) eso es verdadero para cualquier numero, asi que
 * quien llevaba mas de 10 minutos en el formulario de registro social recibia
 * PHONE_REAUTH_REQUIRED ("para cambiar el telefono, cierra sesion...") sin haber tenido
 * nunca un telefono que cambiar. La migracion 20261009160000 agrega
 * `u.phone_number is not null`.
 *
 * ============================================================================
 * COMO SE PRUEBA, Y POR QUE NO CON UN ESQUEMA INVENTADO
 * ============================================================================
 *
 * Igual que test-tax-snapshot-sql.mjs: no se reconstruye la base, se RECORTAN de los
 * archivos de migracion las piezas reales (normalizar_telefono, consume_sms_rate_limit,
 * recent_phone_auth, las tablas de verificaciones y la version ANTERIOR de
 * issue_phone_challenge) y se corren sobre un esquema minimo. La version NUEVA es el
 * archivo de la migracion ejecutado tal cual. Lo unico inventado son cuatro tablas de
 * apoyo (auth.users, public.users, platform_settings, sensitive_verifications), y solo
 * con las columnas que la funcion lee.
 *
 * Primero se corre la version vieja y se AFIRMA que reproduce el error: una prueba que no
 * se ve fallar no prueba nada.
 *
 *   node scripts/test-otp-primer-telefono-sql.mjs
 *
 * Variables: PGHOST, PGPORT, PGUSER, PGPASSWORD y PGDATABASE (las estandar de libpq).
 * PGDATABASE DEBE llamarse `otp_primer_telefono...`: el script borra y recrea esquemas.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';

const base = process.env.PGDATABASE ?? '';
assert.match(base, /^otp_primer_telefono/, 'PGDATABASE debe empezar con otp_primer_telefono (el script borra esquemas)');

function psql(sql) {
  return execFileSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }).trim();
}

const leer = (archivo) => readFileSync(new URL(`../supabase/migrations/${archivo}`, import.meta.url), 'utf8');
const fundacion = leer('20261008045859_sms_otp_foundation.sql');
const enforcement = leer('20261008054539_phone_otp_enforcement.sql');
const arreglo = leer('20261009160000_phone_otp_primer_telefono_sin_reautenticacion.sql');

/** Recorta de `texto` desde `inicio` hasta la primera aparicion de `fin` (inclusive). */
function recortar(texto, inicio, fin, nombre) {
  const i = texto.indexOf(inicio);
  assert.ok(i >= 0, `no se encontro ${nombre} en la migracion`);
  const j = texto.indexOf(fin, i);
  assert.ok(j >= 0, `no se encontro el final de ${nombre}`);
  return texto.slice(i, j + fin.length);
}

const piezas = [
  recortar(fundacion, 'create function public.normalizar_telefono', '\nend $$;', 'normalizar_telefono'),
  recortar(fundacion, 'create function public.consume_sms_rate_limit', '\nend $$;', 'consume_sms_rate_limit'),
  recortar(fundacion, 'create table messaging_private.phone_verifications (', '\n);', 'phone_verifications'),
  recortar(fundacion, 'create table messaging_private.rate_limit_buckets (', '\n);', 'rate_limit_buckets'),
  recortar(enforcement, 'create table messaging_private.phone_events (', '\n);', 'phone_events'),
  recortar(enforcement, 'create function messaging_private.recent_phone_auth', '\n$$;', 'recent_phone_auth'),
];
const versionVieja = recortar(enforcement, 'create function public.issue_phone_challenge', '\nend $$;', 'issue_phone_challenge (vieja)');

// ---- Esquema minimo: solo lo que la funcion lee ----------------------------------------
psql(`
  drop schema if exists messaging_private cascade;
  drop schema if exists auth cascade;
  drop table if exists public.sensitive_verifications, public.platform_settings, public.users cascade;
  drop function if exists public.normalizar_telefono(text), public.consume_sms_rate_limit(text,text,timestamptz,timestamptz,integer,integer), public.issue_phone_challenge(uuid,uuid,text,text,text,text,text,boolean);
  create schema auth;
  create table auth.users (id uuid primary key, last_sign_in_at timestamptz);
  create schema messaging_private;
  create table public.users (
    id uuid primary key, is_active boolean not null default true, email_verified boolean not null default false,
    phone_number text, phone_verified_at timestamptz, phone_verified_e164 text);
  create table public.platform_settings (
    sms_habilitado boolean not null, sms_modo_prueba boolean not null,
    sms_otp_limite_usuario_diario smallint not null, sms_otp_limite_telefono_diario smallint not null, sms_otp_limite_ip_hora smallint not null);
  insert into public.platform_settings values (true, false, 5, 5, 20);
  create table public.sensitive_verifications (user_id uuid, expires_at timestamptz);
  create table messaging_private.provider_capabilities (provider text primary key);
  insert into messaging_private.provider_capabilities values ('labsmobile'),('twilio'),('mock');
  ${piezas.join('\n')}
`);

// ---- Auxiliares de escenario ------------------------------------------------------------
const hex = () => randomBytes(32).toString('hex');
let consecutivo = Math.floor(Math.random() * 800000);

/** Crea un usuario. `phone` null = perfil sin telefono. `ultimoLogin` en SQL: p. ej. "now() - interval '1 hour'". */
function usuario({ phone = null, ultimoLogin = "now() - interval '1 hour'", emailVerificado = true } = {}) {
  const id = randomUUID();
  psql(`
    insert into auth.users(id, last_sign_in_at) values ('${id}', ${ultimoLogin});
    insert into public.users(id, email_verified, phone_number) values ('${id}', ${emailVerificado}, ${phone === null ? 'null' : `'${phone}'`});`);
  return id;
}
const telefonoNuevo = () => `+52558${String(++consecutivo).padStart(7, '0')}`;

function pedirCodigo(id, telefono) {
  const out = psql(`select public.issue_phone_challenge('${id}','${randomUUID()}','${telefono}','${hex()}','${hex()}','${hex()}','${hex()}',false)`);
  return JSON.parse(out);
}
const telefonoGuardado = (id) => psql(`select coalesce(phone_number,'<null>') from public.users where id='${id}'`);

let pasados = 0;
const prueba = (nombre, fn) => { fn(); console.log(`ok ${++pasados} - ${nombre}`); };

// ---- 1. La version VIEJA reproduce el defecto (si no, esta prueba no prueba nada) --------
psql(versionVieja);
prueba('VIEJA: un perfil SIN telefono y sesion de hace 1 h recibe PHONE_REAUTH_REQUIRED (el defecto)', () => {
  const r = pedirCodigo(usuario(), telefonoNuevo());
  assert.equal(r.ok, false);
  assert.equal(r.code, 'PHONE_REAUTH_REQUIRED');
});

// ---- 2. Se aplica la migracion tal cual y se prueba la version NUEVA ---------------------
psql(arreglo);

prueba('NUEVA: el primer telefono no exige sesion reciente (el caso del registro social)', () => {
  const id = usuario();
  const tel = telefonoNuevo();
  const r = pedirCodigo(id, tel);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(telefonoGuardado(id), tel, 'la funcion sigue guardando el telefono pedido');
});

prueba('NUEVA: con sesion reciente tambien funciona (sin regresion)', () => {
  const r = pedirCodigo(usuario({ ultimoLogin: 'now()' }), telefonoNuevo());
  assert.equal(r.ok, true, JSON.stringify(r));
});

prueba('NUEVA: CAMBIAR un telefono existente sigue exigiendo sesion reciente', () => {
  const id = usuario({ phone: telefonoNuevo() });
  const r = pedirCodigo(id, telefonoNuevo());
  assert.equal(r.ok, false);
  assert.equal(r.code, 'PHONE_REAUTH_REQUIRED');
});

prueba('NUEVA: cambiar un telefono existente con sesion reciente funciona', () => {
  const id = usuario({ phone: telefonoNuevo(), ultimoLogin: 'now()' });
  assert.equal(pedirCodigo(id, telefonoNuevo()).ok, true);
});

prueba('NUEVA: una verificacion sensible vigente tambien permite el cambio', () => {
  const id = usuario({ phone: telefonoNuevo() });
  psql(`insert into public.sensitive_verifications(user_id, expires_at) values ('${id}', now() + interval '5 minutes')`);
  assert.equal(pedirCodigo(id, telefonoNuevo()).ok, true);
});

prueba('NUEVA: el mismo numero con otro formato no cuenta como cambio', () => {
  const id = usuario({ phone: '+52 55 1234 5678' });
  const r = pedirCodigo(id, '+525512345678');
  assert.equal(r.ok, true, JSON.stringify(r));
});

prueba('NUEVA: sin correo verificado sigue siendo EMAIL_OR_ACCOUNT_REQUIRED, antes que cualquier otra regla', () => {
  const r = pedirCodigo(usuario({ emailVerificado: false }), telefonoNuevo());
  assert.equal(r.code, 'EMAIL_OR_ACCOUNT_REQUIRED');
});

console.log(`${pasados} pruebas de issue_phone_challenge (primer telefono sin reautenticacion).`);
