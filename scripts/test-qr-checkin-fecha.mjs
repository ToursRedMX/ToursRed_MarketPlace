#!/usr/bin/env node
// El correo de confirmación no traía el QR de check-in en tours receptivos (19-oct-2026).
//
// Causa: `generate-booking-qr-token` leía solo `tours.start_date`; los tours receptivos (por horario) no
// la tienen —su fecha vive en la reserva y en `tour_slots`— y la función respondía 422, así que no se
// creaba ningún token y el correo omitía la sección del QR. Medido: 2 tours sin start_date, 60 reservas en
// ellos, 21 confirmadas sin token.
//
//   1. La regla de fecha, EJECUTADA (`_shared/inicioDeLaReserva.ts`).
//   2. Contratos de las dos funciones que la usan, y que los tours con start_date no cambian.
//
// No prueba contra la base ni envía un correo.
//
//   node scripts/test-qr-checkin-fecha.mjs   (Node 24; en 22 agrega --experimental-strip-types)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const m = await import('../supabase/functions/_shared/inicioDeLaReserva.ts');

let casos = 0;
const prueba = (nombre, fn) => {
  try { fn(); casos++; } catch (e) { console.error(`FALLA: ${nombre}`); throw e; }
};
const sinComentarios = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .filter((l) => !/^\s*\/\//.test(l))
  .map((l) => l.replace(/\s\/\/.*$/, ''))
  .join('\n');
const fn = (n) => sinComentarios(readFileSync(`supabase/functions/${n}/index.ts`, 'utf8'));
const iso = (d) => d?.toISOString() ?? null;

prueba('el caso reportado: tour sin start_date, horario 24-oct 07:00 → empieza 07:00 CDMX y vence 24 h después', () => {
  const inicio = m.inicioDeLaReserva({ tourStart: null, slotDate: '2026-10-24', departureTime: '07:00:00', selectedDate: '2026-10-24', bookingDate: '2026-10-24' });
  assert.equal(iso(inicio), '2026-10-24T13:00:00.000Z');
  assert.equal(iso(m.vencimientoDelQr(inicio)), '2026-10-25T13:00:00.000Z');
});

prueba('un tour CON start_date no cambia: se usa tal cual aunque la reserva tenga horario', () => {
  const inicio = m.inicioDeLaReserva({ tourStart: '2026-11-02T15:30:00+00:00', slotDate: '2026-10-24', departureTime: '07:00:00', selectedDate: '2026-10-24' });
  assert.equal(iso(inicio), '2026-11-02T15:30:00.000Z');
  assert.equal(iso(m.inicioDeLaReserva({ tourStart: '2026-11-02' })), '2026-11-02T00:00:00.000Z');
});

prueba('sin horario cae a selected_date y luego a booking_date, a las 00:00 de CDMX', () => {
  assert.equal(iso(m.inicioDeLaReserva({ selectedDate: '2026-10-24', bookingDate: '2026-10-20' })), '2026-10-24T06:00:00.000Z');
  assert.equal(iso(m.inicioDeLaReserva({ selectedDate: null, bookingDate: '2026-10-20' })), '2026-10-20T06:00:00.000Z');
  // una fecha con hora (timestamp) solo aporta el día
  assert.equal(iso(m.inicioDeLaReserva({ selectedDate: '2026-10-24T18:45:00+00:00' })), '2026-10-24T06:00:00.000Z');
});

prueba('la hora del horario solo vale con la fecha del horario, no con selected_date suelto', () => {
  assert.equal(iso(m.inicioDeLaReserva({ departureTime: '07:00:00', selectedDate: '2026-10-24' })), '2026-10-24T06:00:00.000Z');
  assert.equal(iso(m.inicioDeLaReserva({ slotDate: '2026-10-24', departureTime: null })), '2026-10-24T06:00:00.000Z');
});

prueba('sin ninguna fecha válida devuelve null (no un Invalid Date que rompería el INSERT)', () => {
  assert.equal(m.inicioDeLaReserva({}), null);
  assert.equal(m.inicioDeLaReserva({ tourStart: null, slotDate: null, selectedDate: null, bookingDate: null }), null);
  assert.equal(m.inicioDeLaReserva({ tourStart: 'no es fecha' }), null);
  assert.equal(m.inicioDeLaReserva({ selectedDate: 'tampoco' }), null);
});

prueba('fechasParaMostrar: las del tour si las tiene; si no, el día del horario de la reserva', () => {
  assert.deepEqual(m.fechasParaMostrar({ start_date: '2026-11-02', end_date: '2026-11-05' }, { slotDate: '2026-10-24' }), { start_date: '2026-11-02', end_date: '2026-11-05' });
  assert.deepEqual(m.fechasParaMostrar({ start_date: null, end_date: null }, { slotDate: '2026-10-24', slotEndDate: '2026-10-24', selectedDate: '2026-10-24' }), { start_date: '2026-10-24', end_date: '2026-10-24' });
  assert.deepEqual(m.fechasParaMostrar({ start_date: null, end_date: null }, { selectedDate: '2026-10-24' }), { start_date: '2026-10-24', end_date: '2026-10-24' });
  assert.deepEqual(m.fechasParaMostrar({ start_date: null, end_date: null }, {}), { start_date: null, end_date: null });
  assert.deepEqual(m.fechasParaMostrar(null, { bookingDate: '2026-10-20' }), { start_date: '2026-10-20', end_date: '2026-10-20' });
});

prueba('generate-booking-qr-token usa la regla y lee las columnas que necesita', () => {
  const f = fn('generate-booking-qr-token');
  assert.match(f, /from "\.\.\/_shared\/inicioDeLaReserva\.ts"/);
  assert.match(f, /\.select\("id, user_id, agency_id, slot_id, selected_date, booking_date, tour:tours\(start_date\)/);
  assert.match(f, /const inicio = inicioDeLaReserva\(\{[\s\S]*?tourStart: booking\.tour\?\.start_date[\s\S]*?selectedDate: booking\.selected_date[\s\S]*?bookingDate: booking\.booking_date/);
  assert.match(f, /const expiresAt = vencimientoDelQr\(inicio\)/);
  // el 422 ya no depende SOLO de tours.start_date
  assert.doesNotMatch(f, /if \(!booking\.tour\?\.start_date\) \{/);
  assert.match(f, /if \(!inicio\) \{[\s\S]*?status: 422/, 'sin ninguna fecha valida sigue negandose');
});

prueba('generate-booking-qr-token: un tour con start_date no consulta tour_slots (camino de siempre)', () => {
  const f = fn('generate-booking-qr-token');
  assert.match(f, /if \(!booking\.tour\?\.start_date && booking\.slot_id\) \{[\s\S]*?\.from\("tour_slots"\)/);
});

prueba('get-booking-checkin-details devuelve el tour con las fechas completadas', () => {
  const f = fn('get-booking-checkin-details');
  assert.match(f, /from "\.\.\/_shared\/inicioDeLaReserva\.ts"/);
  assert.match(f, /slot_id,\s*selected_date,\s*booking_date,\s*tour:tours\(id, name, destination, start_date, end_date\)/);
  assert.match(f, /\.\.\.fechasParaMostrar\(booking\.tour,/);
  assert.match(f, /tour: tourConFechas,/);
  assert.doesNotMatch(f, /tour: booking\.tour,/);
});

prueba('confirm-booking-checkin valida por expires_at del token, no por tours.start_date', () => {
  const f = fn('confirm-booking-checkin');
  assert.match(f, /new Date\(tokenRecord\.expires_at\) < now/);
  assert.doesNotMatch(f, /new Date\(booking\.tour\??\.start_date/);
});

console.log(`OK: ${casos} casos del QR de check-in sin start_date.`);
