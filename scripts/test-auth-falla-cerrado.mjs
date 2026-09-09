/**
 * El chequeo de cuenta bloqueada (`is_active === false`) tiene que fallar
 * CERRADO: si no se puede leer el perfil, no se entra.
 *
 * Por que existe esta prueba y no basta con leer el diff:
 *
 *   El bug original no estaba en el `if`. Estaba en que la denegacion viajaba
 *   como excepcion y habia DOS `catch` mas arriba que la atrapaban y devolvian
 *   un rol igual —el cacheado, o TRAVELER—. O sea que se podia "arreglar" el
 *   chequeo y seguir dejando entrar al bloqueado. Por eso aqui se ejecuta el
 *   codigo de verdad, recortado del archivo, y ademas se comprueba que los dos
 *   catch sigan dejando salir los centinelas.
 *
 *   node scripts/test-auth-falla-cerrado.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const authContext = readFileSync('src/context/AuthContext.tsx', 'utf8');
const libSupabase = readFileSync('src/lib/supabase.ts', 'utf8');

/**
 * Recorta un bloque `{...}` a partir de un marcador, contando llaves y saltando
 * cadenas y comentarios (si no, un `{` dentro de un texto descuadra el conteo).
 */
function recortarBloque(fuente, marcador, anclaje = '{') {
  const inicio = fuente.indexOf(marcador);
  assert.notEqual(inicio, -1, `no se encontro el marcador: ${marcador}`);
  // El anclaje existe porque una firma puede traer llaves en su tipo de
  // retorno (`Promise<{ role: UserRole }>`), y sin el se recortaria ESO en vez
  // del cuerpo. Para una arrow function el anclaje es `=> {`.
  const desdeAnclaje = fuente.indexOf(anclaje, inicio + marcador.length - 1);
  assert.notEqual(desdeAnclaje, -1, `no se encontro el anclaje "${anclaje}" tras: ${marcador}`);
  let i = fuente.indexOf('{', desdeAnclaje);
  assert.notEqual(i, -1, `no se encontro la llave de apertura tras: ${marcador}`);

  const abre = i;
  let nivel = 0;
  for (; i < fuente.length; i++) {
    const c = fuente[i];
    const par = fuente.slice(i, i + 2);

    if (par === '//') { i = fuente.indexOf('\n', i); continue; }
    if (par === '/*') { i = fuente.indexOf('*/', i) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const comilla = c;
      for (i++; i < fuente.length; i++) {
        if (fuente[i] === '\\') { i++; continue; }
        if (fuente[i] === comilla) break;
      }
      continue;
    }
    if (c === '{') nivel++;
    else if (c === '}') { nivel--; if (nivel === 0) return fuente.slice(abre, i + 1); }
  }
  throw new Error(`bloque sin cerrar para: ${marcador}`);
}

const compilar = (fuente) => ts.transpileModule(fuente, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

// ---------------------------------------------------------------------------
// Parte 1 — `determineUserRole` de AuthContext
// ---------------------------------------------------------------------------

const cuerpoDetermine = recortarBloque(
  authContext,
  'const determineUserRole = async (authUser: any, forceRefresh: boolean = false)',
  '=> {',
);
const cuerpoCerrarSesion = recortarBloque(authContext, 'const cerrarSesionYRedirigir = async (destino: string)', '=> {');

const UserRole = {
  ADMIN: 'admin', AGENCY: 'agency', TRAVELER: 'traveler',
  ACCOUNTANT: 'accountant', ACCOUNT_EXECUTIVE: 'account_executive',
};

/** supabase de mentiras: `respuestas` es la cola de lo que devuelve cada lectura. */
function entorno({ respuestas, signOutLanza = false }) {
  const registro = { lecturas: 0, signOuts: 0, destino: null, cacheEscrita: null };
  const cola = [...respuestas];

  const supabase = {
    auth: {
      async signOut() {
        registro.signOuts++;
        if (signOutLanza) throw new Error('red caida');
      },
    },
    from() {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => {
          registro.lecturas++;
          return cola.length ? cola.shift() : { data: null, error: { message: 'sin respuestas' } };
        },
      };
      return q;
    },
  };

  const contexto = vm.createContext({
    UserRole, supabase,
    console: { log() {}, warn() {}, error() {} },
    Sentry: { captureException() {} },
    setTimeout, Promise,
    window: { get location() { return { set href(v) { registro.destino = v; } }; } },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    getCachedRole: () => null,
    setCachedRole: (_id, rol) => { registro.cacheEscrita = rol; },
    setMustChangePassword: () => {},
    exports: {},
  });
  // `window.location.href = x` con un setter en un getter no funciona; se
  // reemplaza por un objeto simple con setter real.
  vm.runInContext(`
    globalThis.window = { location: {} };
    Object.defineProperty(globalThis.window.location, 'href', {
      set(v) { globalThis.__destino = v; },
    });
  `, contexto);

  const preludio = `
    const ERROR_USUARIO_BLOQUEADO = 'Usuario bloqueado';
    const ERROR_VERIFICACION_NO_DISPONIBLE = 'Verificacion de cuenta no disponible';
    const REINTENTOS_PERFIL = ${/const REINTENTOS_PERFIL = (\d+)/.exec(authContext)[1]};
    const ESPERA_REINTENTO_MS = 1;  // en la prueba no se espera de verdad
    const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
    const cerrarSesionYRedirigir = async (destino) => ${cuerpoCerrarSesion};
    exports.determineUserRole = async (authUser, forceRefresh = false) => ${cuerpoDetermine};
  `;
  vm.runInContext(compilar(preludio), contexto);

  return {
    registro,
    contexto,
    determineUserRole: contexto.exports.determineUserRole,
    get destino() { return contexto.__destino ?? null; },
  };
}

