// Contratos del arreglo "mapa de asientos por horario y capacidad como tope" (31-oct-2026).
//
//   A. La regla (pura, se EJECUTA): la capacidad puede ser menor que los asientos del vehiculo, nunca mayor; los cupos siguen al vehiculo mientras
//      no se hayan personalizado; el mapa efectivo es el del horario y, si no tiene propio, el del tour.
//   B. Quien lee el mapa: el selector de asientos, el gestor de la agencia y el mapa de la agenda lo leian del TOUR y jamas del horario. Aqui se
//      verifica que ya nadie lea `tours.vehicle_map_type` directo para dibujar un mapa, y que las Edge Functions usan el efectivo.
//   C. La reprogramacion con vehiculo nuevo escribia en `tours` y cambiaba el mapa de TODAS las salidas; ahora escribe en el horario.
//   D. La migracion: triggers de capacidad <= asientos y de asiento en el mapa, y las dos funciones que validaban contra el tour.
//
// Lo que NO prueba: el efecto de la migracion contra la base ni la pantalla en un navegador; eso se mide despues de aplicar.
//
//   node --experimental-strip-types --no-warnings scripts/test-mapa-por-horario.mjs   (Node 24: sin las banderas)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { evaluarCapacidad, cuposSugeridos, mapaEfectivo, opcionDeVehiculo, OPCIONES_DE_VEHICULO } = await import('../src/lib/mapaDeAsientos.ts');

