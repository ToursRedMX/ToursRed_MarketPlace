// Contratos de los dos defectos de asientos de cancelacion del pre-UAT (29-oct-2026, casos FIS-06 y CAN-07 de la matriz UAT).
//
//   A. `process-partial-cancellation` solo asentaba con retencion (50% o sin reembolso) y sin await: las 3 cancelaciones parciales al
//      100% (6,019.52) nunca llegaron al libro, y la promesa sin await puede no ejecutarse antes de responder.
//   B. `process-incremental-payment-deadlines` (cron cada hora) cancelaba por pago incompleto y reembolsaba al monedero sin asiento ni
//      manejo de CFDI: 3,050.00 en dos reservas (TRG-YQ18292VCFC y TRG-PSXABPMBNA2) que el libro (218-11) no tenia.
//
// Aqui se EJECUTA la regla del asiento (pura) y se leen los dos llamadores. Lo que NO prueba: que el RPC acepte las lineas ni el efecto
// contra la base; eso se mide contra la base despues de desplegar, con la consulta de conciliacion del monedero.
//
//   node --experimental-strip-types --no-warnings scripts/test-asientos-cancelacion.mjs   (Node 24: sin las banderas)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { lineasDeCancelacionPorPagoIncompleto } = await import('../supabase/functions/_shared/asientoPagoIncompleto.ts');