const usuario = { id: 'u1', email: 'viajero@ejemplo.com', user_metadata: { role: 'agency' } };
const perfilOk = { data: { role: 'agency', email_verified: true, is_active: true, must_change_password: false }, error: null };
const fallo = { data: null, error: { message: 'timeout' } };

let ok = 0;
const casos = [];

// --- 1. La lectura falla siempre: NO se entra --------------------------------
casos.push(async () => {
  const e = entorno({ respuestas: [fallo, fallo, fallo, fallo, fallo] });
  await assert.rejects(
    () => e.determineUserRole(usuario, true),
    /Verificacion de cuenta no disponible/,
    'con el perfil ilegible NO debe devolverse un rol',
  );
  assert.equal(e.registro.signOuts, 1, 'debe cerrarse la sesion');
  assert.equal(e.destino, '/login?verificacion=fallida', 'debe redirigir con el motivo correcto');
  assert.equal(e.registro.cacheEscrita, null, 'no debe cachearse ningun rol');
});

// --- 2. Un parpadeo se reintenta y el usuario entra --------------------------
casos.push(async () => {
  const e = entorno({ respuestas: [fallo, perfilOk] });
  const r = await e.determineUserRole(usuario, true);
  assert.equal(r.role, 'agency', 'tras el reintento debe entrar normalmente');
  assert.equal(e.registro.lecturas, 2, 'debe haber reintentado exactamente una vez');
  assert.equal(e.registro.signOuts, 0, 'un parpadeo no debe echar a nadie');
});

// --- 3. El ultimo reintento salva la sesion ----------------------------------
casos.push(async () => {
  const e = entorno({ respuestas: [fallo, fallo, perfilOk] });
  const r = await e.determineUserRole(usuario, true);
  assert.equal(r.role, 'agency');
  assert.equal(e.registro.signOuts, 0);
});

// --- 4. Cuenta bloqueada: sigue bloqueada, con su propio motivo --------------
casos.push(async () => {
  const e = entorno({ respuestas: [{ data: { role: 'agency', email_verified: true, is_active: false }, error: null }] });
  await assert.rejects(() => e.determineUserRole(usuario, true), /Usuario bloqueado/);
  assert.equal(e.destino, '/login?blocked=true', 'un bloqueado no debe ver el mensaje de "no pudimos verificar"');
  assert.equal(e.registro.lecturas, 1, 'un bloqueo no es un error: no se reintenta');
});

// --- 5. Fila inexistente (alta en curso): NO es un fallo ---------------------
casos.push(async () => {
  const e = entorno({ respuestas: [{ data: null, error: null }] });
  const r = await e.determineUserRole(usuario, true);
  assert.equal(r.role, 'agency', 'sin fila y sin error se sigue de largo, como antes');
  assert.equal(e.registro.signOuts, 0);
  assert.equal(e.registro.lecturas, 1, 'sin error no hay nada que reintentar');
});

// --- 6. Si `signOut` tambien falla, la redireccion ocurre igual --------------
casos.push(async () => {
  const e = entorno({ respuestas: [fallo, fallo, fallo], signOutLanza: true });
  await assert.rejects(() => e.determineUserRole(usuario, true), /Verificacion de cuenta no disponible/);
  assert.equal(e.destino, '/login?verificacion=fallida', 'la red caida no puede dejar la denegacion a medias');
});

// --- 7. Camino feliz ---------------------------------------------------------
casos.push(async () => {
  const e = entorno({ respuestas: [perfilOk] });
  const r = await e.determineUserRole(usuario, true);
  // Campo por campo, no deepEqual: el objeto nace dentro del vm y su prototipo
  // no es el de este realm, asi que deepStrictEqual lo rechaza.
  assert.equal(r.role, 'agency');
  assert.equal(r.emailVerified, true);
  assert.equal(e.registro.lecturas, 1);
});

