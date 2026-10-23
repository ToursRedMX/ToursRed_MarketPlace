// Contratos de la FASE 3 del cobro de notificaciones (migracion 20261023030512 + generate-notification-cfdi): lo contable y lo fiscal.
// Lo que se afirma aqui es lo que NO puede romperse sin que el libro mienta o se facture mal (patron 1: un numero que cuadra puede
// estar en la cuenta equivocada, asi que se afirma la CLASIFICACION concepto por concepto, no solo la suma):
//   1. cada cobro se asienta: Bancos neto de comision / 604 / 108 contra 403 (base) y 210 (IVA); la fase 3 lo creo en 410 y la
//      migracion 20261023043215 lo movio a 403 (Axel: membresias y notificaciones van juntas), asi que aqui se lee el estado FINAL;
//   2. todo lo que conoce el contexto de membresia conoce el nuevo (CHECKs, vista de movimientos, conciliacion, auditoria);
//   3. el CFDI solo sale de un pago confirmado, siempre se emite, y el importe sale de lo cobrado;
//   4. el CFDI y el asiento parten el IVA igual (si no, el libro y el comprobante diferirian un centavo);
//   5. el correo, el reintento y la descarga conocen el tipo nuevo.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const leer = (ruta) => readFileSync(new URL('../' + ruta, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sinComentarios = (t) => t.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('--') && !l.trim().startsWith('*')).join('\n');

const sql = leer('supabase/migrations/20261023030512_cobro_notificaciones_fase3_fiscal_y_contable.sql');
const a403 = leer('supabase/migrations/20261023043215_membresias_y_notificaciones_a_la_cuenta_403.sql');
const cfdi = leer('supabase/functions/generate-notification-cfdi/index.ts');
const compartido = leer('supabase/functions/_shared/suscripcionNotificaciones.ts');
const correo = leer('supabase/functions/send-cfdi-email/index.ts');
const reintento = leer('supabase/functions/retry-failed-cfdi/index.ts');
const descarga = leer('supabase/functions/download-cfdi/index.ts');
const webhook = leer('supabase/functions/stripe-webhook/index.ts');

let casos = 0;
const prueba = (nombre, fn) => { fn(); casos++; };