const leer = (ruta) => readFileSync(new URL('../' + ruta, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/ .*$/gm, '$1');
const sinComentariosSql = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');

let casos = 0;
const prueba = (nombre, fn) => { try { fn(); casos++; } catch (e) { console.error(`FALLA: ${nombre}`); throw e; } };

// ── A. La regla ─────────────────────────────────────────────────────────────
prueba('capacidad MENOR que el mapa es valida (un lugar con menos cupo que el autobus): solo informa', () => {
  const r = evaluarCapacidad(20, 60);
  assert.equal(r.estado, 'menor');
  assert.match(r.mensaje, /20 de los 60 asientos/);
});
prueba('capacidad MAYOR que el mapa es invalida', () => {
  const r = evaluarCapacidad(61, 60);
  assert.equal(r.estado, 'excede');
  assert.match(r.mensaje, /\(61\).*\(60\)/);
});
prueba('capacidad igual al mapa: sin aviso; sin mapa o sin capacidad: nada que evaluar', () => {
  assert.equal(evaluarCapacidad(60, 60).estado, 'igual');
  assert.equal(evaluarCapacidad(20, null).estado, 'sin_mapa');
  assert.equal(evaluarCapacidad(20, 0).estado, 'sin_mapa');
  assert.equal(evaluarCapacidad(0, 60).estado, 'sin_capacidad');
  assert.equal(evaluarCapacidad(null, 60).estado, 'sin_capacidad');
  assert.equal(evaluarCapacidad(NaN, 60).estado, 'sin_capacidad');
});
prueba('el limite exacto: un cupo mas que el mapa excede, uno menos solo informa', () => {
  assert.equal(evaluarCapacidad(14, 14).estado, 'igual');
  assert.equal(evaluarCapacidad(15, 14).estado, 'excede');
  assert.equal(evaluarCapacidad(13, 14).estado, 'menor');
});
prueba('el mapa efectivo es el del horario y, si no tiene propio, el del tour', () => {
  assert.equal(mapaEfectivo('bus_60_2pisos', 'sprinter_20'), 'bus_60_2pisos');
  assert.equal(mapaEfectivo(null, 'sprinter_20'), 'sprinter_20');
  assert.equal(mapaEfectivo(undefined, 'sprinter_20'), 'sprinter_20');
  assert.equal(mapaEfectivo('', 'sprinter_20'), 'sprinter_20');
  assert.equal(mapaEfectivo(null, null), null);
});
prueba('los cupos siguen al vehiculo mientras no se personalicen', () => {
  assert.equal(cuposSugeridos('', null, 'bus_60_2pisos'), '60', 'vacios -> los del vehiculo');
  assert.equal(cuposSugeridos(null, null, 'sprinter_20'), '20');
  assert.equal(cuposSugeridos('20', 'sprinter_20', 'bus_60_2pisos'), '60', 'eran los del vehiculo anterior -> siguen al nuevo');
  assert.equal(cuposSugeridos('60', 'bus_60_2pisos', 'sprinter_20'), '20');
});
prueba('un cupo propio (20 en un autobus de 60) se RESPETA al cambiar de vehiculo', () => {
  assert.equal(cuposSugeridos('35', 'bus_60_2pisos', 'bus_50'), '35');
  assert.equal(cuposSugeridos('20', 'bus_60_2pisos', 'bus_50'), '20');
});
prueba('quitar el vehiculo no toca los cupos', () => {
  assert.equal(cuposSugeridos('20', 'sprinter_20', null), '20');
});
prueba('las opciones de vehiculo coinciden con los mapas que existen (13/14/20/50/60)', () => {
  assert.deepEqual(OPCIONES_DE_VEHICULO.map((o) => [o.type, o.capacity]).sort(), [['bus_50', 50], ['bus_60_2pisos', 60], ['hiace_14', 14], ['sprinter_20', 20], ['urvan_13', 13]]);
  assert.equal(opcionDeVehiculo('bus_60_2pisos')?.capacity, 60);
  assert.equal(opcionDeVehiculo('no_existe'), null);
});

// ── B. Quien lee el mapa ───────────────────────────────────────────────────
const picker = sinComentarios(leer('src/components/seats/SeatMapPicker.tsx'));
const gestor = sinComentarios(leer('src/components/seats/SeatMapManager.tsx'));
const agenda = sinComentarios(leer('src/components/agenda/seatMapData.ts'));
prueba('el selector de asientos lee el mapa del HORARIO (con el del tour de respaldo), no el del tour a secas', () => {
  assert.match(picker, /tipoDeMapaEfectivo\(supabase, tourId, slotId\)/);
  assert.doesNotMatch(picker, /\.from\('tours'\)\s*\.select\('vehicle_map_type'\)/);
});
prueba('el gestor de la agencia lee el mapa del horario activo', () => {
  assert.match(gestor, /tipoDeMapaEfectivo\(supabase, tourId, activeSlotId\)/);
  assert.doesNotMatch(gestor, /\.from\('tours'\)\s*\.select\('vehicle_map_type'\)/);
});
prueba('el mapa de la agenda (y quien pregunta si hay mapa) reciben la salida', () => {
  assert.match(agenda, /export function useLayout\(tourId: string, slotId\?: string \| null\)/);
  assert.match(agenda, /queryKey: \['agenda-seat-layout', tourId, slotId \?\? null\]/);
  assert.match(agenda, /export function useHasSeatMap\(tourId: string, slotId\?: string \| null\)/);
  assert.doesNotMatch(agenda, /from\('tours'\)\.select\('vehicle_map_type'\)/);
  assert.match(sinComentarios(leer('src/components/agenda/AgendaSeatMap.tsx')), /useLayout\(tourId, slotId\)/);
  assert.match(sinComentarios(leer('src/components/agenda/DepartureDetail.tsx')), /useHasSeatMap\(op\.tour_id, op\.slot_id\)/);
  assert.match(sinComentarios(leer('src/components/agenda/DepartureDetail.tsx')), /slotId=\{op\.slot_id\} seats=/);
  assert.match(sinComentarios(leer('src/components/external-sales/ExternalSaleForm.tsx')), /useHasSeatMap\(op\?\.tour_id\?\?'',op\?\.slot_id\)/);
});
prueba('el selector avisa cuando el horario vende menos asientos que el vehiculo', () => {
  assert.match(picker, /capacidadHorario !== null && capacidadHorario < layout\.capacity/);
  assert.match(picker, /Este horario vende \{capacidadHorario\} de los \{layout\.capacity\} asientos del vehiculo/);
});
const lib = sinComentarios(leer('src/lib/mapaDeAsientos.ts'));
prueba('la lectura del mapa del horario filtra por tour Y horario (un horario ajeno no puede aportar su vehiculo)', () => {
  assert.match(lib, /\.from\('tour_slots'\)\s*\.select\('vehicle_map_type, capacity'\)\s*\.eq\('id', slotId\)\s*\.eq\('tour_id', tourId\)/);
});

// ── C. Edge Functions ──────────────────────────────────────────────────────
const responder = sinComentarios(leer('supabase/functions/respond-to-slot-reschedule/index.ts'));
const solicitar = sinComentarios(leer('supabase/functions/process-slot-reschedule-request/index.ts'));
prueba('al aceptar una reprogramacion el mapa es el del horario DESTINO, en las dos ramas', () => {
  assert.equal((responder.match(/rpc\("effective_vehicle_map_type"/g) || []).length, 3, 'una en handleSeatAssignment y una por rama');
  assert.match(responder, /p_slot_id: altSlot\.id/);
  assert.match(responder, /p_slot_id: targetSlot\.id/);
  assert.doesNotMatch(responder, /\.from\("tours"\)\s*\.select\("vehicle_map_type"\)/);
});
prueba('los asientos que se conservan al cambiar de horario tienen que existir en el mapa destino (otro vehiculo)', () => {
  assert.match(responder, /!occupiedNumbers\.has\(n\) && \(!numerosDelMapa \|\| numerosDelMapa\.has\(n\)\)/);
  assert.match(responder, /!\["driver", "wc"\]\.includes\(a\.type \?\? "normal"\)/);
});
prueba('el vehiculo nuevo de una reprogramacion se escribe en el HORARIO, no en el tour (cambiaba todas las salidas)', () => {
  assert.match(solicitar, /updatePayload\.vehicle_map_type = new_vehicle_map_type/);
  assert.doesNotMatch(solicitar, /\.from\("tours"\)\s*\.update\(\{ vehicle_map_type/);
});

// ── D. La migracion ────────────────────────────────────────────────────────
const sql = sinComentariosSql(leer('supabase/migrations/20261031041937_mapa_por_horario_y_capacidad_tope.sql'));
prueba('la funcion del mapa efectivo pasa a ser del repo, con la misma regla (horario primero, tour de respaldo)', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.effective_vehicle_map_type\(p_tour_id uuid, p_slot_id uuid DEFAULT NULL::uuid\)/);
  assert.match(sql, /select s\.vehicle_map_type from public\.tour_slots s where s\.id=p_slot_id and s\.tour_id=p_tour_id/);
  assert.match(sql, /select t\.vehicle_map_type from public\.tours t where t\.id=p_tour_id/);
});
prueba('las funciones nuevas NO quedan abiertas a anon', () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.effective_vehicle_map_type\(uuid, uuid\) FROM PUBLIC, anon;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.effective_vehicle_capacity\(uuid, uuid\) FROM PUBLIC, anon;/);
  for (const f of ['validar_capacidad_de_horario', 'validar_capacidad_de_tour', 'validar_asiento_en_mapa']) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\(\\) FROM PUBLIC, anon, authenticated;`), f);
  }
});
prueba('un horario no puede tener mas capacidad que los asientos de su mapa', () => {
  assert.match(sql, /IF v_cap IS NOT NULL AND NEW\.capacity > v_cap THEN/);
  assert.match(sql, /BEFORE INSERT OR UPDATE OF capacity, vehicle_map_type ON public\.tour_slots/);
  assert.match(sql, /v_map := coalesce\(NEW\.vehicle_map_type, \(SELECT t\.vehicle_map_type FROM public\.tours t WHERE t\.id = NEW\.tour_id\)\)/);
});
prueba('el tour: cupos por horario <= mapa, y no se achica el mapa bajo la capacidad de horarios futuros sin vehiculo propio', () => {
  assert.match(sql, /NEW\.default_slot_capacity IS NOT NULL AND NEW\.default_slot_capacity > v_cap THEN/);
  assert.match(sql, /s\.vehicle_map_type IS NULL AND s\.capacity > v_cap\s+AND s\.slot_date >= current_date/);
  assert.match(sql, /BEFORE UPDATE OF vehicle_map_type, default_slot_capacity ON public\.tours/);
});
prueba('un asiento tiene que existir en el mapa del horario, en apartados Y en estados de asiento; sin mapa no se valida nada', () => {
  assert.match(sql, /BEFORE INSERT ON public\.seat_holds/);
  assert.match(sql, /BEFORE INSERT ON public\.slot_seat_status/);
  assert.match(sql, /v_map := public\.effective_vehicle_map_type\(NEW\.tour_id, NEW\.slot_id\)/);
  assert.match(sql, /IF v_map IS NULL OR NOT EXISTS \(SELECT 1 FROM public\.vehicle_seat_layouts l WHERE l\.type = v_map AND l\.is_active\) THEN\s+RETURN NEW;/);
  assert.match(sql, /\(e->>'number'\)::integer = NEW\.seat_number/);
});
prueba('las dos funciones que validaban contra el TOUR ahora usan el mapa efectivo del horario', () => {
  const cambio = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.change_booking_seats'), sql.indexOf('CREATE OR REPLACE FUNCTION public.assign_external_seats'));
  const externas = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.assign_external_seats'));
  assert.match(cambio, /v_map := public\.effective_vehicle_map_type\(b\.tour_id, b\.slot_id\)/);
  assert.match(cambio, /l\.type=v_map/);
  assert.match(externas, /v_map := public\.effective_vehicle_map_type\(s\.tour_id, s\.slot_id\)/);
  assert.match(externas, /l\.type=v_map/);
  assert.doesNotMatch(cambio + externas, /t\.vehicle_map_type/, 'volvio a leerse el mapa del tour');
});
prueba('change_booking_seats y assign_external_seats siguen siendo SECURITY DEFINER con search_path fijo', () => {
  assert.equal((sql.match(/SECURITY DEFINER\s+SET search_path TO 'public'/g) || []).length, 7);
});

// ── E. La pantalla de la agencia ───────────────────────────────────────────
const tours = sinComentarios(leer('src/pages/agency/AgencyTours.tsx'));
prueba('elegir vehiculo sugiere los cupos (receptivo: cupos por horario; excursion: maximo de viajeros) y respeta los personalizados', () => {
  assert.match(tours, /const elegirVehiculo = \(tipo: VehicleMapType \| null\) => \{/);
  assert.match(tours, /max_travelers: cuposSugeridos\(prev\.max_travelers, anterior, tipo\)/);
  assert.match(tours, /default_slot_capacity: cuposSugeridos\(prev\.default_slot_capacity, anterior, tipo\)/);
  assert.match(tours, /onClick=\{\(\) => elegirVehiculo\(opt\.type\)\}/);
  assert.match(tours, /elegirVehiculo\(e\.target\.checked \? 'sprinter_20' : null\)/);
});
prueba('el aviso compara contra el campo que de verdad se vende; antes miraba max_travelers, vacio en receptivos', () => {
  assert.match(tours, /const capacidad = tourType === 'receptivo'\s+\? parseInt\(receptivoData\.default_slot_capacity \|\| '0'\)\s+: parseInt\(formData\.max_travelers \|\| '0'\);/);
  assert.doesNotMatch(tours, /const mismatch = /);
});
prueba('no se guarda un tour con cupos mayores que su vehiculo (excepto traslado privado, que no lleva mapa)', () => {
  assert.match(tours, /if \(formData\.vehicle_map_type && !\(isTransport && receptivoModality === 'privado'\)\) \{/);
  assert.match(tours, /if \(evaluacion\.estado === 'excede'\) throw new Error\(evaluacion\.mensaje\);/);
});
const panel = sinComentarios(leer('src/components/receptivo/SlotDetailPanel.tsx'));
prueba('el editor de vehiculo por horario guarda vehiculo y cupos en el MISMO update', () => {
  assert.match(panel, /\.update\(\{ vehicle_map_type: nuevoTipo, capacity: cupos, updated_at: new Date\(\)\.toISOString\(\) \}\)/);
  assert.match(panel, /\.from\('tour_slots'\)\s*\.update\(\{ vehicle_map_type: nuevoTipo/);
});
prueba('antes de cambiar el vehiculo se valida: cupos > 0, no bajar de lo reservado, capacidad <= asientos y asientos tomados que no existirian', () => {
  assert.match(panel, /cupos < \(slot\.booked_count \|\| 0\)/);
  assert.match(panel, /evaluarCapacidad\(cupos, asientos\)/);
  assert.match(panel, /mayor && mayor > asientos/);
  assert.match(panel, /\.in\('status', \['reservado_online', 'bloqueado_agencia'\]\)/);
});
prueba('editar solo la capacidad de un horario tambien respeta el tope del vehiculo', () => {
  assert.match(panel, /evaluarCapacidad\(cap, asientosDelVehiculo\)/);
});
prueba('el editor solo se ofrece si el tour tiene mapa de asientos', () => {
  assert.match(panel, /\{tourMap && !\['cancelado', 'completado'\]\.includes\(slot\.status\) && \(/);
});

console.log(`OK: ${casos} comprobaciones (mapa por horario y capacidad como tope).`);
