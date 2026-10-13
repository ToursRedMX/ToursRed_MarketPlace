/**
 * Cambio de correo verificado (migracion 20261013044213_cambio_de_correo_verificado.sql).
 *
 * QUE VIGILA
 *  - issue_email_change: tope de 3 solicitudes/hora, una sola vigente (la nueva invalida la anterior),
 *    correo invalido rechazado, cuenta inexistente rechazada.
 *  - confirm_email_change: codigo bueno -> devuelve el correo nuevo UNA vez; reusar falla; codigo malo
 *    cuenta intento y al 5.o bloquea AUNQUE despues llegue el bueno; vencido no sirve; otra cuenta no
 *    puede canjear el codigo ajeno.
 *  - El codigo nunca se guarda en claro; solo service_role ejecuta las funciones o lee la tabla.
 *  - Las dos Edge Functions: reautenticacion ANTES de cualquier efecto, el codigo no viaja en la
 *    respuesta, el correo vigente solo se cambia tras confirm_email_change, y el aviso va al correo anterior.
 *
 * LIMITES HONESTOS: esquema minimo; no prueba Auth ni SMTP2GO reales.
 *
 *   node scripts/test-cambio-correo-sql.mjs      (PGDATABASE debe empezar con cambio_correo)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';

assert.match(process.env.PGDATABASE ?? '', /^cambio_correo/, 'PGDATABASE debe empezar con cambio_correo (el script borra esquemas)');
const psql = (sql) => execFileSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), 'utf8');
const MIGRACION = leer('../supabase/migrations/20261013044213_cambio_de_correo_verificado.sql');
const fn = (nombre) => leer(`../supabase/functions/${nombre}/index.ts`);

psql(`
  drop table if exists public.email_change_requests cascade;
  drop function if exists public.issue_email_change(uuid,text,text), public.confirm_email_change(uuid,text);
  drop schema if exists auth cascade;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
  end $$;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
`);
psql(MIGRACION);

const h = (s) => createHash('sha256').update(s).digest('hex');
let n = 0;
const prueba = (nombre, f) => { f(); console.log(`ok ${++n} - ${nombre}`); };
const usuario = () => { const id = randomUUID(); psql(`insert into auth.users values('${id}','${id}@x.invalid')`); return id; };
const emitir = (u, correo, hash) => JSON.parse(psql(`select public.issue_email_change('${u}','${correo}','${hash}')`));
const confirmar = (u, hash) => JSON.parse(psql(`select public.confirm_email_change('${u}','${hash}')`));
const BUENO = h('bueno'), MALO = h('malo');

prueba('emitir + confirmar con el codigo bueno devuelve el correo nuevo en minusculas, una sola vez', () => {
  const u = usuario();
  assert.equal(emitir(u, '  Nuevo@Ejemplo.COM ', BUENO).ok, true);
  const r = confirmar(u, BUENO);
  assert.deepEqual([r.ok, r.new_email], [true, 'nuevo@ejemplo.com']);
  assert.equal(confirmar(u, BUENO).code, 'CODE_INVALID', 'no se puede reusar');
});
prueba('codigo malo: cuenta intento; al 5.o se bloquea y el bueno ya no sirve', () => {
  const u = usuario(); emitir(u, 'a@b.co', BUENO);
  for (let i = 0; i < 4; i++) assert.equal(confirmar(u, MALO).code, 'CODE_INVALID');
  assert.equal(confirmar(u, MALO).code, 'CODE_LOCKED');
  assert.equal(confirmar(u, BUENO).code, 'CODE_INVALID', 'tras el bloqueo ya no hay solicitud vigente');
});
prueba('4 fallos y luego el bueno SI funciona (el limite es 5, no 4)', () => {
  const u = usuario(); emitir(u, 'a@b.co', BUENO);
  for (let i = 0; i < 4; i++) confirmar(u, MALO);
  assert.equal(confirmar(u, BUENO).ok, true);
});
prueba('una solicitud nueva invalida la anterior', () => {
  const u = usuario(); emitir(u, 'uno@b.co', BUENO); emitir(u, 'dos@b.co', h('otro'));
  assert.equal(confirmar(u, BUENO).code, 'CODE_INVALID');
  assert.equal(confirmar(u, h('otro')).new_email, 'dos@b.co');
});
prueba('tope de 3 solicitudes por hora', () => {
  const u = usuario();
  for (let i = 0; i < 3; i++) assert.equal(emitir(u, `c${i}@b.co`, h('x' + i)).ok, true);
  assert.equal(emitir(u, 'c9@b.co', h('x9')).code, 'EMAIL_CHANGE_RATE_LIMIT');
});
prueba('vencido no sirve', () => {
  const u = usuario(); emitir(u, 'a@b.co', BUENO);
  psql(`update public.email_change_requests set created_at=now()-interval '20 minutes', expires_at=now()-interval '5 minutes' where user_id='${u}'`);
  assert.equal(confirmar(u, BUENO).code, 'CODE_EXPIRED');
});
prueba('otra cuenta no puede canjear el codigo ajeno', () => {
  const u = usuario(), otro = usuario(); emitir(u, 'a@b.co', BUENO);
  assert.equal(confirmar(otro, BUENO).code, 'CODE_INVALID');
  assert.equal(confirmar(u, BUENO).ok, true);
});
prueba('correo invalido y cuenta inexistente se rechazan', () => {
  const u = usuario();
  for (const mal of ['sin-arroba', 'a@b', '', 'a b@c.co']) assert.equal(emitir(u, mal, BUENO).code, 'EMAIL_INVALID', mal);
  assert.equal(emitir(randomUUID(), 'a@b.co', BUENO).code, 'EMAIL_INVALID');
  assert.equal(confirmar(u, 'no-es-un-hash').code, 'CODE_INVALID');
});
prueba('el codigo no se guarda en claro y la tabla solo es de service_role', () => {
  const u = usuario(); emitir(u, 'a@b.co', h('123456'));
  assert.equal(psql(`select code_hash from public.email_change_requests where user_id='${u}'`), h('123456'));
  for (const rol of ['anon', 'authenticated']) {
    assert.equal(psql(`select has_table_privilege('${rol}','public.email_change_requests','select')`), 'f', rol);
    for (const f of ['issue_email_change(uuid,text,text)', 'confirm_email_change(uuid,text)'])
      assert.equal(psql(`select has_function_privilege('${rol}','public.${f}','execute')`), 'f', `${rol} ${f}`);
  }
  assert.equal(psql(`select has_function_privilege('service_role','public.confirm_email_change(uuid,text)','execute')`), 't');
});

// ---- Edge Functions (analisis estatico) ---------------------------------------------------------
prueba('request-email-change: reautenticacion ANTES de emitir; el codigo solo va al correo, no a la respuesta', () => {
  const s = fn('request-email-change');
  assert.ok(s.indexOf('await enforceReauth(') > 0 && s.indexOf('await enforceReauth(') < s.indexOf("rpc('issue_email_change'"), 'reauth antes de emitir');
  assert.match(s, /if \(reauthBloqueo\) return reauthBloqueo;/);
  assert.ok(s.indexOf("rpc('check_email_available'") < s.indexOf("rpc('issue_email_change'"));
  for (const m of s.matchAll(/responder\(\{[^}]*\}/g)) assert.doesNotMatch(m[0], /codigo|code_hash|hash/i, 'la respuesta no lleva el codigo: ' + m[0]);
  assert.match(s, /enviarCorreoSimple\(admin, nuevo,/, 'el correo con el codigo va al correo NUEVO');
  assert.doesNotMatch(s, /updateUserById/, 'esta funcion nunca cambia el correo');
});
prueba('confirm-email-change: solo cambia el correo tras confirm_email_change, avisa al anterior y cierra otras sesiones', () => {
  const s = fn('confirm-email-change');
  const iConfirm = s.indexOf("rpc('confirm_email_change'"), iCambio = s.indexOf('updateUserById');
  assert.ok(iConfirm > 0 && iCambio > iConfirm, 'el cambio va despues de confirmar el codigo');
  assert.match(s, /if \(!data\?\.ok\) return responder/, 'sin ok no se sigue');
  assert.match(s, /email_confirm: true/);
  assert.match(s, /enviarCorreoSimple\(admin, anterior,/, 'aviso al correo ANTERIOR');
  assert.match(s, /signOut\(token, 'others'\)/);
  assert.match(s, /from\('users'\)\.update\(\{ email: nuevo \}\)/, 'sincroniza public.users');
});
prueba('ninguna de las dos funciones desactiva verify_jwt', () => {
  const cfg = leer('../supabase/config.toml');
  for (const f of ['request-email-change', 'confirm-email-change']) assert.doesNotMatch(cfg, new RegExp(`functions\\."${f}"`));
});

console.log(`${n} pruebas de cambio de correo OK.`);
