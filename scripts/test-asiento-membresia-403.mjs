// Contratos de la migracion 20261023043215: membresias de ToursRed Plus y suscripcion de notificaciones van a la cuenta 403.
// Tres correcciones al asiento de Plus (todas confirmadas por Axel el 23-oct-2026):
//   1. el ingreso va a 403 «Ingresos por membresias», NO a 401 «Ingresos por comisiones»;
//   2. el IVA ya incluido en el precio se separa a 210;
//   3. la comision real de Stripe se asienta en 604/108 y Bancos queda neto.
// Y el CFDI de la membresia usa forma de pago 04 (tarjeta), no 03 (transferencia).
// Lo que NO se hace: reclasificar los asientos historicos de membresia (son pruebas, se depuran antes de las UAT).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const leer = (ruta) => readFileSync(new URL('../' + ruta, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sinComentarios = (t) => t.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('--') && !l.trim().startsWith('*')).join('\n');

const sql = leer('supabase/migrations/20261023043215_membresias_y_notificaciones_a_la_cuenta_403.sql');
const cfdi = leer('supabase/functions/generate-membership-cfdi/index.ts');

let casos = 0;
const prueba = (nombre, fn) => { fn(); casos++; };

const funcion = (() => {
  const i = sql.indexOf('CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_membership');
  assert.ok(i > -1, 'no esta la funcion');
  return sinComentarios(sql.slice(i, sql.indexOf('$function$;', sql.indexOf('AS $function$', i) + 13)));
})();

prueba('el ingreso de la membresia va a la 403 con el IVA separado a la 210, y jamas a la 401', () => {
  assert.match(funcion, /'403', 'Ingreso membresía — ' \|\| COALESCE\(v_membership\.plan_type, ''\), 0, v_base/);
  assert.match(funcion, /'210', 'IVA 16% membresía ToursRed Plus', 0, v_iva/);
  assert.ok(!/'401'/.test(funcion), 'ni una sola partida a comisiones');
  assert.match(funcion, /v_base := round\(v_total \/ 1\.16, 2\);/, 'el precio ya incluye el IVA');
  assert.match(funcion, /v_iva := v_total - v_base;/);
});

prueba('Bancos queda NETO de la comision, que se asienta en 604 (base) y 108 (IVA)', () => {
  assert.match(funcion, /'102', 'Cobro membresía ToursRed Plus \(neto de comisión\)', v_total - v_fee, 0/);
  assert.match(funcion, /'604'[^;]*v_fee_base, 0/);
  assert.match(funcion, /'108'[^;]*v_fee_iva, 0/);
  assert.match(funcion, /IF v_tx\.processor_fee_base IS NOT NULL THEN/, 'usa el desglose real de Stripe');
  assert.ok(!/estimar_comision|stripe_commission_pct/.test(funcion), 'no se estima');
  assert.match(funcion, /v_fee >= v_total THEN\s+RAISE EXCEPTION/);
});

prueba('sigue siendo idempotente por su origen, de solo cobros confirmados de membresia, y conserva el UUID fiscal', () => {
  assert.match(funcion, /ae\.source_type = 'membership' AND ae\.source_id = p_payment_transaction_id/);
  assert.match(funcion, /status = 'succeeded' AND charge_context = 'membership'/);
  assert.match(funcion, /v_cfdi_uuid/);
  assert.ok((funcion.match(/v_cfdi_uuid\)/g) ?? []).length >= 4, 'todas las partidas llevan el UUID');
});

prueba('SECURITY DEFINER con search_path fijo; solo el servicio la ejecuta', () => {
  assert.match(funcion, /SECURITY DEFINER SET search_path TO ''/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.create_accounting_entry_for_membership\(uuid\) FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.create_accounting_entry_for_membership\(uuid\) TO service_role;/);
});

prueba('las notificaciones se mudan de la 410 a la 403 exigiendo el fragmento exacto, y la 410 se retira sin borrar historia', () => {
  assert.match(sql, /viejo text := '''account_code'', ''410''';\s+nuevo text := '''account_code'', ''403''';/);
  assert.match(sql, /IF veces <> 1 THEN\s+RAISE EXCEPTION 'create_accounting_entry_for_notificaciones cambio/);
  assert.match(sql, /IF EXISTS \(SELECT 1 FROM public\.accounting_entry_lines WHERE account_code = '410'\) THEN\s+UPDATE public\.chart_of_accounts SET is_active = false WHERE code = '410';\s+ELSE\s+DELETE FROM public\.chart_of_accounts WHERE code = '410';/);
});

prueba('NO se reclasifican los asientos historicos (se depuran antes de las UAT)', () => {
  const codigo = sinComentarios(sql);
  assert.ok(!/UPDATE\s+public\.accounting_entr(y_lines|ies)/i.test(codigo));
  assert.ok(!/DELETE\s+FROM\s+public\.accounting_entr(y_lines|ies)/i.test(codigo));
  assert.ok(!/INSERT INTO public\.accounting_entries[\s\S]{0,40}'manual'/.test(codigo), 'sin asiento de ajuste');
});

prueba('el CFDI de la membresia se cobra con tarjeta: forma de pago 04, no 03', () => {
  assert.match(cfdi, /payment_form: request\.payment_form \?\? "04",/);
  assert.ok(!/payment_form \?\? "03"/.test(cfdi));
});

console.log(`OK: ${casos} casos del asiento de membresias y notificaciones en la 403.`);