const leer = (ruta) => readFileSync(new URL('../' + ruta, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/ .*$/gm, '$1');

let casos = 0;
const prueba = (nombre, fn) => { try { fn(); casos++; } catch (e) { console.error(`FALLA: ${nombre}`); throw e; } };
const suma = (lineas, campo) => Math.round(lineas.reduce((s, l) => s + l[campo], 0) * 100) / 100;

// ── B. La regla del asiento ────────────────────────────────────────────────
prueba('TRG-YQ18292VCFC: 3,000 cobrados y 2,850 reembolsados -> 102 / 218-11 / 402 por 150, balanceado', () => {
  const r = lineasDeCancelacionPorPagoIncompleto(3000, 3000, 2850);
  assert.equal(r.ok, true);
  assert.deepEqual(r.lineas.map((l) => [l.account_code, l.debit, l.credit]), [['102', 3000, 0], ['218-11', 0, 2850], ['402', 0, 150]]);
  assert.equal(suma(r.lineas, 'debit'), suma(r.lineas, 'credit'));
  assert.equal(r.retenido, 150);
});
prueba('un viajero exento del cargo recibe todo: sin linea 402', () => {
  const r = lineasDeCancelacionPorPagoIncompleto(200, 200, 200);
  assert.equal(r.ok, true);
  assert.deepEqual(r.lineas.map((l) => l.account_code), ['102', '218-11']);
  assert.equal(r.retenido, 0);
});
prueba('sin reembolso: todo lo cobrado queda como cargo retenido', () => {
  const r = lineasDeCancelacionPorPagoIncompleto(100, 100, 0);
  assert.equal(r.ok, true);
  assert.deepEqual(r.lineas.map((l) => [l.account_code, l.debit, l.credit]), [['102', 100, 0], ['402', 0, 100]]);
});
prueba('el redondeo no rompe el balance (centavos de punto flotante)', () => {
  for (const [pagado, reembolso] of [[0.3, 0.2], [1234.56, 1172.83], [999.99, 949.99], [10.07, 9.57]]) {
    const r = lineasDeCancelacionPorPagoIncompleto(pagado, pagado, reembolso);
    assert.equal(r.ok, true);
    assert.equal(suma(r.lineas, 'debit'), suma(r.lineas, 'credit'), `${pagado}/${reembolso}`);
  }
});
prueba('fondos mixtos: si lo cobrado por pasarela no es lo pagado, NO se asienta (de donde salio el resto no se sabe)', () => {
  assert.deepEqual(lineasDeCancelacionPorPagoIncompleto(500, 350, 475), { ok: false, motivo: 'fondos_mixtos' });
  assert.deepEqual(lineasDeCancelacionPorPagoIncompleto(500, 0, 475), { ok: false, motivo: 'fondos_mixtos' });
  assert.deepEqual(lineasDeCancelacionPorPagoIncompleto(350, 500, 332.5), { ok: false, motivo: 'fondos_mixtos' });
});
prueba('datos imposibles se rechazan: sin pago o reembolso mayor al pago', () => {
  assert.deepEqual(lineasDeCancelacionPorPagoIncompleto(0, 0, 0), { ok: false, motivo: 'sin_pago' });
  assert.deepEqual(lineasDeCancelacionPorPagoIncompleto(100, 100, 120), { ok: false, motivo: 'reembolso_mayor_al_pago' });
});

// ── B. El cron de pago incompleto ──────────────────────────────────────────
const cron = sinComentarios(leer('supabase/functions/process-incremental-payment-deadlines/index.ts'));
prueba('el cron asienta DESPUES del reembolso y ANTES de avisar al viajero', () => {
  const reembolso = cron.indexOf('p_reference_type: "booking_cancellation"');
  const asiento = cron.indexOf('await asentarCancelacionPorPagoIncompleto(');
  const aviso = cron.indexOf('send-cancellation-notification-traveler');
  assert.ok(reembolso > 0 && asiento > reembolso && aviso > asiento, `orden: reembolso ${reembolso}, asiento ${asiento}, aviso ${aviso}`);
});
prueba('el asiento usa el RPC atomico, origen cancellation y la reserva como id (idempotente por origen)', () => {
  assert.match(cron, /supabase\.rpc\("create_accounting_entry_atomic"/);
  assert.match(cron, /p_source_type: "cancellation"/);
  assert.match(cron, /p_source_id: booking\.id/);
  assert.match(cron, /p_lines: resultado\.lineas/);
});
prueba('si la reserva ya tiene asiento o el dinero es mixto, no se asienta a ojo: queda en audit_errors', () => {
  assert.match(cron, /eq\("source_type", "booking"\)/);
  assert.match(cron, /La reserva ya tiene asiento de reserva/);
  assert.match(cron, /La cancelacion no se asienta sola \(\$\{resultado\.motivo\}\)/);
  assert.match(cron, /registrarFallo\(/);
});
prueba('los CFDI vigentes de la reserva se cancelan con cancel-cfdi (motivo 03), independiente del asiento', () => {
  assert.match(cron, /from\("cfdi_invoices"\)[\s\S]*?\.eq\("status", "stamped"\)/);
  assert.match(cron, /functions\.invoke\("cancel-cfdi", \{ body: \{ cfdi_invoice_id: cfdi\.id, motivo: "03" \} \}\)/);
  assert.match(cron, /vigilarResultado\(respuesta/);
});
prueba('el helper nunca lanza: la reserva ya se cancelo y reembolso y eso no se deshace por un fallo contable', () => {
  const inicio = cron.indexOf('async function asentarCancelacionPorPagoIncompleto');
  const fin = cron.indexOf('Deno.serve(');
  const cuerpo = cron.slice(inicio, fin);
  assert.equal((cuerpo.match(/\btry \{/g) || []).length, 2, 'dos bloques try: uno para el asiento y otro para el CFDI');
  assert.equal((cuerpo.match(/\bcatch \(e\)/g) || []).length, 2);
  assert.doesNotMatch(cuerpo, /\bthrow\b(?! pagosErr)/, 'el helper no debe relanzar');
});

// ── A. La cancelacion parcial ──────────────────────────────────────────────
const parcial = sinComentarios(leer('supabase/functions/process-partial-cancellation/index.ts'));
prueba('la parcial asienta con TODA politica salvo pending_approval (antes solo con retencion)', () => {
  // `tipoPolitica` y no `policy.policyType`: la reserva pendiente de aprobacion se guarda como 100_percent pero no tiene pago confirmado.
  assert.match(parcial, /if \(tipoPolitica !== "pending_approval"\) \{/);
  assert.doesNotMatch(parcial, /if \(policy\.policyType !== "pending_approval"\)/, 'policy.policyType nunca es pending_approval: asentaria las reservas sin pago');
  assert.match(parcial, /tipoPolitica === "pending_approval" \? "100_percent" : tipoPolitica/, 'si esto cambia, revisar la condicion del asiento');
  // La condicion "50_percent || no_refund" sigue existiendo para otras cosas (registro de penalizacion): lo que no puede es guardar el asiento.
  assert.doesNotMatch(parcial, /policy\.policyType === "50_percent" \|\| policy\.policyType === "no_refund"\) \{\s+(?:try \{\s+)?(?:const \{ error: accErr \} = await )?supabase\s*\.rpc\("create_accounting_entry_for_cancellation"/, 'volvio la condicion que dejaba fuera el 100%');
});
prueba('la parcial ESPERA el asiento (sin promesa suelta) y deja rastro si falla', () => {
  assert.match(parcial, /const \{ error: accErr \} = await supabase\.rpc\("create_accounting_entry_for_cancellation", \{\s+p_cancellation_id: partialCancellation\.id,\s+p_cancellation_type: "partial",/);
  assert.doesNotMatch(parcial, /create_accounting_entry_for_cancellation"[\s\S]{0,200}\.then\(/, 'el asiento no puede ir en una promesa sin await');
  assert.match(parcial, /registrarFallo\("process-partial-cancellation\/poliza"/);
});
prueba('el asiento de la parcial va despues de guardar la cancelacion y antes de descontar puntos', () => {
  const guardada = parcial.indexOf('Error registrando cancelación parcial');
  const asiento = parcial.indexOf('create_accounting_entry_for_cancellation');
  const puntos = parcial.indexOf('deduct_points_for_partial_cancellation');
  assert.ok(guardada > 0 && asiento > guardada && puntos > asiento, `orden: ${guardada} ${asiento} ${puntos}`);
});

console.log(`OK: ${casos} comprobaciones de los asientos de cancelacion (parcial al 100% y pago incompleto).`);
