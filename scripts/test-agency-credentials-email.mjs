// Runs the actual handlers with isolated Auth, database and email dependencies.
// No network calls, users or emails are created.
//
// COMO FUNCIONA Y POR QUE SE ROMPIO
//
// El arnes borra los `import` del archivo y entrega cada binding a mano dentro
// del sandbox. Eso tiene una trampa: si una funcion estrena un import y aqui no
// hay stub, el identificador queda indefinido, el `catch` del handler lo atrapa
// y devuelve 500 — que es EXACTAMENTE lo que devuelve una regresion de verdad.
//
// Paso el 10-sep-2026: el commit 5440105 anadio `opcionesConContexto` a las tres
// funciones y esta prueba empezo a fallar con un escueto "500 !== 200" que no
// decia nada. La guardia `sinImports()` cierra ese hueco: lee los imports del
// propio archivo y exige un stub por cada binding, con nombre y todo.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compilar = fuente => ts.transpileModule(fuente, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

/**
 * Quita las declaraciones `import` y devuelve tambien los nombres que ataban,
 * para poder exigir un stub por cada uno. Va por el AST y no por una expresion
 * regular para no tragarse un import repartido en varias lineas.
 */
function sinImports(fuente, archivo) {
  const ast = ts.createSourceFile(archivo, fuente, ts.ScriptTarget.ES2022, true);
  const bindings = [];
  let texto = fuente;
  for (const decl of [...ast.statements].reverse()) {
    if (!ts.isImportDeclaration(decl)) continue;
    texto = texto.slice(0, decl.getStart(ast)) + texto.slice(decl.getEnd());
    const clausula = decl.importClause;
    if (!clausula || clausula.isTypeOnly) continue;
    if (clausula.name) bindings.push(clausula.name.text);
    const nombrados = clausula.namedBindings;
    if (!nombrados) continue;
    if (ts.isNamespaceImport(nombrados)) bindings.push(nombrados.name.text);
    else for (const e of nombrados.elements) if (!e.isTypeOnly) bindings.push(e.name.text);
  }
  return { texto, bindings };
}

// El helper de contexto se carga DE VERDAD, no se simula: asi la prueba tambien
// comprueba que cada funcion lo cablea bien al construir su cliente, que es lo
// que el commit 5440105 vino a arreglar y nadie vigilaba a este nivel.
const contexto = {};
vm.runInNewContext(
  compilar(readFileSync('supabase/functions/_shared/contextoAuditoria.ts', 'utf8')),
  { exports: contexto, module: { exports: contexto }, crypto },
);

