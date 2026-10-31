// Contratos de lo que se rescato del PR #472 (cambio de vehiculo por salida con aviso al viajero) y que el #487 no traia.
//
//   A. La migracion: columnas, enum, el nucleo todo-o-nada, la puerta de la agencia, la reseleccion del viajero y los permisos de cada funcion.
//   B. La cadena de migraciones del repo reproduce la base: la columna tour_slots.vehicle_map_type se crea ANTES de usarse (antes solo existia
//      porque alguien aplico a mano parte de la rama del #472 y una base nueva fallaba).
//   C. Edge Functions: el aviso por correo (solo la agencia dueña, solo lo reciente) y la reprogramacion con vehiculo distinto.
//   D. El front: modal multi-salida, gestor, selector del viajero y la reseleccion con su texto.
//   E. Se EJECUTA `tipoDeMapaEfectivo` con un cliente falso: el horario con vehiculo propio se distingue del que hereda el del tour.
//
// Lo que NO prueba: el SQL contra la base (solo su texto), ni el correo real, ni la pantalla en un navegador.
//
//   node --experimental-strip-types --no-warnings scripts/test-vehiculo-por-salida-con-aviso.mjs   (Node 24: sin las banderas)
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const { tipoDeMapaEfectivo } = await import('../src/lib/mapaDeAsientos.ts');

