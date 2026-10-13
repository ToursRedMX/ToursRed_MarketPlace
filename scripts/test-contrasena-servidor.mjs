/**
 * Cambiar la contraseña con reautenticacion DEL SERVIDOR (migracion 20261013055618_user_has_password.sql).
 *
 * EL DEFECTO: la pantalla de cambio de contraseña comprobaba la actual en el navegador, pero
 * `supabase.auth.updateUser({ password })` no la exige: quien tuviera un token de sesion (sesion robada, o un
 * acceso por celular de una cuenta sin MFA) la cambiaba sin conocerla.
 *
 * LO QUE VIGILA
 *  1. user_has_password: false sin contraseña (alta social aun no completada), true con ella; solo service_role.
 *  2. set-password: politica -> reautenticacion (si hay contraseña o TOTP) -> cambio; un cambio real cierra las
 *     demas sesiones y avisa por correo; el alta inicial no.
 *  3. NADIE en src/ llama ya a updateUser({ password }): todo pasa por establecerContrasena.
 *  4. establecerContrasena (ejecutada): conserva la forma del error de Supabase para esContrasenaFiltrada.
 *  5. Las pantallas que cambian la contraseña con sesion usan invokeWithStepUp (modal de reautenticacion); las del
 *     alta social, la llamada simple.
 *
 * LIMITES HONESTOS: esquema minimo para la funcion SQL; las Edge Functions y las pantallas se vigilan por analisis
 * estatico y la funcion pura. Esto SOLO cierra el hueco cuando el ajuste «Require current password when changing
 * password» de Supabase Auth esta activo (lo activa Axel en el Dashboard); no se puede comprobar desde aqui.
 *
 *   node scripts/test-contrasena-servidor.mjs      (PGDATABASE debe empezar con contrasena_servidor)
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

assert.match(process.env.PGDATABASE ?? '', /^contrasena_servidor/, 'PGDATABASE debe empezar con contrasena_servidor (el script borra esquemas)');
const psql = (sql) => execFileSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const leer = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');
const sinComentarios = (ruta) => leer(ruta).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
let n = 0;
const prueba = (nombre, fn) => { fn(); console.log(`ok ${++n} - ${nombre}`); };

// ---- 1. SQL ------------------------------------------------------------------------------------------
psql(`
  drop function if exists public.user_has_password(uuid);
  drop schema if exists auth cascade;
  do \$\$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
  end \$\$;
  create schema auth;
  create table auth.users (id uuid primary key, encrypted_password text);
`);
psql(leer('supabase/migrations/20261013055618_user_has_password.sql'));
const usuario = (hash) => { const id = randomUUID(); psql(`insert into auth.users values ('${id}', ${hash === null ? 'null' : `'${hash}'`})`); return id; };
const tiene = (id) => psql(`select public.user_has_password('${id}')`) === 't';
prueba('user_has_password: sin contraseña (NULL o vacia) es false; con hash es true; usuario inexistente es false', () => {
  assert.equal(tiene(usuario(null)), false);
  assert.equal(tiene(usuario('')), false);
  assert.equal(tiene(usuario('$2a$10$abcdefghijklmnopqrstuv')), true);
  assert.equal(tiene(randomUUID()), false);
});
prueba('user_has_password: solo la ejecuta service_role', () => {
  for (const rol of ['anon', 'authenticated'])
    assert.equal(psql(`select has_function_privilege('${rol}','public.user_has_password(uuid)','execute')`), 'f', rol);
  assert.equal(psql(`select has_function_privilege('service_role','public.user_has_password(uuid)','execute')`), 't');
});

// ---- 2. Edge Function ---------------------------------------------------------------------------------------
const fn = sinComentarios('supabase/functions/set-password/index.ts');
prueba('set-password: politica, luego reautenticacion (si hay contraseña o TOTP), luego el cambio', () => {
  const iPolitica = fn.indexOf('validarContrasena(nueva)'), iReauth = fn.indexOf('await enforceReauth('), iCambio = fn.indexOf('updateUserById');
  assert.ok(iPolitica > 0 && iReauth > iPolitica && iCambio > iReauth, 'politica -> reauth -> cambio');
  assert.match(fn, /if \(tienePassword === true \|\| tieneTotp === true\) \{\s*const reauthBloqueo = await enforceReauth\(admin, user\.id, cors\);\s*if \(reauthBloqueo\) return reauthBloqueo;/);
  assert.match(fn, /if \(errorPassword \|\| errorTotp\) return responder\(\{ code: 'PASSWORD_UNAVAILABLE'/, 'si no se puede saber, no se cambia (falla cerrado)');
});
prueba('set-password: solo un CAMBIO real cierra las demas sesiones y avisa; el alta inicial no', () => {
  assert.match(fn, /if \(tienePassword === true\) \{[\s\S]*?signOut\(token, 'others'\)[\s\S]*?enviarCorreoSimple\(admin, user\.email/);
  assert.equal([...fn.matchAll(/signOut\(/g)].length, 1);
});
prueba('set-password: la contraseña nunca se registra ni vuelve en la respuesta; errores de contraseña debil por CODIGO', () => {
  assert.doesNotMatch(fn, /console\.\w+\([^)]*\b(nueva|raw|body)\b/, 'ningun console recibe la contraseña ni el cuerpo');
  assert.doesNotMatch(fn, /responder\(\{[^}]*(:\s*nueva\b|\bnueva\s*[,}]|body\.new_password)/, 'ninguna respuesta lleva la contraseña');
  assert.match(fn, /e\.code === 'weak_password'/);
  assert.match(fn, /e\.reasons\.includes\('pwned'\)/);
});
prueba('set-password conserva verify_jwt (no esta en config.toml como publica)', () => {
  assert.doesNotMatch(leer('supabase/config.toml'), /functions\."set-password"/);
});

// ---- 3-5. Front ----------------------------------------------------------------------------------------------
function archivos(dir) {
  return readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? archivos(`${dir}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : []);
}
prueba('nadie en src/ llama a auth.updateUser con una contraseña', () => {
  const infractores = archivos('src').filter((f) => /auth\.updateUser\(\s*\{\s*password/.test(sinComentarios(f)));
  assert.deepEqual(infractores, []);
});
prueba('las pantallas con sesion y contraseña usan invokeWithStepUp; el alta social, la llamada simple', () => {
  for (const f of ['src/components/ChangePasswordSection.tsx', 'src/components/FirstLoginPasswordGate.tsx', 'src/pages/executive/ExecutivePerfil.tsx'])
    assert.match(leer(f), /establecerContrasena\(\w+(?:\.\w+)?, invokeWithStepUp\)/, f);
  const sociales = archivos('src/pages/auth').filter((f) => /establecerContrasena\(password\)/.test(leer(f)));
  assert.equal(sociales.length, 10, 'las 10 paginas de alta social');
  for (const f of sociales) assert.doesNotMatch(leer(f), /establecerContrasena\(password, /, f);
});
prueba('ChangePasswordSection ya no comprueba la contraseña actual en el navegador', () => {
  const f = sinComentarios('src/components/ChangePasswordSection.tsx');
  assert.doesNotMatch(f, /signInWithPassword|currentPassword/);
});

function cargar() {
  const fuente = leer('src/lib/establecerContrasena.ts').replace(/^import[^\n]*\n/gm, '');
  const contexto = { exports: {}, supabase: {}, Response, Object, Error };
  vm.runInNewContext(ts.transpileModule(fuente, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, contexto);
  return contexto.exports.establecerContrasena;
}
const establecer = cargar();
const invocarCon = (resultado) => async (nombre, body) => { assert.equal(nombre, 'set-password'); assert.deepEqual(Object.keys(body), ['new_password']); return resultado; };
{
  const ok = await establecer('Abcdef12', invocarCon({ data: { ok: true }, error: null }));
  assert.equal(ok.error, null); console.log(`ok ${++n} - establecerContrasena: exito devuelve error null`);
  const pwned = await establecer('Admin123!', invocarCon({ data: { code: 'PASSWORD_PWNED' }, error: new Error('x') }));
  assert.equal(pwned.error.code, 'weak_password'); assert.deepEqual([...pwned.error.reasons], ['pwned']);
  console.log(`ok ${++n} - establecerContrasena: contraseña filtrada conserva la forma {code:'weak_password', reasons:['pwned']}`);
  const misma = await establecer('Abcdef12', invocarCon({ data: { code: 'PASSWORD_SAME' }, error: new Error('x') }));
  assert.match(misma.error.message, /diferente a la actual/);
  const reauth = await establecer('Abcdef12', invocarCon({ data: { code: 'REAUTH_REQUIRED' }, error: new Error('x') }));
  assert.match(reauth.error.message, /confirmar tu identidad/);
  const raro = await establecer('Abcdef12', invocarCon({ data: { error: 'Mensaje del servidor' }, error: new Error('x') }));
  assert.equal(raro.error.message, 'Mensaje del servidor');
  const sinCuerpo = await establecer('Abcdef12', invocarCon({ data: null, error: new Error('Error 500') }));
  assert.equal(sinCuerpo.error.message, 'Error 500');
  console.log(`ok ${++n} - establecerContrasena: mapea PASSWORD_SAME, REAUTH_REQUIRED, mensaje del servidor y sin cuerpo`);
}

console.log(`${n} pruebas de contraseña desde el servidor OK.`);
