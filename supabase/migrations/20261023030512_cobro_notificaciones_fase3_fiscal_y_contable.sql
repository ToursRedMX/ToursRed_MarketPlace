-- Cobro de las notificaciones por suscripcion: FASE 3, lo contable y lo fiscal. SIGUE APAGADO POR DEFECTO.
--
-- Decisiones de Axel (23-oct-2026), con el contador de por medio:
--   * Cuenta de ingreso NUEVA: 410 «Ingresos por notificaciones».
--   * El precio de Stripe YA incluye el IVA del 16%: base = total / 1.16, IVA = total - base.
--   * ToursRed factura SIEMPRE, a viajeros y a agencias, al cobrar (igual que las membresias). Sin datos fiscales: RFC generico
--     con el nombre de la persona (lo resuelve generate-notification-cfdi).
--   * Misma clave de producto/servicio que ToursRed Plus (81161500, unidad E48).
--   * Sin reembolso ni nota de credito: cancelar deja el periodo pagado y no se cobra el siguiente; un cobro fallido no factura
--     porque la factura la detona el pago confirmado.
--   * La comision de Stripe va a 604 (base) y 108 (IVA acreditable), como las demas.
--
-- ASIENTO de cada cobro (balanceado, se reconoce el ingreso al cobrar):
--     Dr 102 Bancos            total - comision        Cr 410 Ingresos por notificaciones   base
--     Dr 604 Comisiones         base de la comision     Cr 210 IVA trasladado por enterar     IVA
--     Dr 108 IVA acreditable    IVA de la comision
--
-- NO SE COPIA el asiento de ToursRed Plus (create_accounting_entry_for_membership): acredita el total a la cuenta 401
-- «Ingresos por comisiones», no a 403, y no separa IVA ni asienta la comision. Esta migracion no lo toca.
--
-- Se integra con lo que ya conoce los cobros por charge_context:
--   - payment_transactions: contexto nuevo 'notification_subscription' (CHECKs), con el pi_ real para que una disputa se ligue.
--   - vista_movimientos_financieros: el contexto cuenta como INGRESO (como la membresia). Sin esto la vista lo clasificaria como
--     PASIVO (anticipo de cliente) y «caja = pasivo + ingreso» cuadraria al centavo con la clasificacion equivocada.
--   - reconcile_paid_accounting_movements: reintenta el asiento de un cobro que se quedo sin el.
--   - comisiones_no_asentadas: audita que el asiento lleve la comision real.
--   - cfdi_invoices: tipo nuevo 'notification_subscription' y su enlace a la suscripcion.

-- 1. Cuenta de ingreso ------------------------------------------------------------------------------------------
INSERT INTO public.chart_of_accounts (code, sat_group_code, name, account_type, parent_code, level, nature, is_system, is_active, description)
SELECT '410', '410', 'Ingresos por notificaciones', 'ingreso', '40', 3, 'acreedora', false, true,
       'Suscripcion mensual de notificaciones por SMS (viajeros y agencias)'
 WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE code = '410');

