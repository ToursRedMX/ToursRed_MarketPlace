// Contratos del PR "cancelacion: puntos a 603, CFDI de lo retenido y funciones definer cerradas a anon" (30-oct-2026).
//
//   A. CFDI nuevo al cancelar con motivo 03 (respuesta del contador, FIS-05): cargo por servicio retenido + penalizacion DIVIDIDA.
//      La parte de la plataforma va sin tercero; la de la agencia lleva a la agencia como tercero. Aqui se EJECUTA el calculo.
//   B. Por que el CFDI nuevo nunca se emitia: `cancel-cfdi` solo lo pedia por el webhook (SAT responde despues) y `generate-...` exigia que el
//      original siguiera `stamped`, cuando ya esta cancelado. Medido: 0 filas `cancellation_commission` en toda la base.
//   C. El asiento (SQL): los puntos devueltos acreditan 603 y la total descuenta lo que las parciales previas ya revirtieron. Del SQL solo se
//      LEE el texto; su efecto contra la base se mide despues de aplicar la migracion.
//   D. La migracion que cierra anon en nueve funciones definer.
//
// Lo que NO prueba: que FacturAPI acepte el comprobante ni el efecto del asiento contra la base.
//
//   node --experimental-strip-types --no-warnings scripts/test-cancelacion-603-cfdi-anon.mjs   (Node 24: sin las banderas)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { conceptosDeCancelacion } = await import('../supabase/functions/_shared/conceptosCfdiCancelacion.ts');