const cuerpoDe = (firma) => {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION ${firma}`);
  assert.ok(i > -1, `no esta la funcion ${firma}`);
  return sql.slice(i, sql.indexOf('$function$;', sql.indexOf('AS $function$', i) + 13));
};

prueba('la fase 3 creo la 410 sin pisar nada, y la migracion de la 403 la retira', () => {
  assert.match(sql, /VALUES? ?\(?'410', '410', 'Ingresos por notificaciones', 'ingreso'|SELECT '410', '410', 'Ingresos por notificaciones', 'ingreso', '40'/);
  assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM public\.chart_of_accounts WHERE code = '410'\)/);
  assert.match(a403, /DELETE FROM public\.chart_of_accounts WHERE code = '410'/);
  assert.match(a403, /UPDATE public\.chart_of_accounts SET is_active = false WHERE code = '410'/, 'si ya tuviera partidas se desactiva, no se borra historia');
});

prueba('el asiento clasifica cada concepto en su cuenta, con la comision de Stripe y el IVA separado', () => {
  // Sin comentarios: un RAISE comentado no protege nada (patron 4: la mutacion cayo en un comentario y la prueba sobrevivio).
  // Estado FINAL: la funcion de la fase 3 con el cambio de cuenta que le aplica la migracion de la 403.
  assert.match(a403, /viejo text := '''account_code'', ''410''';\s+nuevo text := '''account_code'', ''403''';/);
  assert.match(a403, /IF veces <> 1 THEN\s+RAISE EXCEPTION 'create_accounting_entry_for_notificaciones cambio/);
  const f = sinComentarios(cuerpoDe('public.create_accounting_entry_for_notificaciones')).replace("'account_code', '410'", "'account_code', '403'");
  // Debitos: Bancos NETO de comision, la comision (604) y su IVA (108).
  assert.match(f, /'account_code', '102'[^;]*'debit', v_total - v_fee/);
  assert.match(f, /'account_code', '604'[^;]*'debit', v_fee_base/);
  assert.match(f, /'account_code', '108'[^;]*'debit', v_fee_iva/);
  // Creditos: el ingreso en 403 (junto con las membresias; NO en 401 comisiones) y el IVA trasladado en 210.
  assert.match(f, /'account_code', '403'[^;]*'credit', v_base/);
  assert.match(f, /'account_code', '210'[^;]*'credit', v_iva/);
  assert.ok(!/'account_code', '(401|410)'/.test(f), 'no se acredita a comisiones ni a la 410 retirada');
  // El precio ya incluye IVA.
  assert.match(f, /v_base := round\(v_total \/ 1\.16, 2\);/);
  assert.match(f, /v_iva := v_total - v_base;/);
  // Solo cobros de este contexto y confirmados; la comision real, nunca estimada.
  assert.match(f, /status = 'succeeded' AND charge_context = 'notification_subscription'/);
  assert.ok(!/estimar_comision|stripe_commission_pct/.test(f), 'no se estima la comision');
  assert.match(f, /RAISE EXCEPTION 'La comision/);
  // Idempotente por el origen y en la fecha de Mexico.
  assert.match(f, /public\.create_accounting_entry_atomic\(/);
  assert.match(f, /'notification_subscription',\s+p_payment_transaction_id,\s+\(v_tx\.created_at AT TIME ZONE 'America\/Mexico_City'\)::date/);
});

prueba('solo el servicio ejecuta el asiento; SECURITY DEFINER con search_path fijo', () => {
  const f = cuerpoDe('public.create_accounting_entry_for_notificaciones');
  assert.match(f, /SECURITY DEFINER SET search_path TO ''/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.create_accounting_entry_for_notificaciones\(uuid\) FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.create_accounting_entry_for_notificaciones\(uuid\) TO service_role;/);
});

prueba('NO se toca ni se copia el asiento de ToursRed Plus (acredita a 401 y no separa IVA: hallazgo aparte)', () => {
  assert.ok(!/CREATE OR REPLACE FUNCTION public\.create_accounting_entry_for_membership/.test(sql));
  assert.ok(!/create_accounting_entry_for_membership\(/.test(sinComentarios(sql)));
});

prueba('los cuatro CHECKs que enumeran contextos aceptan el nuevo y fallan si el fragmento cambia', () => {
  for (const r of ['payment_transactions_charge_context_check', 'payment_transactions_booking_id_requerido', 'accounting_entries_source_type_check', 'cfdi_invoices_invoice_type_check']) {
    assert.ok(sql.includes(`'${r}'`), r);
  }
  assert.match(sql, /viejo text := '''membership''::text,';/);
  assert.match(sql, /IF veces <> 1 THEN\s+RAISE EXCEPTION '% cambio: el fragmento aparece % veces, se esperaba 1'/);
  assert.equal((sql.match(/'notification_subscription'\)/g) ?? []).length, 4, 'un valor nuevo por restriccion');
});

prueba('la vista de movimientos cuenta el cobro como INGRESO (no como pasivo) en las dos columnas', () => {
  assert.match(sql, /viejo text := '\(pt\.charge_context = ''membership''::text\)'/);
  assert.match(sql, /ARRAY\[''membership''::text, ''notification_subscription''::text\]/);
  assert.match(sql, /IF veces <> 2 THEN\s+RAISE EXCEPTION 'vista_movimientos_financieros cambio/, 'pasivo e ingreso');
  assert.match(sql, /WITH \(security_invoker = true\)/, 'la vista conserva su security_invoker');
});

prueba('la conciliacion reintenta el asiento y la auditoria de comisiones lo mira', () => {
  assert.match(sql, /charge_context = ''notification_subscription''/);
  assert.match(sql, /create_accounting_entry_for_notificaciones\(r\.id\)/);
  assert.match(sql, /source_type = ''notification_subscription'' AND t\.id = e\.source_id/);
  assert.equal((sql.match(/se esperaba 1', veces;/g) ?? []).length, 2, 'ambas reescrituras exigen el fragmento exacto');
});

prueba('un cobro (una factura de Stripe) es una sola transaccion, y el CFDI enlaza con la suscripcion con acceso acotado', () => {
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_notificacion_factura_unica[\s\S]{0,120}\(metadata->>'stripe_invoice_id'\)[\s\S]{0,80}charge_context = 'notification_subscription'/);
  assert.match(sql, /suscripcion_notificacion_id uuid REFERENCES public\.suscripciones_notificaciones\(id\) ON DELETE SET NULL/);
  const politica = sql.slice(sql.indexOf('CREATE POLICY "Viajero ve el CFDI'));
  assert.match(politica, /FOR SELECT TO authenticated/);
  assert.match(politica, /s\.user_id = \(SELECT auth\.uid\(\)\)/);
  assert.ok(!/FOR (INSERT|UPDATE|DELETE|ALL)/.test(politica.split(';')[0]));
});

prueba('el CFDI: solo de un pago confirmado, siempre se emite, y el importe sale de lo cobrado', () => {
  assert.match(cfdi, /authorizeCfdiRequest\(supabase, req/);
  assert.ok(!/ownerUserId/.test(sinComentarios(cfdi)), 'sin rama de dueno: nadie se timbra importes');
  assert.match(cfdi, /tx\.status !== "succeeded"\) return responder\(\{ error: "Cobro no encontrado o no confirmado" \}, 404\)/);
  assert.match(cfdi, /const total = Math\.round\(Number\(tx\.amount\) \* 100\) \/ 100;/, 'el total es lo cobrado');
  assert.ok(!/req\.json\(\)[\s\S]{0,200}amount/.test(cfdi.slice(0, cfdi.indexOf('const consulta'))), 'el monto no viene del cuerpo');
  // Siempre se factura: sin datos fiscales, RFC generico con el nombre de la persona.
  assert.match(cfdi, /const RFC_GENERICO = "XAXX010101000";/);
  assert.ok((cfdi.match(/rfc: RFC_GENERICO/g) ?? []).length >= 2, 'viajero y agencia sin datos fiscales');
  // Misma clave que ToursRed Plus.
  assert.match(cfdi, /clave_prod_serv: "81161500"/);
  assert.match(cfdi, /clave_unidad: "E48"/);
  assert.match(cfdi, /payment_form: "04"/);
  assert.match(cfdi, /agency_id: agencyId/, 'la agencia ve su CFDI por su politica de siempre');
});

prueba('un intento en error se REUSA (no se acumulan registros en error) y uno timbrado o pendiente no se repite', () => {
  assert.match(cfdi, /previo\.status === "stamped" \|\| previo\.status === "pending"/);
  assert.match(cfdi, /if \(previo\) \{[\s\S]{0,200}\.update\(campos\)\.eq\("id", previo\.id\)/);
  assert.match(cfdi, /retry_count: reintentos \+ 1/);
});

prueba('el CFDI y el asiento parten el IVA igual: ningun precio de $0.01 a $10,000 los separa por un centavo', () => {
  assert.match(cfdi, /const iva = Math\.round\(total \* 16 \/ 116 \* 100\) \/ 100;/);
  let desacuerdos = 0;
  for (let c = 1; c <= 1_000_000; c++) {
    const baseAsiento = Math.round(c * 100 / 116); // round(total / 1.16, 2) en centavos
    const ivaCfdi = Math.round(c * 16 / 116);      // round(total * 16 / 116, 2) en centavos
    if (baseAsiento !== c - ivaCfdi) desacuerdos++;
  }
  assert.equal(desacuerdos, 0);
});

prueba('el cobro dispara el CFDI con el pago CONFIRMADO, y el correo, el reintento y la descarga conocen el tipo', () => {
  assert.match(compartido, /deps\.invocarFuncion\("generate-notification-cfdi", \{ payment_transaction_id: tx\.id \}\)/);
  assert.match(correo, /cfdi\.suscripcion_notificacion_id/);
  assert.match(correo, /cfdi\.invoice_type === "notification_subscription"/);
  assert.match(reintento, /invoice_type === "notification_subscription" && cfdi\.stripe_invoice_id/);
  assert.match(reintento, /generate-notification-cfdi/);
  assert.match(descarga, /cfdi\.suscripcion_notificacion_id/);
  assert.match(webhook, /registrarFallo,\n\s+enSegundoPlano:/, 'stripe-webhook inyecta registrarFallo y el resto de las dependencias');
});

prueba('el OTP no aparece en el codigo fiscal ni contable: nunca entra al cobro', () => {
  for (const f of [sql, cfdi]) assert.ok(!/\botp\b/i.test(sinComentarios(f)), 'sin OTP en codigo');
});

console.log(`OK: ${casos} casos del cobro de notificaciones, fase 3.`);