-- 2. Los CHECKs que enumeran contextos y tipos --------------------------------------------------------------------
-- Se reescriben a partir de la definicion viva y fallan si el fragmento no aparece EXACTAMENTE una vez.
DO $$
DECLARE
  t record;
  def text;
  veces integer;
  viejo text := '''membership''::text,';
  nuevo text;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('public.payment_transactions', 'payment_transactions_charge_context_check', 'notification_subscription'),
      ('public.payment_transactions', 'payment_transactions_booking_id_requerido', 'notification_subscription'),
      ('public.accounting_entries',   'accounting_entries_source_type_check',       'notification_subscription'),
      ('public.cfdi_invoices',        'cfdi_invoices_invoice_type_check',           'notification_subscription')
    ) AS x(tabla, restriccion, valor)
  LOOP
    SELECT pg_get_constraintdef(c.oid) INTO def
      FROM pg_constraint c WHERE c.conrelid = t.tabla::regclass AND c.conname = t.restriccion;
    IF def IS NULL THEN RAISE EXCEPTION 'No existe la restriccion % de %', t.restriccion, t.tabla; END IF;
    veces := (length(def) - length(replace(def, viejo, ''))) / length(viejo);
    IF veces <> 1 THEN
      RAISE EXCEPTION '% cambio: el fragmento aparece % veces, se esperaba 1', t.restriccion, veces;
    END IF;
    nuevo := replace(def, viejo, viejo || ' ''' || t.valor || '''::text,');
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', t.tabla, t.restriccion);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', t.tabla, t.restriccion, nuevo);
  END LOOP;
END $$;

-- Un cobro (una factura de Stripe) es UNA transaccion: si Stripe reentrega el evento a la vez, la segunda inserta nada.
CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_notificacion_factura_unica
  ON public.payment_transactions ((metadata->>'stripe_invoice_id'))
  WHERE charge_context = 'notification_subscription';

-- 3. El CFDI se enlaza a la suscripcion --------------------------------------------------------------------------
ALTER TABLE public.cfdi_invoices
  ADD COLUMN IF NOT EXISTS suscripcion_notificacion_id uuid REFERENCES public.suscripciones_notificaciones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS cfdi_invoices_suscripcion_notificacion_idx
  ON public.cfdi_invoices (suscripcion_notificacion_id) WHERE suscripcion_notificacion_id IS NOT NULL;

-- El dueno de una agencia ya ve sus CFDI por agency_id (politica existente). El viajero ve los de SU suscripcion.
DROP POLICY IF EXISTS "Viajero ve el CFDI de su suscripcion de notificaciones" ON public.cfdi_invoices;
CREATE POLICY "Viajero ve el CFDI de su suscripcion de notificaciones" ON public.cfdi_invoices
  FOR SELECT TO authenticated USING (
    cfdi_invoices.invoice_type = 'notification_subscription'
    AND EXISTS (
      SELECT 1 FROM public.suscripciones_notificaciones s
       WHERE s.id = cfdi_invoices.suscripcion_notificacion_id
         AND s.tipo = 'viajero'
         AND s.user_id = (SELECT auth.uid())));

-- 4. El asiento de cada cobro -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_notificaciones(p_payment_transaction_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_tx public.payment_transactions;
  v_sub public.suscripciones_notificaciones;
  v_total numeric;
  v_base numeric;
  v_iva numeric;
  v_fee_base numeric := 0;
  v_fee_iva numeric := 0;
  v_fee numeric;
  v_nombre text;
  v_lineas jsonb;
BEGIN
  SELECT * INTO v_tx FROM public.payment_transactions
   WHERE id = p_payment_transaction_id AND status = 'succeeded' AND charge_context = 'notification_subscription';
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_total := round(COALESCE(v_tx.amount, 0), 2);
  IF v_total <= 0 THEN RETURN NULL; END IF;
  -- El precio de Stripe ya incluye el IVA del 16%.
  v_base := round(v_total / 1.16, 2);
  v_iva := v_total - v_base;

  -- La comision real que informo Stripe: desglose si lo mando; si solo mando el total, se parte en base e IVA; si no mando
  -- nada queda en cero (NO se estima: comisiones_no_asentadas lo delata y el ajuste es explicito).
  IF v_tx.processor_fee_base IS NOT NULL THEN
    v_fee_base := v_tx.processor_fee_base;
    v_fee_iva := COALESCE(v_tx.processor_fee_iva, 0);
  ELSIF COALESCE(v_tx.processor_fee, 0) > 0 THEN
    v_fee_base := round(v_tx.processor_fee / 1.16, 2);
    v_fee_iva := v_tx.processor_fee - v_fee_base;
  END IF;
  v_fee := v_fee_base + v_fee_iva;
  IF v_fee >= v_total THEN
    RAISE EXCEPTION 'La comision (%) no puede ser mayor o igual al cobro (%) de la transaccion %', v_fee, v_total, p_payment_transaction_id;
  END IF;

  SELECT * INTO v_sub FROM public.suscripciones_notificaciones WHERE id = v_tx.charge_reference_id;
  IF v_sub.tipo = 'agencia' THEN
    SELECT a.name INTO v_nombre FROM public.agencies a WHERE a.id = v_sub.agency_id;
  ELSE
    SELECT trim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) INTO v_nombre FROM public.users u WHERE u.id = v_sub.user_id;
  END IF;
  v_nombre := COALESCE(NULLIF(v_nombre, ''), '(sin nombre)');

  v_lineas := jsonb_build_array(
    jsonb_build_object('account_code', '102', 'description', 'Cobro suscripcion de notificaciones (neto de comision) — ' || v_nombre, 'debit', v_total - v_fee, 'credit', 0));
  IF v_fee_base > 0 THEN
    v_lineas := v_lineas || jsonb_build_object('account_code', '604', 'description', 'Comision Stripe — suscripcion de notificaciones', 'debit', v_fee_base, 'credit', 0);
  END IF;
  IF v_fee_iva > 0 THEN
    v_lineas := v_lineas || jsonb_build_object('account_code', '108', 'description', 'IVA acreditable de la comision Stripe', 'debit', v_fee_iva, 'credit', 0);
  END IF;
  v_lineas := v_lineas
    || jsonb_build_object('account_code', '410', 'description', 'Ingreso suscripcion de notificaciones — ' || v_nombre, 'debit', 0, 'credit', v_base)
    || jsonb_build_object('account_code', '210', 'description', 'IVA 16% suscripcion de notificaciones', 'debit', 0, 'credit', v_iva);

  RETURN public.create_accounting_entry_atomic(
    'ingreso',
    'Suscripcion de notificaciones — ' || CASE WHEN v_sub.tipo = 'agencia' THEN 'agencia ' ELSE 'viajero ' END || v_nombre,
    'notification_subscription',
    p_payment_transaction_id,
    (v_tx.created_at AT TIME ZONE 'America/Mexico_City')::date,
    v_lineas);
END
$function$;

REVOKE ALL ON FUNCTION public.create_accounting_entry_for_notificaciones(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_accounting_entry_for_notificaciones(uuid) TO service_role;

-- 5. La vista de movimientos: el cobro es INGRESO, no pasivo -----------------------------------------------------
DO $$
DECLARE
  d text;
  veces integer;
  viejo text := '(pt.charge_context = ''membership''::text)';
  nuevo text := '(pt.charge_context = ANY (ARRAY[''membership''::text, ''notification_subscription''::text]))';
BEGIN
  d := pg_get_viewdef('public.vista_movimientos_financieros'::regclass);
  veces := (length(d) - length(replace(d, viejo, ''))) / length(viejo);
  IF veces <> 2 THEN
    RAISE EXCEPTION 'vista_movimientos_financieros cambio: el fragmento aparece % veces, se esperaban 2 (pasivo e ingreso)', veces;
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.vista_movimientos_financieros WITH (security_invoker = true) AS '
          || rtrim(replace(d, viejo, nuevo), E'; \n\r');
END $$;

-- 6. La conciliacion y la auditoria de comisiones lo conocen ------------------------------------------------------
DO $$
DECLARE
  d text;
  veces integer;
  viejo text;
  nuevo text;
BEGIN
  -- reconcile_paid_accounting_movements: reintenta el asiento de un cobro que se quedo sin el.
  SELECT pg_get_functiondef('public.reconcile_paid_accounting_movements(date,date)'::regprocedure) INTO d;
  viejo := 'v_counts := v_counts || jsonb_build_object(''memberships'', v_count);';
  veces := (length(d) - length(replace(d, viejo, ''))) / length(viejo);
  IF veces <> 1 THEN RAISE EXCEPTION 'reconcile_paid_accounting_movements cambio: el fragmento aparece % veces, se esperaba 1', veces; END IF;
  nuevo := viejo || E'\n\n  v_count := 0;\n  FOR r IN\n    SELECT pt.id\n    FROM payment_transactions pt\n'
        || E'    WHERE pt.status = ''succeeded'' AND pt.charge_context = ''notification_subscription''\n'
        || E'      AND pt.created_at::date BETWEEN p_from_date AND p_to_date\n'
        || E'      AND NOT EXISTS (SELECT 1 FROM accounting_entries ae WHERE ae.source_type = ''notification_subscription'' AND ae.source_id = pt.id)\n'
        || E'  LOOP\n    v_result := public.create_accounting_entry_for_notificaciones(r.id);\n'
        || E'    IF v_result IS NOT NULL THEN v_count := v_count + 1; END IF;\n  END LOOP;\n'
        || E'  v_counts := v_counts || jsonb_build_object(''notificaciones'', v_count);';
  EXECUTE replace(d, viejo, nuevo);

  -- comisiones_no_asentadas: audita que el asiento lleve la comision real.
  SELECT pg_get_functiondef('public.comisiones_no_asentadas()'::regprocedure) INTO d;
  viejo := 'OR (e.source_type = ''membership'' AND t.id = e.source_id)';
  veces := (length(d) - length(replace(d, viejo, ''))) / length(viejo);
  IF veces <> 1 THEN RAISE EXCEPTION 'comisiones_no_asentadas cambio: el fragmento aparece % veces, se esperaba 1', veces; END IF;
  nuevo := viejo || E'\n       OR (e.source_type = ''notification_subscription'' AND t.id = e.source_id)';
  EXECUTE replace(d, viejo, nuevo);
END $$;
