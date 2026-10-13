/**
 * Reautenticacion unica (migracion 20261013014305_reautenticacion_unica.sql).
 *
 * LA REGLA: cuenta CON TOTP verificado -> solo vale un TOTP reciente; cuenta SIN TOTP ->
 * solo vale la contraseña actual verificada hace poco. Nunca se mezclan.
 *
 * ============================================================================
 * QUE VIGILA
 * ============================================================================
 *  1. La version VIEJA de recent_phone_auth (recortada tal cual de la migracion
 *     20261008054539) reproduce el defecto: una sesion iniciada hace 1 minuto, sin ninguna
 *     prueba, deja cambiar el telefono. Una prueba que no se ve fallar no prueba nada.
 *  2. La version NUEVA (el archivo de la migracion ejecutado tal cual) ya no tiene ese atajo.
 *  3. Sin TOTP: la contraseña vale; una fila 'totp' de sensitive_verifications NO vale.
 *  4. Con TOTP: solo el TOTP vale; la contraseña NO sustituye al segundo factor; un factor
 *     sin verificar no cuenta como MFA; una fila de otro `method` no vale.
 *  5. Las pruebas vencen.
 *  6. El trigger real guard_phone_number_change (recortado de la migracion) bloquea el
 *     cambio de telefono sin prueba y lo deja pasar con ella.
 *  7. Ni `authenticated` ni `anon` pueden leer reauth_proofs ni ejecutar las funciones.
 *
 * LIMITES HONESTOS: esquema minimo (auth.users, auth.mfa_factors, public.users,
 * sensitive_verifications) con solo las columnas que se leen; NO es la cadena completa de
 * migraciones (patron 5 del CLAUDE.md). No prueba las Edge Functions que escriben las
 * pruebas ni nada contra Supabase real.
 *
 *   node scripts/test-reauth-unica-sql.mjs
 *
 * PGDATABASE debe empezar con `reauth_unica` (el script borra esquemas).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

assert.match(process.env.PGDATABASE ?? '', /^reauth_unica/, 'PGDATABASE debe empezar con reauth_unica (el script borra esquemas)');

const psql = (sql) => execFileSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const leer = (archivo) => readFileSync(new URL(`../supabase/migrations/${archivo}`, import.meta.url), 'utf8');
const fundacion = leer('20261008045859_sms_otp_foundation.sql');
const enforcement = leer('20261008054539_phone_otp_enforcement.sql');
const migracion = leer('20261013014305_reautenticacion_unica.sql');

function recortar(texto, inicio, fin, nombre) {
  const i = texto.indexOf(inicio);
  assert.ok(i >= 0, `no se encontro ${nombre}`);
  const j = texto.indexOf(fin, i);
  assert.ok(j >= 0, `no se encontro el final de ${nombre}`);
  return texto.slice(i, j + fin.length);
}

const viejaRecentAuth = recortar(enforcement, 'create function messaging_private.recent_phone_auth', '\n$$;', 'recent_phone_auth (vieja)');
const guard = recortar(enforcement, 'create function public.guard_phone_number_change', '\nend $$;', 'guard_phone_number_change');
const normalizar = recortar(fundacion, 'create function public.normalizar_telefono', '\nend $$;', 'normalizar_telefono');

psql(`
  drop schema if exists messaging_private cascade;
  drop schema if exists auth cascade;
  drop table if exists public.reauth_proofs, public.sensitive_verifications, public.users cascade;
  drop function if exists public.normalizar_telefono(text), public.guard_phone_number_change(), public.user_has_totp(uuid), public.reauth_satisfied(uuid);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
  end $$;
  create schema auth;
  create table auth.users (id uuid primary key, last_sign_in_at timestamptz);
  create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid not null, factor_type text not null, status text not null);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema messaging_private;
  create table public.users (id uuid primary key, phone_number text);
  create table public.sensitive_verifications (id uuid primary key default gen_random_uuid(), user_id uuid, verified_at timestamptz default now(), method text not null, expires_at timestamptz not null);
  grant usage on schema auth, messaging_private to authenticated, anon, service_role;
  grant select, update on public.users to authenticated;
  ${normalizar}
  ${viejaRecentAuth}
  ${guard}
  revoke all on function public.guard_phone_number_change() from public,anon,authenticated;
  create trigger guard_phone_number_change before update of phone_number on public.users for each row execute function public.guard_phone_number_change();
`);

const SIN_TOTP = 'sin_totp', CON_TOTP = 'con_totp';
function usuario({ totp = false, factorSinVerificar = false, login = "now()" } = {}) {
  const id = randomUUID();
  psql(`insert into auth.users(id, last_sign_in_at) values ('${id}', ${login});
        insert into public.users(id, phone_number) values ('${id}', '+525512345678');
        ${totp ? `insert into auth.mfa_factors(user_id, factor_type, status) values ('${id}','totp','verified');` : ''}
        ${factorSinVerificar ? `insert into auth.mfa_factors(user_id, factor_type, status) values ('${id}','totp','unverified');` : ''}`);
  return id;
}
const darTotp = (id, { method = 'totp', vence = "now() + interval '15 minutes'" } = {}) =>
  psql(`insert into public.sensitive_verifications(user_id, method, expires_at) values ('${id}','${method}',${vence})`);
const darPassword = (id, { vence = "now() + interval '5 minutes'" } = {}) =>
  psql(`insert into public.reauth_proofs(user_id, method, verified_at, expires_at) values ('${id}','password', (${vence}) - interval '5 minutes', ${vence})`);
const reciente = (id) => psql(`select messaging_private.recent_phone_auth('${id}')`) === 't';
const satisfecha = (id) => psql(`select public.reauth_satisfied('${id}')`) === 't';
const cambiarTelefonoComo = (id, nuevo) =>
  psql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${id}',true); update public.users set phone_number='${nuevo}' where id='${id}'; commit;`);

let n = 0;
const prueba = (nombre, fn) => { fn(); console.log(`ok ${++n} - ${nombre}`); };

// ---- 1. La version VIEJA reproduce el defecto ----------------------------------------------
prueba('VIEJA: sesion de hace 1 minuto, SIN ninguna prueba, ya cuenta como "reautenticado" (el defecto)', () => {
  const u = usuario({ login: "now() - interval '1 minute'" });
  assert.equal(reciente(u), true);
  cambiarTelefonoComo(u, '+525599990001');
  assert.equal(psql(`select phone_number from public.users where id='${u}'`), '+525599990001', 'el telefono SI cambio con la version vieja');
});

// ---- 2. Se aplica la migracion tal cual -----------------------------------------------------
psql(migracion);

prueba('NUEVA: una sesion recien iniciada, sin prueba, ya NO basta', () => {
  const u = usuario({ login: 'now()' });
  assert.equal(reciente(u), false);
  assert.throws(() => cambiarTelefonoComo(u, '+525599990002'), /PHONE_REAUTH_REQUIRED/);
});

// ---- 3. Sin TOTP: solo la contraseña ----------------------------------------------------------
prueba('sin TOTP: la contraseña vigente basta y deja cambiar el telefono', () => {
  const u = usuario();
  darPassword(u);
  assert.equal(satisfecha(u), true);
  cambiarTelefonoComo(u, '+525599990003');
  assert.equal(psql(`select phone_number from public.users where id='${u}'`), '+525599990003');
});
prueba('sin TOTP: una fila "totp" en sensitive_verifications NO vale', () => {
  const u = usuario();
  darTotp(u);
  assert.equal(satisfecha(u), false);
});
prueba('sin TOTP: una contraseña vencida no vale', () => {
  const u = usuario();
  darPassword(u, { vence: "now() - interval '1 second'" });
  assert.equal(satisfecha(u), false);
});
prueba('un factor TOTP SIN verificar no cuenta como MFA: sigue mandando la contraseña', () => {
  const u = usuario({ factorSinVerificar: true });
  assert.equal(psql(`select public.user_has_totp('${u}')`), 'f');
  darPassword(u);
  assert.equal(satisfecha(u), true);
});

// ---- 4. Con TOTP: solo el TOTP ---------------------------------------------------------------------
prueba('con TOTP: la contraseña NO sustituye al segundo factor', () => {
  const u = usuario({ totp: true });
  assert.equal(psql(`select public.user_has_totp('${u}')`), 't');
  darPassword(u);
  assert.equal(satisfecha(u), false);
  assert.throws(() => cambiarTelefonoComo(u, '+525599990004'), /PHONE_REAUTH_REQUIRED/);
});
prueba('con TOTP: el TOTP vigente basta', () => {
  const u = usuario({ totp: true });
  darTotp(u);
  assert.equal(satisfecha(u), true);
  cambiarTelefonoComo(u, '+525599990005');
});
prueba('con TOTP: un TOTP vencido no vale', () => {
  const u = usuario({ totp: true });
  darTotp(u, { vence: "now() - interval '1 second'" });
  assert.equal(satisfecha(u), false);
});
prueba('con TOTP: una fila de otro `method` no vale', () => {
  const u = usuario({ totp: true });
  darTotp(u, { method: 'password' });
  assert.equal(satisfecha(u), false);
});
prueba('la prueba de OTRA cuenta no vale', () => {
  const a = usuario(), b = usuario();
  darPassword(a);
  assert.equal(satisfecha(b), false);
});

// ---- 5. Restricciones y permisos ----------------------------------------------------------------------
prueba('reauth_proofs solo acepta method = password', () => {
  const u = usuario();
  assert.throws(() => psql(`insert into public.reauth_proofs(user_id, method, expires_at) values ('${u}','totp', now() + interval '1 minute')`), /check/i);
});
prueba('authenticated y anon no pueden leer reauth_proofs ni ejecutar las funciones', () => {
  const u = usuario();
  darPassword(u);
  for (const rol of ['authenticated', 'anon']) {
    assert.throws(() => psql(`set role ${rol}; select count(*) from public.reauth_proofs;`), /permission denied/i, `${rol} lee la tabla`);
    assert.throws(() => psql(`set role ${rol}; select public.reauth_satisfied('${u}');`), /permission denied/i, `${rol} ejecuta reauth_satisfied`);
    assert.throws(() => psql(`set role ${rol}; select public.user_has_totp('${u}');`), /permission denied/i, `${rol} ejecuta user_has_totp`);
  }
  assert.equal(psql(`set role service_role; select public.reauth_satisfied('${u}');`).split('\n').at(-1), 't');
});
prueba('RLS activado en reauth_proofs', () => {
  assert.equal(psql(`select relrowsecurity from pg_class where oid='public.reauth_proofs'::regclass`), 't');
});

// ---- 6. El paso a paso del wallet (checkStepUp) solo acepta TOTP --------------------------------------------
prueba('checkStepUp filtra sensitive_verifications por method = totp (la contraseña no abre el wallet)', () => {
  const ts = readFileSync(new URL('../supabase/functions/_shared/stepUpCheck.ts', import.meta.url), 'utf8');
  const cuerpo = recortar(ts, 'export async function checkStepUp', '\n}\n', 'checkStepUp');
  assert.match(cuerpo, /\.from\("sensitive_verifications"\)[\s\S]*\.eq\("method", "totp"\)/, 'falta el filtro por method');
});

console.log(`${n} pruebas de reautenticacion unica OK.`);