// ---------------------------------------------------------------------------
// Parte 2 — los dos `catch` que atrapaban la denegacion
// ---------------------------------------------------------------------------
//
// Esto no se ejecuta: se comprueba sobre el texto. Es a proposito. Los dos
// catch viven dentro de funciones enormes y llenas de estado de React, y lo
// que importa no es su comportamiento completo sino que sigan reconociendo los
// centinelas. Si alguien "simplifica" uno de los dos, esto se pone rojo.

casos.push(async () => {
  const catchDetermine = recortarBloque(
    authContext.slice(authContext.indexOf('const determineUserRole')),
    '} catch (err: any) {',
  );
  for (const centinela of ['ERROR_USUARIO_BLOQUEADO', 'ERROR_VERIFICACION_NO_DISPONIBLE']) {
    assert.ok(
      catchDetermine.includes(centinela),
      `el catch de determineUserRole ya no re-lanza ${centinela}: la denegacion se pierde y ` +
      'el usuario entra con el rol de su metadata',
    );
  }
});

casos.push(async () => {
  const catchUpdate = recortarBloque(
    authContext.slice(authContext.indexOf('const updateAuthState')),
    '} catch (err: any) {',
  );
  for (const centinela of ['ERROR_USUARIO_BLOQUEADO', 'ERROR_VERIFICACION_NO_DISPONIBLE']) {
    assert.ok(
      catchUpdate.includes(centinela),
      `el catch de updateAuthState ya no reconoce ${centinela}: cae en el fallback y ` +
      'concede el rol cacheado o TRAVELER',
    );
  }
});

// ---------------------------------------------------------------------------
// Parte 3 — el mismo chequeo en el login por contrasena (`src/lib/supabase.ts`)
// ---------------------------------------------------------------------------

const cuerpoSignIn = recortarBloque(
  libSupabase,
  'export const signIn = async (email: string, password: string, captchaToken?: string): Promise<SignInResult>',
  '=> {',
);

function entornoSignIn({ respuestas }) {
  const registro = { lecturas: 0, signOuts: 0 };
  const cola = [...respuestas];
  const supabase = {
    auth: {
      async signInWithPassword() { return { data: { user: { id: 'u1' } }, error: null }; },
      async signOut() { registro.signOuts++; },
    },
    from() {
      const q = {
        select: () => q, eq: () => q,
        maybeSingle: async () => {
          registro.lecturas++;
          return cola.length ? cola.shift() : { data: null, error: { message: 'sin respuestas' } };
        },
      };
      return q;
    },
  };
  const contexto = vm.createContext({
    supabase, setTimeout, Promise, exports: {},
    console: { log() {}, warn() {}, error() {} },
  });
  vm.runInContext(compilar(`exports.signIn = async (email, password, captchaToken) => ${cuerpoSignIn};`), contexto);
  return { registro, signIn: contexto.exports.signIn };
}

casos.push(async () => {
  const e = entornoSignIn({ respuestas: [fallo, fallo] });
  const { data, error } = await e.signIn('a@b.c', 'x');
  assert.equal(data, null, 'con el estado de la cuenta ilegible, signIn no debe devolver sesion');
  assert.equal(error?.message, 'VERIFICACION_NO_DISPONIBLE');
  assert.equal(e.registro.signOuts, 1, 'debe cerrarse la sesion que Supabase acaba de abrir');
  assert.equal(e.registro.lecturas, 2, 'debe reintentar una vez antes de negar');
});

casos.push(async () => {
  const e = entornoSignIn({ respuestas: [fallo, { data: { is_active: true }, error: null }] });
  const { data, error } = await e.signIn('a@b.c', 'x');
  assert.equal(error, null, 'un parpadeo no debe impedir el login');
  assert.ok(data?.user, 'debe devolverse la sesion');
  assert.equal(e.registro.signOuts, 0);
});

casos.push(async () => {
  const e = entornoSignIn({ respuestas: [{ data: { is_active: false }, error: null }] });
  const { error } = await e.signIn('a@b.c', 'x');
  assert.equal(error?.message, 'USUARIO_BLOQUEADO');
  assert.equal(e.registro.signOuts, 1);
});

casos.push(async () => {
  const e = entornoSignIn({ respuestas: [{ data: null, error: null }] });
  const { data, error } = await e.signIn('a@b.c', 'x');
  assert.equal(error, null, 'sin fila y sin error se entra: es el alta en curso');
  assert.ok(data?.user);
});

for (const caso of casos) {
  await caso();
  ok++;
}

console.log(`Auth falla cerrado: ${ok}/${casos.length} casos OK`);
