/**
 * Login por telefono + cambio de telefono PENDIENTE
 * (migracion 20261013043540_login_por_telefono_y_cambio_pendiente.sql).
 *
 * QUE VIGILA
 *  1. La version VIEJA (recortada tal cual de las migraciones 20261008054539 / 20261009052107) tiene el
 *     defecto: pedir un codigo para un numero NUEVO escribe users.phone_number y el trigger borra la
 *     verificacion vigente, aunque el numero nuevo nunca se pruebe.
 *  2. La NUEVA (el archivo ejecutado tal cual): el numero vigente se conserva hasta confirmar el codigo
 *     del nuevo; al confirmarlo, cambia numero y verificacion juntos.
 *  3. Un usuario con telefono verificado NO puede escribir users.phone_number directo, ni con prueba
 *     de reautenticacion (el cambio va por OTP). Sin verificado, rige la regla de siempre.
 *  4. find_user_for_phone_login: solo cuentas activas, con correo verificado y telefono verificado.
 *  5. get_login_challenge: solo retos pendientes y vigentes.
 *  6. Las funciones nuevas solo las ejecuta service_role.
 *  7. Un reto de login se resuelve con verify_phone_challenge: bucket de fallos propio ('login:'),
 *     5 intentos, y un fallo en login NO bloquea la verificacion normal de la misma cuenta.
 *
 * LIMITES HONESTOS: esquema minimo + recortes de las migraciones reales (NO la cadena completa, patron 5).
 * No prueba las Edge Functions ni el canje de sesion contra Supabase Auth.
 *
 *   node scripts/test-login-telefono-sql.mjs      (PGDATABASE debe empezar con login_telefono)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';

assert.match(process.env.PGDATABASE ?? '', /^login_telefono/, 'PGDATABASE debe empezar con login_telefono (el script borra esquemas)');
const psql = (sql) => execFileSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const leer = (a) => readFileSync(new URL(`../supabase/migrations/${a}`, import.meta.url), 'utf8');
const fundacion = leer('20261008045859_sms_otp_foundation.sql');
const enforcement = leer('20261008054539_phone_otp_enforcement.sql');
const canales = leer('20261009052107_phone_otp_whatsapp_channels.sql');
const reauth = leer('20261013014305_reautenticacion_unica.sql');
const NUEVA = leer('20261013043540_login_por_telefono_y_cambio_pendiente.sql');

function recortar(texto, inicio, fin, nombre) {
  const i = texto.indexOf(inicio); assert.ok(i >= 0, `no se encontro ${nombre}`);
  const j = texto.indexOf(fin, i); assert.ok(j >= 0, `no se encontro el final de ${nombre}`);
  return texto.slice(i, j + fin.length);
}
const normalizar = recortar(fundacion, 'create function public.normalizar_telefono', '\nend $$;', 'normalizar_telefono');
const guardVerif = recortar(fundacion, 'create function public.guard_phone_verification_fields', '\nend $$;', 'guard_phone_verification_fields');
const invalidar = recortar(fundacion, 'create function messaging_private.invalidate_phone_challenges', '\nend $$;', 'invalidate_phone_challenges');
const consumir = recortar(fundacion, 'create function public.consume_sms_rate_limit', '\nend $$;', 'consume_sms_rate_limit');
const verifTabla = recortar(fundacion, 'create table messaging_private.phone_verifications', '\n);', 'phone_verifications');
const bucketTabla = recortar(fundacion, 'create table messaging_private.rate_limit_buckets', '\n);', 'rate_limit_buckets');
const eventosTabla = recortar(enforcement, 'create table messaging_private.phone_events', '\n);', 'phone_events');
const guardViejo = recortar(enforcement, 'create function public.guard_phone_number_change', '\nend $$;', 'guard viejo');
const issueViejo = recortar(canales, 'create or replace function public.issue_phone_challenge(p_user uuid,p_id uuid,p_phone text,p_hash text,p_user_hash text,p_phone_hash text,p_ip_hash text,p_simulated boolean,p_channel text)', '\nend $$;', 'issue viejo');
const verifyViejo = recortar(enforcement, 'create function public.verify_phone_challenge', '\nend $$;', 'verify viejo');

psql(`
  drop schema if exists messaging_private cascade;
  drop schema if exists auth cascade;
  drop table if exists public.reauth_proofs, public.sensitive_verifications, public.users, public.platform_settings cascade;
  drop function if exists public.normalizar_telefono(text), public.guard_phone_number_change(), public.guard_phone_verification_fields(),
    public.user_has_totp(uuid), public.reauth_satisfied(uuid), public.consume_sms_rate_limit(text,text,timestamptz,timestamptz,integer,integer),
    public.issue_phone_challenge(uuid,uuid,text,text,text,text,text,boolean,text), public.verify_phone_challenge(uuid,uuid,text,text),
    public.find_user_for_phone_login(text), public.get_login_challenge(uuid);
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
  create table public.platform_settings (id int primary key default 1, sms_habilitado boolean default true, whatsapp_habilitado boolean default true,
    sms_modo_prueba boolean default false, sms_otp_limite_usuario_diario int default 50, sms_otp_limite_telefono_diario int default 50, sms_otp_limite_ip_hora int default 100);
  insert into public.platform_settings default values;
  create table public.users (id uuid primary key, email text, phone_number text, is_active boolean default true, email_verified boolean default true,
    phone_verified_at timestamptz, phone_verified_e164 text);
  create table public.sensitive_verifications (id uuid primary key default gen_random_uuid(), user_id uuid, verified_at timestamptz default now(), method text not null, expires_at timestamptz not null);
  create table messaging_private.provider_capabilities (provider text primary key);
  create table messaging_private.notification_attempts (id uuid primary key default gen_random_uuid(), verification_id uuid, status text, is_simulated boolean default false);
  grant usage on schema auth, messaging_private to authenticated, anon, service_role;
  grant select, update on public.users to authenticated;
  ${normalizar}
  alter table public.users add constraint users_phone_verification_pair check (
    (phone_verified_at is null and phone_verified_e164 is null) or
    (phone_verified_at is not null and phone_verified_e164 is not null and phone_verified_e164 ~ '^\\+[1-9][0-9]{7,14}$' and
     public.normalizar_telefono(phone_number) is not null and phone_verified_e164 = public.normalizar_telefono(phone_number)));
  create unique index users_verified_phone_unique on public.users(phone_verified_e164) where phone_verified_e164 is not null;
  ${verifTabla}
  create unique index phone_verifications_one_pending on messaging_private.phone_verifications(user_id) where status='pendiente';
  alter table messaging_private.phone_verifications add column channel text not null default 'sms' check(channel in ('sms','whatsapp'));
  ${bucketTabla}
  ${eventosTabla}
  ${guardVerif}
  create trigger guard_phone_verification_fields before insert or update on public.users for each row execute function public.guard_phone_verification_fields();
  ${invalidar}
  create trigger invalidate_phone_challenges after update of phone_number on public.users for each row execute function messaging_private.invalidate_phone_challenges();
  ${consumir}
  ${reauth}
  ${guardViejo}
  create trigger guard_phone_number_change before update of phone_number on public.users for each row execute function public.guard_phone_number_change();
  ${issueViejo}
  ${verifyViejo}
`);

const hash = (s) => createHash('sha256').update(s).digest('hex');
const BUENO = 'a'.repeat(64), MALO = 'b'.repeat(64);
let seq = Math.floor(Math.random() * 800000), n = 0;
const prueba = (nombre, fn) => { fn(); console.log(`ok ${++n} - ${nombre}`); };
const usuario = (extra = {}) => {
  const id = randomUUID(), tel = extra.tel ?? '+525580' + String(++seq).padStart(6, '0');
  psql(`insert into auth.users(id,last_sign_in_at) values('${id}',now());
        insert into public.users(id,email,phone_number,is_active,email_verified) values('${id}','${id}@x.invalid','${tel}',${extra.activo ?? true},${extra.correo ?? true});`);
  return { id, tel };
};
const pedir = (u, tel = u.tel, userHash = hash(u.id)) => {
  const id = randomUUID();
  const r = JSON.parse(psql(`select public.issue_phone_challenge('${u.id}','${id}','${tel}','${BUENO}','${userHash}','${hash(tel)}','${hash(u.id + 'ip')}',false,'sms')`));
  return { ...r, id };
};
const enviado = (c) => psql(`insert into messaging_private.notification_attempts(verification_id,status) values('${c.id}','aceptado')`);
const verificar = (u, c, h = BUENO, userHash = hash(u.id)) => JSON.parse(psql(`select public.verify_phone_challenge('${u.id}','${c.id}','${h}','${userHash}')`));
const envejecer = (c) => psql(`update messaging_private.phone_verifications set created_at=now()-interval '2 minutes', expires_at=now()+interval '8 minutes' where id='${c.id}'`);
const fila = (u) => psql(`select phone_number||'|'||coalesce(phone_verified_e164,'-') from public.users where id='${u.id}'`);
const darPassword = (u) => psql(`insert into public.reauth_proofs(user_id,method,verified_at,expires_at) values('${u.id}','password',now()-interval '1 minute',now()+interval '5 minutes')`);
const comoUsuario = (u, sql) => psql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${u.id}',true); ${sql}; commit;`);
const verificado = (u) => { const c = pedir(u); enviado(c); assert.equal(verificar(u, c).ok, true); envejecer(c); return u; };

// ---- 1. VIEJA: reproduce el defecto -------------------------------------------------------------
prueba('VIEJA: pedir un codigo para un numero NUEVO borra la verificacion vigente sin probar el nuevo (el defecto)', () => {
  const u = verificado(usuario());
  darPassword(u);
  const nuevo = '+525599001122';
  const c = pedir(u, nuevo);
  assert.equal(c.ok, true);
  assert.equal(fila(u), `${nuevo}|-`, 'el telefono vigente se perdio y el nuevo no se verifico');
});

// ---- 2. Se aplica la migracion tal cual ------------------------------------------------------------
psql(NUEVA);

prueba('NUEVA: pedir el codigo del numero nuevo conserva el vigente y su verificacion', () => {
  const u = verificado(usuario()); darPassword(u);
  const antes = fila(u);
  const c = pedir(u, '+525599002233');
  assert.equal(c.ok, true);
  assert.equal(fila(u), antes, 'nada cambio todavia');
});
prueba('NUEVA: un codigo MALO para el numero nuevo no cambia nada', () => {
  const u = verificado(usuario()); darPassword(u);
  const antes = fila(u);
  const c = pedir(u, '+525599003344'); enviado(c);
  assert.equal(verificar(u, c, MALO).code, 'OTP_INVALID');
  assert.equal(fila(u), antes);
});
prueba('NUEVA: con el codigo bueno cambian numero y verificacion JUNTOS, y avisa que fue un cambio', () => {
  const u = verificado(usuario()); darPassword(u);
  const antes = fila(u).split('|')[0];
  const nuevo = '+525599004455';
  const c = pedir(u, nuevo); enviado(c);
  const r = verificar(u, c);
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  assert.equal(fila(u), `${nuevo}|${nuevo}`);
  assert.notEqual(antes, nuevo);
  assert.equal(psql(`select count(*) from messaging_private.phone_events where user_id='${u.id}' and event_type='number_changed'`), '1');
});
prueba('NUEVA: verificar el mismo numero NO se reporta como cambio', () => {
  const u = usuario(); const c = pedir(u); enviado(c);
  const r = verificar(u, c);
  assert.equal(r.ok, true); assert.equal(r.changed, false);
});
prueba('NUEVA: sin reautenticacion NO se puede pedir el codigo de un numero nuevo (regla de 20261013014305)', () => {
  const u = verificado(usuario());
  assert.equal(pedir(u, '+525599005566').code, 'PHONE_REAUTH_REQUIRED');
});
prueba('NUEVA: si el numero nuevo ya es de OTRA cuenta verificada, se rechaza', () => {
  const otro = verificado(usuario()); const u = verificado(usuario()); darPassword(u);
  assert.equal(pedir(u, otro.tel).code, 'PHONE_UNAVAILABLE');
});
prueba('NUEVA: cuenta SIN telefono verificado conserva el comportamiento de siempre (se guarda al pedir el codigo)', () => {
  const u = usuario(); const nuevo = '+525599006677';
  const c = pedir(u, nuevo); // primera verificacion: no hay verificado que proteger, y el telefono previo no es verificado
  assert.equal(c.code, 'PHONE_REAUTH_REQUIRED', 'tenia telefono escrito: exige reautenticacion para cambiarlo');
  darPassword(u);
  assert.equal(pedir(u, nuevo).ok, true);
  assert.equal(fila(u), `${nuevo}|-`);
});

// ---- 3. Escritura directa -----------------------------------------------------------------------------
prueba('trigger: con telefono verificado, escribir users.phone_number directo falla AUN con reautenticacion', () => {
  const u = verificado(usuario()); darPassword(u);
  assert.throws(() => comoUsuario(u, `update public.users set phone_number='+525599007788' where id='${u.id}'`), /PHONE_CHANGE_REQUIRES_OTP/);
});
prueba('trigger: sin reautenticacion sigue dando PHONE_REAUTH_REQUIRED', () => {
  const u = verificado(usuario());
  assert.throws(() => comoUsuario(u, `update public.users set phone_number='+525599007789' where id='${u.id}'`), /PHONE_REAUTH_REQUIRED/);
});
prueba('trigger: sin telefono verificado y con reautenticacion, el cambio directo sigue permitido', () => {
  const u = usuario(); darPassword(u);
  comoUsuario(u, `update public.users set phone_number='+525599007790' where id='${u.id}'`);
  assert.equal(fila(u), '+525599007790|-');
});
prueba('trigger: el service_role (motor OTP) si puede cambiar el telefono verificado', () => {
  const u = verificado(usuario());
  psql(`update public.users set phone_number='+525599007791' where id='${u.id}'`);
  assert.equal(fila(u), '+525599007791|-');
});

// ---- 4-6. Funciones del login ------------------------------------------------------------------------------
prueba('find_user_for_phone_login: solo activa + correo verificado + telefono verificado', () => {
  const ok = verificado(usuario());
  assert.equal(psql(`select public.find_user_for_phone_login('${ok.tel}')`), ok.id);
  assert.equal(psql(`select coalesce(public.find_user_for_phone_login('+525500000000')::text,'nada')`), 'nada', 'numero desconocido');
  const sinVerificar = usuario();
  assert.equal(psql(`select coalesce(public.find_user_for_phone_login('${sinVerificar.tel}')::text,'nada')`), 'nada', 'telefono sin verificar');
  const inactivo = verificado(usuario());
  psql(`update public.users set is_active=false where id='${inactivo.id}'`);
  assert.equal(psql(`select coalesce(public.find_user_for_phone_login('${inactivo.tel}')::text,'nada')`), 'nada', 'cuenta bloqueada');
  const sinCorreo = verificado(usuario());
  psql(`update public.users set email_verified=false where id='${sinCorreo.id}'`);
  assert.equal(psql(`select coalesce(public.find_user_for_phone_login('${sinCorreo.tel}')::text,'nada')`), 'nada', 'correo sin verificar');
});
prueba('get_login_challenge: solo retos pendientes y vigentes', () => {
  const u = verificado(usuario()); const c = pedir(u);
  const r = JSON.parse(psql(`select public.get_login_challenge('${c.id}')`));
  assert.equal(r.user_id, u.id); assert.equal(r.phone, u.tel);
  psql(`update messaging_private.phone_verifications set expires_at=now()-interval '1 second', created_at=now()-interval '9 minutes' where id='${c.id}'`);
  assert.equal(psql(`select coalesce(public.get_login_challenge('${c.id}')::text,'nada')`), 'nada', 'vencido');
  assert.equal(psql(`select coalesce(public.get_login_challenge('${randomUUID()}')::text,'nada')`), 'nada', 'inexistente');
});
prueba('las dos funciones nuevas solo las ejecuta service_role', () => {
  for (const f of ['find_user_for_phone_login(text)', 'get_login_challenge(uuid)'])
    assert.equal(psql(`select has_function_privilege('anon','public.${f}','execute') or has_function_privilege('authenticated','public.${f}','execute')`), 'f', f);
  for (const f of ['find_user_for_phone_login(text)', 'get_login_challenge(uuid)'])
    assert.equal(psql(`select has_function_privilege('service_role','public.${f}','execute')`), 't', f);
});

// ---- 7. Login: bucket propio -------------------------------------------------------------------------------
prueba('login: 5 fallos bloquean el LOGIN de esa cuenta pero NO su verificacion normal (buckets separados)', () => {
  const u = verificado(usuario());
  const hl = hash('login:' + u.id);
  let c = pedir(u, u.tel, hl); enviado(c);
  for (let i = 0; i < 5; i++) assert.equal(verificar(u, c, MALO, hl).code, 'OTP_INVALID');
  envejecer(c);
  assert.equal(pedir(u, u.tel, hl).code, 'OTP_LOCKED', 'login bloqueado');
  const normal = pedir(u);
  assert.equal(normal.ok, true, 'la verificacion normal sigue disponible');
});
prueba('login: el reto de login se resuelve con el codigo bueno y no se puede reusar', () => {
  const u = verificado(usuario()); const hl = hash('login:' + u.id);
  const c = pedir(u, u.tel, hl); enviado(c);
  assert.equal(verificar(u, c, BUENO, hl).ok, true);
  assert.equal(verificar(u, c, BUENO, hl).code, 'OTP_INVALID', 'un solo uso');
});


// ---- 8. Edge Functions y pantallas (analisis estatico) ---------------------------------------------------
const src = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');
const sinComentarios = (ruta) => src(ruta).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
prueba('request-login-otp: interruptor, busqueda por telefono verificado, bucket propio y respuesta indistinguible', () => {
  const f = sinComentarios('supabase/functions/request-login-otp/index.ts');
  assert.match(f, /select\('turnstile_auth_enabled, phone_login_enabled'\)/);
  assert.match(f, /if \(!settings\.phone_login_enabled\) return Response\.json\(\{ code: 'PHONE_LOGIN_DISABLED' \}/);
  assert.ok(f.indexOf("rpc('find_user_for_phone_login'") < f.indexOf("rpc('issue_phone_challenge'"), 'busca antes de emitir');
  assert.match(f, /hmac\(pepper, 'login:' \+ userId\)/, 'bucket de fallos propio del login');
  assert.doesNotMatch(f, /requireUser/, 'llega sin sesion');
  assert.match(f, /if \(!userId\) \{[\s\S]*?crypto\.randomUUID\(\)[\s\S]*?\}/, 'cuenta inexistente: reto falso');
  assert.doesNotMatch(f, /return Response\.json\(\{ code: data\.code \}[^\n]*\n[^\n]*EMAIL_OR_ACCOUNT/, 'no explica por que se rechazo');
  assert.match(f, /ERRORES_DE_LIMITE\.includes\(data\?\.code\)/, 'solo los topes se pasan tal cual');
});
prueba('verify-login-otp: la sesion solo se abre DESPUES de que verify_phone_challenge diga ok', () => {
  const f = sinComentarios('supabase/functions/verify-login-otp/index.ts');
  const iGet = f.indexOf("rpc('get_login_challenge'"), iVer = f.indexOf("rpc('verify_phone_challenge'"), iOk = f.indexOf('if (!data?.ok) return'), iLink = f.indexOf('client.auth.admin.generateLink');
  assert.ok(iGet > 0 && iVer > iGet && iOk > iVer && iLink > iOk, 'get -> verify -> corte si no ok -> generateLink');
  assert.equal([...f.matchAll(/token_hash/g)].length, 1, 'token_hash aparece una sola vez: en la respuesta final');
  assert.ok(f.indexOf('token_hash: tokenHash') > iLink, 'el token solo viaja en la respuesta posterior al enlace');
  assert.match(f, /hmac\(pepper, 'login:' \+ userId\)/);
  assert.match(f, /select\('phone_login_enabled'\)/);
  assert.doesNotMatch(f, /requireUser/);
});
prueba('config.toml: las dos funciones de login por telefono llegan sin JWT; el resto de cambios de acceso, con JWT', () => {
  const cfg = src('supabase/config.toml');
  for (const fnName of ['request-login-otp', 'verify-login-otp'])
    assert.match(cfg, new RegExp(`\\[functions\\."${fnName}"\\]\\nverify_jwt = false`));
  assert.doesNotMatch(cfg, /functions\."request-phone-otp"/);
});
prueba('PhoneLoginForm: con TOTP no deja pasar sin el segundo factor y cancelar cierra la sesion', () => {
  const f = src('src/components/PhoneLoginForm.tsx');
  assert.match(f, /aal\.nextLevel === 'aal2' && aal\.currentLevel !== 'aal2'/);
  assert.ok(f.indexOf("setPaso('mfa');\n          return;") > 0 && f.indexOf("setPaso('mfa');\n          return;") < f.indexOf('terminar(user);'), 'con factor, retorna antes de terminar');
  assert.match(f, /challengeAndVerify\(\{ factorId, code: totp \}\)[\s\S]*?terminar\(usuario\)/);
  assert.match(f, /const cancelarMfa = async \(\) => \{[\s\S]*?supabase\.auth\.signOut\(\)/);
  assert.equal([...f.matchAll(/terminar\(/g)].length, 2, 'solo dos salidas: sin MFA y tras MFA');
});
prueba('LoginPage: el boton de celular solo existe con phone_login_enabled', () => {
  const f = src('src/pages/auth/LoginPage.tsx');
  assert.match(f, /passkeys_enabled, phone_login_enabled'/);
  assert.match(f, /\{phoneLoginEnabled && \([\s\S]{0,700}Entrar con mi celular/);
  assert.match(f, /<PhoneLoginForm/);
});
prueba('request-phone-otp: cambiar un telefono ya verificado responde con el 403 de reautenticacion del servidor', () => {
  const f = src('supabase/functions/request-phone-otp/index.ts');
  assert.match(f, /data\?\.code==='PHONE_REAUTH_REQUIRED'\)\{const bloqueo=await enforceReauth\(client,userId,cors\);if\(bloqueo\)return bloqueo;\}/);
  assert.ok(f.indexOf("PHONE_REAUTH_REQUIRED'){const bloqueo") < f.indexOf('if(!data?.ok)return Response.json(data,'));
  const ui = src('src/components/PhoneOtpVerify.tsx');
  assert.match(ui, /invokeWithStepUp\('request-phone-otp'/);
});
prueba('los perfiles montan «Acceso a tu cuenta» y dejan de solo lectura el celular verificado', () => {
  for (const p of ['src/pages/traveler/TravelerProfile.tsx', 'src/pages/admin/AdminProfile.tsx', 'src/pages/agency/AgencyProfile.tsx', 'src/pages/executive/ExecutivePerfil.tsx'])
    assert.match(src(p), /<AccountAccessSection \/>/, p);
  for (const p of ['src/pages/traveler/TravelerProfile.tsx', 'src/pages/admin/AdminProfile.tsx', 'src/pages/executive/ExecutivePerfil.tsx'])
    assert.match(src(p), /readOnly=\{telefonoVerificado\}/, p);
  assert.match(src('src/pages/executive/ExecutivePerfil.tsx'), /if \(user\?\.id && !telefonoVerificado\)/);
});

console.log(`${n} pruebas de login por telefono / cambio pendiente OK.`);
