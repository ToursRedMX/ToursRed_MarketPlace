-- Las membresias de ToursRed Plus y la suscripcion de notificaciones van a la MISMA cuenta de ingreso: 403 «Ingresos por membresias».
-- Decision de Axel (23-oct-2026).
--
-- Tres correcciones al asiento de ToursRed Plus (create_accounting_entry_for_membership), encontradas al construir el de las
-- notificaciones y confirmadas por Axel:
--   1. Acreditaba el total a 401 «Ingresos por comisiones» (comisiones propias por tours vendidos). Es el ingreso de la 403.
--      La membresia comprada DENTRO de una reserva ya iba a 403 (create_accounting_entry_for_booking); la comprada sola iba a 401:
--      el mismo ingreso caia en dos cuentas segun como se compro.
--   2. No separaba el IVA: el precio de la membresia YA lo incluye (el CFDI lo parte asi), asi que todo iba a ingreso y nada a
--      210 «IVA trasladado por enterar».
--   3. No asentaba la comision de Stripe: Bancos quedaba por el bruto y la comision no llegaba a 604/108.
--
-- ASIENTO de cada cobro de membresia (igual que el de notificaciones):
--     Dr 102 Bancos            total - comision        Cr 403 Ingresos por membresias   base (total / 1.16)
--     Dr 604 Comisiones         base de la comision     Cr 210 IVA trasladado por enterar  IVA
--     Dr 108 IVA acreditable    IVA de la comision
--
-- Los 4 asientos de membresia que ya estan en 401 (pruebas de Axel, $1,627.46) NO se reclasifican: se depuran antes de las UAT.
-- Esta migracion solo cambia lo que se asiente de aqui en adelante.

-- 1. Notificaciones: de la 410 a la 403 ------------------------------------------------------------------------------
DO $$
DECLARE
  d text;
  veces integer;
  viejo text := '''account_code'', ''410''';
  nuevo text := '''account_code'', ''403''';
BEGIN
  SELECT pg_get_functiondef('public.create_accounting_entry_for_notificaciones(uuid)'::regprocedure) INTO d;
  veces := (length(d) - length(replace(d, viejo, ''))) / length(viejo);
  IF veces <> 1 THEN
    RAISE EXCEPTION 'create_accounting_entry_for_notificaciones cambio: el fragmento aparece % veces, se esperaba 1', veces;
  END IF;
  EXECUTE replace(d, viejo, nuevo);
END $$;

-- La 410 se creo en la fase 3 y nunca se uso. Si por algo ya tuviera partidas se desactiva (no se borra historia); si no, se retira.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.accounting_entry_lines WHERE account_code = '410') THEN
    UPDATE public.chart_of_accounts SET is_active = false WHERE code = '410';
  ELSE
    DELETE FROM public.chart_of_accounts WHERE code = '410';
  END IF;
END $$;

-- 2. ToursRed Plus: a 403, con IVA separado y la comision de Stripe ------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_membership(p_payment_transaction_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_tx public.payment_transactions;
  v_membership record;
  v_cfdi_uuid text;
  v_entry_id uuid;
  v_entry_number text;
  v_year integer;
  v_month integer;
  v_total numeric;
  v_base numeric;
  v_iva numeric;
  v_fee_base numeric := 0;
  v_fee_iva numeric := 0;
  v_fee numeric;
  v_n integer := 1;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.accounting_entries ae
    WHERE ae.source_type = 'membership' AND ae.source_id = p_payment_transaction_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_tx FROM public.payment_transactions
   WHERE id = p_payment_transaction_id AND status = 'succeeded' AND charge_context = 'membership';
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT m.*, u.first_name, u.last_name INTO v_membership
    FROM public.memberships m
    LEFT JOIN public.users u ON u.id = m.user_id
   WHERE m.id = v_tx.charge_reference_id;

  v_total := round(COALESCE(v_tx.amount, 0), 2);
  IF v_total <= 0 THEN RETURN NULL; END IF;
  -- El precio de la membresia YA incluye el IVA del 16% (asi lo parte su CFDI).
  v_base := round(v_total / 1.16, 2);
  v_iva := v_total - v_base;

  -- La comision real que informo Stripe (desglose; o su total partido en base e IVA). Si no informo nada queda en cero, NO se
  -- estima: comisiones_no_asentadas lo delata.
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

  SELECT uuid_fiscal INTO v_cfdi_uuid
    FROM public.cfdi_invoices
   WHERE membership_id = v_membership.id AND status = 'stamped'
   ORDER BY created_at DESC LIMIT 1;

  v_year := EXTRACT(YEAR FROM COALESCE(v_tx.created_at, CURRENT_TIMESTAMP))::integer;
  v_month := EXTRACT(MONTH FROM COALESCE(v_tx.created_at, CURRENT_TIMESTAMP))::integer;
  v_entry_number := public.generate_entry_number('ingreso', v_year, v_month);

  INSERT INTO public.accounting_entries (
    entry_number, entry_type, entry_date, period_year, period_month,
    description, source_type, source_id, is_posted
  ) VALUES (
    v_entry_number, 'ingreso',
    COALESCE(v_tx.created_at::date, CURRENT_DATE),
    v_year, v_month,
    'Membresía ToursRed Plus — ' || COALESCE(v_membership.plan_type, '') ||
    ' — Usuario: ' || COALESCE(v_membership.first_name, '') || ' ' || COALESCE(v_membership.last_name, ''),
    'membership', p_payment_transaction_id, true
  ) RETURNING id INTO v_entry_id;

  -- Bancos, NETO de la comision
  INSERT INTO public.accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, v_n, '102', 'Cobro membresía ToursRed Plus (neto de comisión)', v_total - v_fee, 0, v_cfdi_uuid);
  v_n := v_n + 1;

  IF v_fee_base > 0 THEN
    INSERT INTO public.accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, v_n, '604', 'Comisión Stripe — membresía ToursRed Plus', v_fee_base, 0, v_cfdi_uuid);
    v_n := v_n + 1;
  END IF;
  IF v_fee_iva > 0 THEN
    INSERT INTO public.accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, v_n, '108', 'IVA acreditable de la comisión Stripe', v_fee_iva, 0, v_cfdi_uuid);
    v_n := v_n + 1;
  END IF;

  -- Ingreso por membresias (403) y el IVA trasladado (210)
  INSERT INTO public.accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, v_n, '403', 'Ingreso membresía — ' || COALESCE(v_membership.plan_type, ''), 0, v_base, v_cfdi_uuid);
  v_n := v_n + 1;
  INSERT INTO public.accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, v_n, '210', 'IVA 16% membresía ToursRed Plus', 0, v_iva, v_cfdi_uuid);

  RETURN v_entry_id;
END
$function$;

-- Solo el servicio la ejecuta (la llaman stripe-webhook y la conciliacion); antes tambien estaba cerrada a navegadores.
REVOKE ALL ON FUNCTION public.create_accounting_entry_for_membership(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_accounting_entry_for_membership(uuid) TO service_role;