const leer = (ruta) => readFileSync(new URL('../' + ruta, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/ .*$/gm, '$1');
const sinComentariosSql = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');

let casos = 0;
const prueba = (nombre, fn) => { try { fn(); casos++; } catch (e) { console.error(`FALLA: ${nombre}`); throw e; } };
const redondea = (n) => Math.round(n * 100) / 100;

const TERCERO = { rfc: 'AAA010101AAA', nombre: 'Agencia SA', regimen_fiscal: '601', domicilio_fiscal: '06000' };
const base = { cargoRetenido: 0, penalizacionPlataforma: 0, penalizacionAgencia: 0, tercero: TERCERO, referencia: 'Reserva TRG-X (cancelada)' };

// ── A. El calculo ───────────────────────────────────────────────────────────
prueba('solo cargo por servicio: un concepto sin tercero que suma lo retenido', () => {
  const r = conceptosDeCancelacion({ ...base, cargoRetenido: 50 });
  assert.equal(r.conceptos.length, 1);
  assert.equal(r.conceptos[0].tercero ?? null, null, 'el cargo por servicio es ingreso 100% de ToursRed');
  assert.equal(r.total, 50);
  assert.equal(r.iva, redondea(50 * 16 / 116));
  assert.equal(r.subtotal, redondea(r.total - r.iva));
});
prueba('penalizacion 300 (70/30): la parte de la plataforma sin tercero, la de la agencia CON tercero', () => {
  const r = conceptosDeCancelacion({ ...base, penalizacionPlataforma: 90, penalizacionAgencia: 210 });
  const plataforma = r.conceptos.find((c) => /plataforma/.test(c.descripcion));
  const agencia = r.conceptos.find((c) => /agencia/.test(c.descripcion));
  assert.ok(plataforma && agencia);
  assert.equal(plataforma.tercero ?? null, null, 'la parte de la plataforma se factura directo');
  assert.deepEqual(agencia.tercero, TERCERO, 'la parte de la agencia lleva el tercero');
  assert.equal(r.total, 300);
});
prueba('cargo + penalizacion en un solo comprobante: el total es la suma de lo retenido', () => {
  const r = conceptosDeCancelacion({ ...base, cargoRetenido: 25, penalizacionPlataforma: 90, penalizacionAgencia: 210 });
  assert.equal(r.conceptos.length, 3);
  assert.equal(r.total, 325);
  // Solo UNA clase de concepto lleva tercero: el de la agencia.
  assert.deepEqual(r.conceptos.filter((c) => c.tercero).map((c) => c.descripcion.includes('agencia')), [true]);
});
prueba('TODO va al 16%: la parte de la agencia lleva IVA aunque el tour sea exento o mixto (contador, 30-oct-2026)', () => {
  const r = conceptosDeCancelacion({ ...base, penalizacionAgencia: 116 });
  assert.equal(r.conceptos.length, 1);
  assert.equal(r.conceptos[0].valor_unitario, 100, 'neto = bruto / 1.16');
  assert.equal(r.iva, 16);
  assert.equal(r.total, 116);
  assert.ok(!('exento' in r.conceptos[0]), 'no existe concepto exento en la cancelacion');
  assert.ok(r.conceptos.every((c) => c.tercero === TERCERO || c.tercero == null));
});
prueba('si la agencia factura con el mismo RFC del receptor no hay tercero (null)', () => {
  const r = conceptosDeCancelacion({ ...base, penalizacionAgencia: 100, tercero: null });
  assert.equal(r.conceptos[0].tercero ?? null, null);
});
prueba('sin nada retenido no hay conceptos; los importes negativos o NaN no cuelan un concepto', () => {
  assert.deepEqual(conceptosDeCancelacion(base).conceptos, []);
  const r = conceptosDeCancelacion({ ...base, cargoRetenido: -5, penalizacionPlataforma: NaN, penalizacionAgencia: 0 });
  assert.deepEqual(r.conceptos, []);
  assert.equal(r.total, 0);
});
prueba('el total del comprobante cuadra con lo retenido a centavos, tambien con montos feos', () => {
  for (const [cargo, plat, ag] of [[0.3, 0, 0], [33.33, 11.11, 25.9], [1234.56, 100.01, 233.37], [7.07, 3.03, 9.99], [50, 0, 350]]) {
    const r = conceptosDeCancelacion({ ...base, cargoRetenido: cargo, penalizacionPlataforma: plat, penalizacionAgencia: ag });
    assert.ok(Math.abs(r.total - (cargo + plat + ag)) <= 0.011, `${cargo}/${plat}/${ag}: ${r.total}`);
    assert.equal(redondea(r.subtotal + r.iva), r.total);
  }
});

// ── B. Por que no se emitia ────────────────────────────────────────────────
const cancelCfdi = sinComentarios(leer('supabase/functions/cancel-cfdi/index.ts'));
prueba('cancel-cfdi pide el CFDI nuevo cuando el SAT acepta en el acto, SOLO con motivo 03 y una cancelacion', () => {
  assert.match(cancelCfdi, /if \(motivo === "03" && cancellation_id && marca\.ligada && cfdi\.booking_id\) \{[\s\S]*?"generate-cancellation-commission-cfdi"/);
  assert.match(cancelCfdi, /replaces_cfdi_invoice_id: cfdi_invoice_id/);
});
prueba('el CFDI nuevo se pide DESPUES de marcar el original como cancelado, dentro de la rama aceptada', () => {
  const cancelado = cancelCfdi.indexOf('marcarCfdi(supabase, cfdi_invoice_id, "cancelled"');
  const pedido = cancelCfdi.indexOf('"generate-cancellation-commission-cfdi"');
  const pendiente = cancelCfdi.indexOf('marcarCfdi(supabase, cfdi_invoice_id, "cancellation_pending"');
  assert.ok(cancelado > 0 && pedido > cancelado && pedido < pendiente, `orden: ${cancelado} ${pedido} ${pendiente}`);
});
prueba('el fallo de pedirlo no tumba la cancelacion: ya paso ante el SAT y no se deshace', () => {
  assert.match(cancelCfdi, /\.catch\(\(e: unknown\) => registrarFallo\("cancel-cfdi -> generate-cancellation-commission-cfdi"/);
  assert.match(cancelCfdi, /EdgeRuntime\.waitUntil\(\s*supabase\.functions\.invoke\("generate-cancellation-commission-cfdi"/);
});

const generar = sinComentarios(leer('supabase/functions/generate-cancellation-commission-cfdi/index.ts'));
prueba('el original puede estar cancelado o pendiente de cancelar (antes exigia stamped y fallaba SIEMPRE)', () => {
  assert.match(generar, /\["stamped", "cancellation_pending", "cancelled"\]\.includes\(orig\.status\)/);
  assert.doesNotMatch(generar, /orig\.status !== "stamped"/, 'volvio la exigencia que impedia emitir el CFDI nuevo');
});
prueba('el CFDI nuevo incluye la penalizacion de la cancelacion, TODO al 16% (sin exentos ni snapshot fiscal del tour)', () => {
  assert.match(generar, /amount_to_agency, amount_to_platform/);
  assert.match(generar, /conceptosDeCancelacion\(\{/);
  assert.match(generar, /penalizacionAgencia/);
  assert.doesNotMatch(generar, /tax_treatment|exempt_ratio|Exento|exento/, 'el contador confirmo que todo es 16%');
  assert.doesNotMatch(sinComentarios(leer('supabase/functions/_shared/conceptosCfdiCancelacion.ts')), /exento|taxTreatment|calculateTaxBreakdown/);
});
prueba('solo se pide tercero para la parte de la agencia y solo si su RFC difiere del receptor', () => {
  assert.match(generar, /const necesitaTercero = penalizacionAgencia > 0 && !!agency\?\.rfc && agency\.rfc !== receptorRfc/);
  assert.match(generar, /La agencia debe completar su régimen fiscal y código postal/);
});
prueba('FacturAPI recibe third_party en los conceptos que lo piden, con IVA 16%', () => {
  assert.match(generar, /third_party: \{\s+tax_id: c\.tercero\.rfc/);
  assert.match(generar, /taxes: \[\{ type: "IVA", rate: 0\.16 \}\]/);
});

// ── B2. La cancelacion PARCIAL con penalizacion ────────────────────────────
// substitute-cfdi-for-partial-cancellation recalcula la parte viva del tour y jamas lee amount_to_agency/amount_to_platform: la penalizacion
// retenida por una parcial no salia en NINGUN CFDI. Nunca se vio porque las 3 parciales que existen son al 100% (sin penalizacion).
prueba('generate acepta la parcial: carga sus importes, sin cargo por servicio, y guarda la fila con booking_partial_cancellation_id', () => {
  assert.match(generar, /const esParcial = !cancellation_id && !!partial_cancellation_id/);
  assert.match(generar, /from\("booking_partial_cancellations"\)\s+\.select\("booking_id, amount_to_agency, amount_to_platform"\)/);
  assert.match(generar, /booking_partial_cancellation_id: esParcial \? partial_cancellation_id : null/);
  assert.match(generar, /cancellation_id: esParcial \? null : cancellation_id/);
});
prueba('la idempotencia de la parcial es por SU id, no por el de la cancelacion total', () => {
  assert.match(generar, /\.eq\(esParcial \? "booking_partial_cancellation_id" : "cancellation_id", esParcial \? partial_cancellation_id : cancellation_id\)/);
});
const parcialCancel = sinComentarios(leer('supabase/functions/process-partial-cancellation/index.ts'));
prueba('la parcial pide el CFDI de la penalizacion solo si retuvo algo, y sin bloquear la respuesta', () => {
  assert.match(parcialCancel, /if \(policy\.amountToAgency > 0 \|\| policy\.amountToPlatform > 0\) \{\s+EdgeRuntime\.waitUntil\(\s+supabase\.functions\.invoke\("generate-cancellation-commission-cfdi", \{\s+body: \{ booking_id: bookingId, partial_cancellation_id: partialCancellation\.id \}/);
  assert.match(parcialCancel, /registrarFallo\("process-partial-cancellation -> generate-cancellation-commission-cfdi"/);
  assert.match(parcialCancel, /import \{ registrarFallo, vigilarResultado \}/);
});
prueba('sin cargo ni penalizacion retenidos no se emite nada', () => {
  assert.match(generar, /conservedAmount <= 0 && penalizacionPlataforma <= 0 && penalizacionAgencia <= 0/);
});

// ── C. El asiento ──────────────────────────────────────────────────────────
const sqlAsiento = sinComentariosSql(leer('supabase/migrations/20261030091742_asiento_cancelacion_puntos_a_603_y_parciales_previas.sql'));
prueba('los puntos devueltos acreditan 603 y no caen al ajuste residual de 402', () => {
  assert.match(sqlAsiento, /v_entry_id, 5, '603'/);
  assert.match(sqlAsiento, /IF v_points_mxn > 0 THEN/);
  assert.match(sqlAsiento, /v_entry_id, 6, '402'/, 'el residual pasa a la linea 6 y sigue yendo a 402');
});
prueba('los puntos de la total salen de lo que de verdad se reembolso (type refund, reference booking), 100 puntos = $1', () => {
  assert.match(sqlAsiento, /t\.type = 'refund'\s+AND t\.reference_type = 'booking'\s+AND t\.reference_id = v_booking_id/);
  assert.match(sqlAsiento, /SUM\(t\.amount\), 0\) \/ 100\.0/);
  assert.match(sqlAsiento, /v_points_mxn := v_points_partial \/ 100\.0/);
  assert.match(sqlAsiento, /COALESCE\(bpc\.points_refunded, 0\)/);
});
prueba('los puntos de extras, abonos y seguro NO entran: no estan en el anticipo que este asiento revierte', () => {
  assert.doesNotMatch(sqlAsiento, /post_booking_extra/);
});
prueba('los puntos se topan en lo que queda por cuadrar: nunca dejan un residual negativo', () => {
  assert.match(sqlAsiento, /v_points_mxn := ROUND\(LEAST\(\s+GREATEST\(v_points_mxn, 0\),\s+GREATEST\(COALESCE\(v_deposit, 0\) - COALESCE\(v_refund_to_traveler, 0\) - COALESCE\(v_amount_to_agency, 0\) - COALESCE\(v_amount_to_platform, 0\), 0\)/);
});
prueba('la total descuenta solo las parciales previas QUE TIENEN asiento (las de antes del #485 no)', () => {
  assert.match(sqlAsiento, /v_deposit := GREATEST\(COALESCE\(v_deposit, 0\) - v_prev_partials, 0\)/);
  assert.match(sqlAsiento, /bpc\.created_at <= v_cancelled_at\s+AND EXISTS \(\s+SELECT 1 FROM accounting_entries e\s+WHERE e\.source_type = 'cancellation'\s+AND e\.source_id = bpc\.id/);
});
prueba('la funcion sigue siendo SECURITY DEFINER con search_path fijo', () => {
  assert.match(sqlAsiento, /SECURITY DEFINER\s+SET search_path TO 'public'/);
});

// ── D. Funciones definer cerradas a anon ───────────────────────────────────
const sqlAnon = sinComentariosSql(leer('supabase/migrations/20261030092218_revocar_anon_en_funciones_definer_internas.sql'));
const cerradas = [
  'calculate_booking_breakdown', 'create_booking_atomic_with_preventa', 'preview_booking_breakdown', 'complete_agency_onboarding',
  'release_seat_holds', 'check_preventa_eligibility', 'expire_unpaid_approved_bookings',
  'prevent_delete_of_used_tour_promotion', 'reactivar_participantes_al_recibir_mensaje',
];
const abiertas = [
  'get_tour_availability', 'get_tour_availability_v2', 'get_tour_inventory_summary', 'check_curp_available', 'check_email_available',
  'check_passport_available', 'check_slug_available', 'resolve_tour_slug', 'unsubscribe_destination_alert', 'increment_featured_stat',
];
prueba('las nueve funciones internas se cierran y el conteo esperado esta amarrado a nueve', () => {
  for (const f of cerradas) assert.match(sqlAnon, new RegExp(`\\('${f}',\\s+(true|false)\\)`), f);
  assert.match(sqlAnon, /v_procesadas <> 9/);
});
prueba('se revoca de PUBLIC (revocar solo anon no basta: el permiso por omision lo da PUBLIC)', () => {
  assert.match(sqlAnon, /REVOKE ALL ON FUNCTION public\.%I\(%s\) FROM PUBLIC, anon, authenticated/);
});
prueba('el cron (expire_unpaid_approved_bookings) y los triggers quedan SIN authenticated; las RPC del front lo conservan', () => {
  for (const f of ['expire_unpaid_approved_bookings', 'prevent_delete_of_used_tour_promotion', 'reactivar_participantes_al_recibir_mensaje']) {
    assert.match(sqlAnon, new RegExp(`\\('${f}',\\s+false\\)`), f);
  }
  for (const f of ['preview_booking_breakdown', 'create_booking_atomic_with_preventa', 'complete_agency_onboarding', 'release_seat_holds']) {
    assert.match(sqlAnon, new RegExp(`\\('${f}',\\s+true\\)`), f);
  }
});
prueba('la migracion comprueba contra la base que anon quedo sin permiso (patron 13)', () => {
  assert.match(sqlAnon, /has_function_privilege\('anon', r\.oid, 'EXECUTE'\)/);
  assert.match(sqlAnon, /RAISE EXCEPTION 'anon sigue pudiendo ejecutar/);
});
prueba('las funciones publicas por diseno NO se tocan en la migracion', () => {
  const lista = sqlAnon.slice(sqlAnon.indexOf('JOIN (VALUES'), sqlAnon.indexOf(') AS v(nombre'));
  for (const f of abiertas) assert.doesNotMatch(lista, new RegExp(`'${f}'`), `${f} debe seguir abierta`);
});
prueba('ninguna de las nueve la llama el front sin sesion ni una Edge Function como anon', () => {
  // `release_seat_holds` la llama el flujo de reserva, que ya exige sesion desde el #484 (hold_seats).
  const ctx = sinComentarios(leer('src/context/BookingFlowContext.tsx'));
  assert.match(ctx, /rpc\('release_seat_holds'/);
});

console.log(`OK: ${casos} comprobaciones (CFDI de cancelacion, asiento 603 y funciones definer cerradas a anon).`);