const outcomes = {
  accepted: () => Response.json({ success: true }),
  unauthorized: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  serverError: () => Response.json({ error: 'Unavailable' }, { status: 500 }),
  falseSuccess: () => Response.json({ success: false }),
  missingAcknowledgement: () => Response.json({}),
  errorStatusWithSuccessBody: () => Response.json({ success: true }, { status: 500 }),
  invalidJson: () => new Response('<html>upstream error</html>'),
  nullJson: () => Response.json(null),
  networkError: () => { throw new TypeError('fetch failed'); },
  timeout: () => { throw new DOMException('Timed out', 'TimeoutError'); },
};
let passed = 0;
for (const slug of ['convert-lead-to-agency', 'fix-agency-email', 'resend-agency-credentials']) {
  for (const [outcome, respond] of Object.entries(outcomes)) {
    let handler;
    let authWrites = 0;
    let emailCalls = 0;
    let deadline;
    let opcionesDelCliente;
    const quejas = [];
    const agency = {
      id: 'agency', user_id: 'agency-user', name: 'Test Agency',
      contact_email: 'agency@example.invalid', account_executive_id: 'exec',
      onboarding_status: 'pending_documents',
    };
    const client = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'caller' } }, error: null }),
        admin: {
          createUser: async () => {
            authWrites++;
            return { data: { user: { id: 'agency-user' } }, error: null };
          },
          updateUserById: async () => { authWrites++; return { error: null }; },
          deleteUser: () => { throw new Error('Must not roll back Auth on email failure'); },
        },
      },
      from(table) {
        const query = {
          select() { return query; }, eq() { return query; },
          insert() { return query; }, update() { return query; },
          delete() { throw new Error('Must not roll back data on email failure'); },
          single: async () => ({ data: agency, error: null }),
          maybeSingle: async () => ({
            data: table === 'users' ? { role: 'account_executive' }
              : table === 'account_executives' ? {
                id: 'exec', is_active: true, first_name: 'Test', email: 'exec@example.invalid',
              } : table === 'agencies' ? agency
                : { contact_first_name: 'Test', contact_last_name: 'Agency' },
            error: null,
          }),
          then(resolve, reject) {
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          },
        };
        return query;
      },
    };
    const archivo = `supabase/functions/${slug}/index.ts`;
    const { texto, bindings } = sinImports(readFileSync(archivo, 'utf8'), archivo);
    const sandbox = {
      exports: {}, Request, Response, crypto,
      // Las quejas se guardan en vez de tirarse: si algo revienta dentro del
      // handler, el mensaje del assert lo trae y no hay que adivinar.
      console: { log() {}, warn() {}, error: (...args) => quejas.push(args.map(String).join(' ')) },
      AbortSignal: { timeout(ms) { deadline = ms; return new AbortController().signal; } },
      Deno: {
        env: { get: name => ({
          SUPABASE_URL: 'https://project.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
        })[name] },
        serve: fn => { handler = fn; },
      },
      Sentry: { init() {}, captureException() {}, flush: async () => {} },
      opcionesConContexto: contexto.opcionesConContexto,
      createClient: (_url, _key, opciones) => { opcionesDelCliente = opciones; return client; },
      fetch: async (url, init) => {
        emailCalls++;
        assert.equal(url, 'https://project.invalid/functions/v1/send-agency-credentials');
        assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-service');
        const body = JSON.parse(init.body);
        assert.equal(body.email, slug === 'fix-agency-email' ? 'changed@example.invalid' : 'agency@example.invalid');
        assert.equal(body.password.length, 12);
        return respond();
      },
    };
    for (const binding of bindings) {
      assert.ok(
        binding in sandbox,
        `${slug}: el archivo importa "${binding}" y el sandbox no lo define; sin stub queda `
        + 'indefinido y el handler devolveria 500 como si fuera una regresion',
      );
    }
    vm.runInNewContext(compilar(texto), sandbox);
    const response = await handler(new Request('https://project.invalid', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-user',
        'x-forwarded-for': '203.0.113.7, 10.0.0.1',
        'user-agent': 'Prueba/1.0',
      },
      body: JSON.stringify({
        leadId: 'lead', agencyId: 'agency', agencyName: 'Test Agency',
        contactEmail: 'agency@example.invalid', contactFirstName: 'Test',
        personaType: 'persona_fisica', representanteLegalNombre: 'Test',
        newEmail: 'changed@example.invalid',
      }),
    }));
    const result = await response.json();
    assert.equal(response.status, 200,
      `${slug}/${outcome}: mutation remains successful${quejas.length ? ` — ${quejas.join(' | ')}` : ''}`);
    assert.equal(result.success, true);
    assert.equal(result.emailSent, outcome === 'accepted', `${slug}/${outcome}: acknowledgement`);
    assert.equal(authWrites, 1, 'Never repeat account creation/password reset');
    assert.equal(emailCalls, 1, 'No automatic email retries');
    assert.equal(deadline, 15000);
    // El origen del CLIENTE viaja a PostgREST, no el de la funcion: es lo que
    // hace que la bitacora que escriban los triggers salga con la IP correcta.
    const cabeceras = opcionesDelCliente?.global?.headers ?? {};
    assert.equal(cabeceras['x-forwarded-for'], '203.0.113.7',
      `${slug}/${outcome}: se reenvia la IP del cliente, la primera de la lista`);
    assert.equal(cabeceras['user-agent'], 'Prueba/1.0', `${slug}/${outcome}: se reenvia el user agent`);
    assert.match(cabeceras['x-correlation-id'] ?? '', /^[0-9a-f-]{36}$/,
      `${slug}/${outcome}: se abre correlacion para la peticion`);
    assert.equal(opcionesDelCliente?.auth?.persistSession, false,
      `${slug}/${outcome}: el contexto no pisa las opciones propias de la funcion`);
    if (slug === 'convert-lead-to-agency') assert.equal(result.agencyId, 'agency');
    if (slug === 'fix-agency-email') assert.equal(result.newEmail, 'changed@example.invalid');
    if (slug === 'resend-agency-credentials') assert.equal(result.email, 'agency@example.invalid');
    passed++;
  }
}
console.log(`${passed} agency credentials email checks passed (isolated; no external effects).`);
