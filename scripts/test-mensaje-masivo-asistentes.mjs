// Contratos del mensaje masivo de una agencia a los asistentes de un tour (send-tour-mass-message).
// 23-oct-2026: «No se pudieron enviar los mensajes». La consola decia 500 «Error al obtener los asistentes» y el log de la funcion
// «P0001 No autorizado». La causa: la funcion pedia los asistentes con el SERVICE ROLE, y get_tour_confirmed_attendees decide por
// auth.uid() (la endurecio la migracion del 31-ago-2026 porque entregaba correo y nombre de los viajeros de CUALQUIER tour). Con el
// service role auth.uid() es NULL y siempre responde «No autorizado»: desde esa fecha ningun envio masivo funcionaba.
// Lo que se afirma aqui:
//   1. los asistentes se piden con la SESION de quien envia, no con el service role;
//   2. la proteccion de la base de datos NO se relaja para arreglarlo (esa funcion sigue exigiendo ser de la agencia, o admin);
//   3. antes de pedir los asistentes la funcion ya valido que quien envia es el dueño o personal con permiso, y que el tour es de la agencia.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const leer = (ruta) => readFileSync(new URL('../' + ruta, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sinComentarios = (t) => t.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('--') && !l.trim().startsWith('*')).join('\n');

const fn = sinComentarios(leer('supabase/functions/send-tour-mass-message/index.ts'));
const rls = sinComentarios(leer('supabase/migrations/20260831031622_fix_tour_attendees_pii_and_lockdown_unused_seatmap.sql'));

let casos = 0;
const prueba = (nombre, f) => { f(); casos++; };

prueba('los asistentes se piden con un cliente que lleva la sesion de quien envia, no con el service role', () => {
  assert.match(fn, /const usuario = createClient\(supabaseUrl, Deno\.env\.get\("SUPABASE_ANON_KEY"\)!, \{\s+global: \{ headers: \{ Authorization: authHeader \} \},\s+\}\);/);
  assert.match(fn, /await usuario\.rpc\(\s+"get_tour_confirmed_attendees"/);
  assert.ok(!/supabase\.rpc\(\s+"get_tour_confirmed_attendees"/.test(fn), 'ya no se pide con el service role');
  assert.equal((fn.match(/get_tour_confirmed_attendees/g) ?? []).length, 1, 'un solo sitio la llama');
});

prueba('la proteccion de la base de datos sigue en pie: sin sesion de la agencia (o admin) responde «No autorizado»', () => {
  assert.match(rls, /v_belongs_to_agency boolean;/);
  assert.match(rls, /IF NOT v_belongs_to_agency AND COALESCE\(v_caller_role, ''\) NOT IN \('admin', 'super_admin'\) THEN\s+RAISE EXCEPTION 'No autorizado';/);
  assert.ok(!/service_role|auth\.uid\(\) IS NULL/.test(rls.slice(rls.indexOf('get_tour_confirmed_attendees'), rls.indexOf('REVOKE EXECUTE'))),
    'arreglarlo NO es abrir la funcion al service role: el PII de los viajeros sigue protegido');
});

prueba('antes de pedir los asistentes se valida la sesion, que sea dueño o personal con permiso, y que el tour sea de la agencia', () => {
  const rpc = fn.indexOf('await usuario.rpc(');
  assert.ok(rpc > -1);
  for (const previo of ['supabase.auth.getUser(token)', 'const isOwner = agency.user_id === user.id;', 'can_manage_tours', 'No tienes permiso para enviar mensajes de esta agencia', '.eq("agency_id", agency_id)']) {
    const i = fn.indexOf(previo);
    assert.ok(i > -1 && i < rpc, `«${previo}» va ANTES de pedir los asistentes`);
  }
});

prueba('un fallo al obtener los asistentes sigue siendo un error explicito (no se envia a nadie) y no se traga', () => {
  assert.match(fn, /if \(attendeesError\) \{\s+console\.error\("Error fetching attendees:", attendeesError\);/);
  assert.match(fn, /Error al obtener los asistentes/);
});

console.log(`OK: ${casos} casos del mensaje masivo a asistentes.`);