const leer = (ruta) => readFileSync(new URL('../' + ruta, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/ .*$/gm, '$1');
const sinComentariosSql = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');

let casos = 0;
const prueba = async (nombre, fn) => { try { await fn(); casos++; } catch (e) { console.error(`FALLA: ${nombre}`); throw e; } };

const ENUM = 'supabase/migrations/20261031052317_tipo_notificacion_cambio_de_vehiculo.sql';
const MIG = 'supabase/migrations/20261031052359_vehiculo_por_salida_cambio_con_aviso.sql';
const MIG_487 = 'supabase/migrations/20261031041937_mapa_por_horario_y_capacidad_tope.sql';
const sql = sinComentariosSql(leer(MIG));
const sql487 = sinComentariosSql(leer(MIG_487));

// ── A. La migracion ─────────────────────────────────────────────────────────
await prueba('el valor de enum va en su propio archivo (no se puede usar en la misma transaccion) y es idempotente', async () => {
  assert.match(sinComentariosSql(leer(ENUM)), /ALTER TYPE public\.notification_type ADD VALUE IF NOT EXISTS 'slot_vehicle_changed';/);
  assert.doesNotMatch(sql, /ADD VALUE/, 'el valor nuevo no puede agregarse y usarse en la misma transaccion');
});
await prueba('las dos columnas se crean con IF NOT EXISTS: no cambian nada en produccion y SI crean en una base nueva', async () => {
  assert.match(sql, /add column if not exists vehicle_map_type text references public\.vehicle_seat_layouts\(type\)/);
  assert.match(sql, /add column if not exists seat_reselection_reason text/);
});
await prueba('toda funcion es CREATE OR REPLACE: la migracion se puede reaplicar sin romper', async () => {
  assert.doesNotMatch(sql, /^create function /m);
  assert.equal((sql.match(/create or replace function /gi) || []).length, 4, 'nucleo, puerta, change_booking_seats y reseleccion');
});
await prueba('el nucleo valida TODAS las salidas antes de tocar una (todo o nada): cancelada, pasada, viajeros pagando y capacidad vs vendidos', async () => {
  const crudo = leer(MIG);
  assert.match(crudo, /-- Fase 1: validar todas\. Todo o nada\./i);
  assert.match(sql, /raise exception 'La salida del % esta cancelada'/);
  assert.match(sql, /raise exception 'La salida del % ya paso'/);
  assert.match(sql, /seat_holds h\s+where h\.tour_id=p_tour_id and h\.slot_id=s\.id and h\.expires_at>now\(\)/);
  assert.match(sql, /if v_cap<coalesce\(v_used,0\) then/);
  assert.match(sql, /if v_cap<1 or v_cap>l\.capacity then/);
  assert.ok(crudo.indexOf('Fase 1') >= 0 && crudo.indexOf('Fase 1') < crudo.indexOf('Fase 2'), 'validar antes de aplicar');
});
await prueba('al cambiar el vehiculo: se sueltan los asientos de la salida, las reservas quedan para reelegir con su razon y reciben notificacion', async () => {
  assert.match(sql, /delete from public\.slot_seat_status where tour_id=p_tour_id and slot_id=s\.id;/);
  assert.match(sql, /needs_seat_reselection=true,\s+seat_reselection_reason='vehicle_change'/);
  assert.match(sql, /previous_selected_seats=case when cardinality\(coalesce\(selected_seats,'\{\}'\)\)>0 then selected_seats else previous_selected_seats end/);
  assert.match(sql, /'slot_vehicle_changed'::public\.notification_type/);
  assert.match(sql, /if v_changed then/);
});
await prueba('el nucleo escribe vehiculo y capacidad en UN update (el trigger de capacidad <= asientos los ve juntos) y vuelve a NULL si es el del tour', async () => {
  assert.match(sql, /set vehicle_map_type=case when v_new=t\.vehicle_map_type then null else v_new end,\s+capacity=v_cap, updated_at=now\(\)/);
});
await prueba('permisos: el nucleo solo para el servidor; la puerta y la reseleccion para usuarios con sesion y NADA para anon', async () => {
  assert.match(sql, /revoke all on function public\.slot_vehicle_change_core\(uuid,uuid\[\],text,integer\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.slot_vehicle_change_core\(uuid,uuid\[\],text,integer\) to service_role;/);
  assert.match(sql, /revoke all on function public\.change_slots_vehicle\(uuid,uuid\[\],text,integer\) from public, anon;/);
  assert.match(sql, /grant execute on function public\.change_slots_vehicle\(uuid,uuid\[\],text,integer\) to authenticated;/);
  assert.match(sql, /revoke all on function public\.reselect_booking_seats\(uuid,integer\[\]\) from public, anon;/);
  assert.match(sql, /grant execute on function public\.reselect_booking_seats\(uuid,integer\[\]\) to authenticated;/);
  assert.doesNotMatch(sql, /grant execute on function[^\n]*to (anon|public)\b/);
});
await prueba('la puerta de la agencia exige sesion y permiso de gestionar el tour (external_sale_access manage); sin ellos 42501', async () => {
  const puerta = sql.slice(sql.indexOf('create or replace function public.change_slots_vehicle'), sql.indexOf('revoke all on function public.change_slots_vehicle'));
  assert.match(puerta, /if auth\.uid\(\) is null then raise exception 'No autorizado' using errcode='42501'; end if;/);
  assert.match(puerta, /not public\.external_sale_access\(v_agency,'manage'\)/);
  assert.match(puerta, /return public\.slot_vehicle_change_core\(p_tour_id,p_slot_ids,p_vehicle_map_type,p_capacity\);/);
});
await prueba('la reseleccion valida duenio, reserva marcada, cantidad, existencia en el mapa, disponibilidad y apartados; es todo o nada', async () => {
  const rs = sql.slice(sql.indexOf('create or replace function public.reselect_booking_seats'));
  assert.match(rs, /b\.user_id<>auth\.uid\(\)/);
  assert.match(rs, /not coalesce\(b\.needs_seat_reselection,false\)/);
  assert.match(rs, /v_map:=public\.effective_vehicle_map_type\(b\.tour_id,b\.slot_id\)/);
  assert.match(rs, /coalesce\(e->>'type','normal'\) not in \('driver','wc'\)/);
  assert.match(rs, /h\.expires_at>now\(\)/);
  assert.match(rs, /needs_seat_reselection=false, seat_reselection_reason=null/);
});
await prueba('change_booking_seats (la de #487, con el mapa efectivo) ahora tambien limpia la razon de reseleccion', async () => {
  // change_booking_seats viene de la migracion de #487 (en mayusculas): se busca sin distinguir mayusculas.
  const bajo = sql.toLowerCase();
  const cb = sql.slice(bajo.indexOf('create or replace function public.change_booking_seats'), bajo.indexOf('create or replace function public.reselect_booking_seats'));
  assert.ok(cb.length > 500, 'no se encontro change_booking_seats en la migracion');
  assert.match(cb, /v_map := public\.effective_vehicle_map_type\(b\.tour_id, b\.slot_id\)/);
  assert.match(cb, /needs_seat_reselection=false, seat_reselection_reason=null/);
  assert.doesNotMatch(cb, /t\.vehicle_map_type/, 'volvio a leerse el mapa del tour');
});

// ── B. La cadena de migraciones reproduce la base ──────────────────────────
await prueba('la migracion de #487 crea la columna ANTES de usarla (antes dependia de que alguien la hubiera aplicado a mano)', async () => {
  const col = sql487.indexOf('ADD COLUMN IF NOT EXISTS vehicle_map_type');
  assert.ok(col >= 0, 'falta el ADD COLUMN IF NOT EXISTS');
  assert.ok(col < sql487.indexOf('FUNCTION public.effective_vehicle_map_type'), 'la columna va antes de la funcion que la lee');
  assert.ok(col < sql487.indexOf('CREATE TRIGGER trg_validar_capacidad_de_horario'), 'y antes del trigger que la nombra');
  assert.match(sql487, /REFERENCES public\.vehicle_seat_layouts\(type\)/);
});
await prueba('no se agregaron migraciones con fecha vieja (20261024*): exigirian --include-all, que aplica TODO lo no registrado', async () => {
  const nombres = readdirSync(new URL('../supabase/migrations/', import.meta.url));
  assert.deepEqual(nombres.filter((n) => n.startsWith('20261024')), []);
  assert.ok(nombres.includes(ENUM.split('/').pop()) && nombres.includes(MIG.split('/').pop()));
  const orden = [MIG_487, ENUM, MIG].map((m) => m.split('/').pop());
  assert.deepEqual([...orden].sort(), orden, 'el orden de aplicacion es el de los nombres');
});

// ── C. Edge Functions ──────────────────────────────────────────────────────
const aviso = sinComentarios(leer('supabase/functions/notify-slot-vehicle-change/index.ts'));
await prueba('el aviso por correo: exige usuario, y que sea quien gestiona el tour o admin (nadie manda correos a viajeros de otra agencia)', async () => {
  assert.match(aviso, /await requireUser\(req, \{ recurso: "notify-slot-vehicle-change"/);
  assert.match(aviso, /if \(!auth\.llamador\.esServiceRole && !auth\.llamador\.esAdmin\) \{/);
  assert.match(aviso, /rpc\("external_sale_access", \{ p_agency_id: tour\.agency_id, p_action: "manage" \}\)/);
  assert.match(aviso, /if \(permitido !== true\) return respuesta\(\{ error: "No tienes permiso sobre este tour" \}, 403\)/);
});
await prueba('el aviso solo toca lo reciente y lo marcado por el cambio de vehiculo, con tope de salidas y HTML escapado', async () => {
  assert.match(aviso, /slot_ids\.length > 200\)/);
  assert.match(aviso, /\.eq\("needs_seat_reselection", true\)\s+\.eq\("seat_reselection_reason", "vehicle_change"\)\s+\.gte\("updated_at", desde\)/);
  assert.match(aviso, /const VENTANA_MS = 15 \* 60 \* 1000;/);
  assert.match(aviso, /const nombre = escapar\(r\.user\?\.first_name \|\| "viajero"\);/);
  assert.match(aviso, /enviarCorreoSimple\(admin, email,/);
  assert.doesNotMatch(aviso, /fetch\(/, 'todo correo sale por el modulo de correo, nunca por fetch directo');
});
const responder = sinComentarios(leer('supabase/functions/respond-to-slot-reschedule/index.ts'));
await prueba('al mover una reserva a una salida con OTRO vehiculo se pide elegir de nuevo aunque el numero exista en los dos mapas', async () => {
  assert.match(responder, /async function vehiculoDistinto\(/);
  assert.match(responder, /return origen\.data !== destino\.data;/);
  assert.match(responder, /if \(origen\.error \|\| destino\.error\) return true;/, 'si no se puede saber, lo seguro es pedir que elija de nuevo');
  assert.match(responder, /if \(!forceReselection && availableOriginalSeats\.length >= travelersCount\) \{/);
  assert.equal((responder.match(/await vehiculoDistinto\(adminClient, booking\.tour_id, booking\.slot_id \?\? null,/g) || []).length, 2, 'las dos ramas de aceptacion');
  assert.match(responder, /travelers_count, slot_id"\)/, 'hace falta la salida de origen para compararla');
});
await prueba('la razon de reseleccion de un reagendado es NULL (no arrastra vehicle_change) y se limpia al asignar', async () => {
  assert.match(responder, /seat_reselection_reason: null,\s+previous_selected_seats: originalSeats/);
  assert.match(responder, /\.update\(\{ selected_seats: seatsToUse, needs_seat_reselection: false, seat_reselection_reason: null \}\)/);
});

// ── D. El front ────────────────────────────────────────────────────────────
const modal = sinComentarios(leer('src/components/seats/SlotVehicleChangeModal.tsx'));
await prueba('el modal cambia el vehiculo por la RPC y manda el correo solo si hubo reservas por reelegir; si el correo falla, avisa pero no deshace', async () => {
  assert.match(modal, /supabase\.rpc\('change_slots_vehicle', \{\s+p_tour_id: tourId,\s+p_slot_ids: selected,/);
  assert.match(modal, /if \(res\.bookings_to_reselect > 0\) \{[\s\S]*?functions\.invoke\('notify-slot-vehicle-change'/);
  assert.match(modal, /if \(mailError\) setMailFailed\(true\);/);
  assert.match(modal, /disabled=\{submitting \|\| selected\.length === 0 \|\| !capacityValid \|\| capacityBelowSold\}/);
});
await prueba('el modal avisa a la agencia que se liberan asientos y bloqueos, y que hay bloqueos generales que no distinguen vehiculo', async () => {
  assert.match(modal, /affectsExisting/);
  assert.match(modal, /result\.blocks_released > 0 \|\| result\.external_seats_released > 0/);
  assert.match(modal, /result\.global_blocks > 0/);
});
const gestor = sinComentarios(leer('src/components/seats/SeatMapManager.tsx'));
await prueba('el gestor de asientos ofrece «Cambiar vehiculo de salidas», marca los horarios con vehiculo propio y refresca al terminar', async () => {
  assert.match(gestor, /import SlotVehicleChangeModal from '\.\/SlotVehicleChangeModal';/);
  assert.match(gestor, /\.select\('id, slot_date, departure_time, capacity, booked_count, status, vehicle_map_type'\)/);
  assert.match(gestor, /lugares\{slot\.vehicle_map_type \? ' · vehiculo propio' : ''\}/);
  assert.match(gestor, /Cambiar vehiculo de salidas/);
  assert.match(gestor, /onDone=\{\(\) => \{ setVehicleModalOpen\(false\); void loadSlots\(\); void loadData\(\); \}\}/);
});
const picker = sinComentarios(leer('src/components/seats/SeatMapPicker.tsx'));
await prueba('el selector del viajero ignora los bloqueos generales de la agencia cuando la salida tiene vehiculo propio (son por numero del mapa del tour)', async () => {
  assert.match(picker, /const aplicaBloqueoGlobal = !mapa\.propio;/);
  assert.match(picker, /aplicaBloqueoGlobal\s+\? supabase/);
  assert.match(picker, /: Promise\.resolve\(\{ data: \[\] as SlotSeatStatusRow\[\], error: null \}\)/);
});
const reselec = sinComentarios(leer('src/components/SeatReselectionModal.tsx'));
await prueba('el viajero reelige por reselect_booking_seats (valida duenio, mapa y disponibilidad), no por reserve_seats que confia en el cliente', async () => {
  assert.match(reselec, /\.rpc\('reselect_booking_seats', \{ p_booking_id: bookingId, p_seats: selectedSeats \}\)/);
  assert.doesNotMatch(reselec, /rpc\('reserve_seats'/);
  assert.match(reselec, /reason === 'vehicle_change'/);
  assert.match(reselec, /Cambio de transporte en tu salida/);
});
const viajero = sinComentarios(leer('src/pages/traveler/TravelerBookings.tsx'));
await prueba('Mis reservas muestra el motivo correcto (cambio de transporte vs reagendado) y se lo pasa al modal', async () => {
  assert.match(viajero, /booking\.seat_reselection_reason === 'vehicle_change'/);
  assert.match(viajero, /reason: booking\.seat_reselection_reason,/);
  assert.match(viajero, /reason=\{seatReselectionModal\.reason\}/);
  assert.match(sinComentarios(leer('src/lib/supabase.ts')), /needs_seat_reselection, seat_reselection_reason, discount_amount/);
});

// ── E. Se ejecuta: horario con vehiculo propio vs el que hereda ───────────
function clienteFalso({ tour, slot, errTour = null, errSlot = null }) {
  return {
    from(tabla) {
      const q = { select() { return q; }, eq() { return q; }, async maybeSingle() { return tabla === 'tours' ? { data: tour, error: errTour } : { data: slot, error: errSlot }; } };
      return q;
    },
  };
}
await prueba('un horario con vehiculo propio manda sobre el del tour y se marca `propio`', async () => {
  const r = await tipoDeMapaEfectivo(clienteFalso({ tour: { vehicle_map_type: 'sprinter_20' }, slot: { vehicle_map_type: 'bus_60_2pisos', capacity: 60 } }), 'tour-1', 'slot-1');
  assert.deepEqual([r.tipo, r.propio, r.capacidadDelHorario, r.error], ['bus_60_2pisos', true, 60, false]);
});
await prueba('un horario sin vehiculo propio hereda el del tour y NO es `propio` (asi los bloqueos generales si le aplican)', async () => {
  const r = await tipoDeMapaEfectivo(clienteFalso({ tour: { vehicle_map_type: 'sprinter_20' }, slot: { vehicle_map_type: null, capacity: 20 } }), 'tour-1', 'slot-1');
  assert.deepEqual([r.tipo, r.propio, r.capacidadDelHorario, r.error], ['sprinter_20', false, 20, false]);
});
await prueba('sin horario (excursion) usa el del tour; si algo falla se reporta error y nunca `propio`', async () => {
  assert.deepEqual((await tipoDeMapaEfectivo(clienteFalso({ tour: { vehicle_map_type: 'hiace_14' }, slot: null }), 'tour-1', null)).propio, false);
  const e1 = await tipoDeMapaEfectivo(clienteFalso({ tour: null, slot: null, errTour: { message: 'x' } }), 'tour-1', 'slot-1');
  assert.deepEqual([e1.error, e1.propio, e1.tipo], [true, false, null]);
  const e2 = await tipoDeMapaEfectivo(clienteFalso({ tour: { vehicle_map_type: 'sprinter_20' }, slot: null, errSlot: { message: 'x' } }), 'tour-1', 'slot-1');
  assert.deepEqual([e2.error, e2.propio, e2.tipo], [true, false, null]);
});

console.log(`OK: ${casos} comprobaciones (cambio de vehiculo por salida con aviso: migracion, cadena de migraciones, Edge Functions y front).`);
