// `stripe-webhook` llamaba insert_audit_log('BOOKING_CONFIRMED') justo
// despues del UPDATE que confirma la reserva, duplicando la fila que
// audit_bookings_change() (trigger generico en bookings) ya escribe sola.
// Medido en produccion: 10 reservas con la fila de mas (pendiente 4 de la
// entrada 33). El pago (payment_method/payment_intent_id) que daba esa
// llamada ya vive en el trigger desde la migracion
// 20261003010000_audit_bookings_sin_duplicar_confirmacion.sql.
//
// Esta guardia falla si esa llamada explicita vuelve a aparecer en
// stripe-webhook. No cubre los otros cuatro webhooks porque ninguno la tuvo
// nunca (grep -rl BOOKING_CONFIRMED supabase/functions, medido el 03-oct-2026:
// solo stripe-webhook).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Sin comentarios de linea: el propio comentario que explica por que no
// esta la llamada menciona ambos terminos, y no debe disparar la guardia.
const fuente = readFileSync('supabase/functions/stripe-webhook/index.ts', 'utf8')
  .split('\n').map(linea => linea.replace(/\/\/.*$/, '')).join('\n');
assert.ok(
  !/\.rpc\(\s*['"]insert_audit_log['"][\s\S]{0,300}['"]BOOKING_CONFIRMED['"]/.test(fuente),
  'stripe-webhook volvio a llamar insert_audit_log con BOOKING_CONFIRMED explicito: ' +
  'duplica la fila que audit_bookings_change() ya escribe (ver migracion 20261003010000).'
);
console.log('OK: stripe-webhook ya no duplica BOOKING_CONFIRMED.');
