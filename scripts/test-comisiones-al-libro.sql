-- ============================================================================
-- La comision que llega despues del asiento acaba en el libro
-- ============================================================================
--
-- Prueba `comisiones_no_asentadas()` y `asentar_comisiones_faltantes()` de
-- `20260911030000` contra un Postgres de verdad, con el esquema minimo que
-- necesitan.
--
-- QUE CUBRE, Y POR QUE CADA CASO
--
-- Los cuatro primeros casos son los cuatro errores que se cometieron al
-- escribir la consulta de deteccion a mano contra produccion. Ninguno fallaba
-- solo: cada uno daba un numero plausible y distinto ($2,213.91, $5,566.69,
-- $1,681.75) antes de llegar al bueno ($2,157.01).
--
--   1. Un asiento sin comision se detecta y se ajusta.
--   2. Una reserva con plan de pagos NO cuenta su mensualidad dos veces.
--   3. MercadoPago/Conekta, sin desglose guardado, NO parecen tener comision
--      de mas: hay que aplicar la cascada base/1.16.
--   4. Correrlo dos veces no duplica: la idempotencia es por (manual, asiento).
--   5. Un delta NEGATIVO no se corrige solo, se reporta.
--
--   psql -f scripts/test-comisiones-al-libro.sql
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- Esquema minimo
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('prueba.uid', true), '')::uuid;
$$;
CREATE OR REPLACE FUNCTION public.is_admin_user() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT true $$;

CREATE TABLE public.chart_of_accounts (
  code text PRIMARY KEY, name text NOT NULL, account_type text, is_active boolean DEFAULT true);
INSERT INTO public.chart_of_accounts (code, name, account_type) VALUES
  ('102','Bancos','activo'), ('108','IVA Acreditable','activo'),
  ('208','Anticipos de clientes','pasivo'),
  ('604','Comisiones bancarias y pasarelas','gasto');

CREATE TABLE public.accounting_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number text NOT NULL,
  entry_type text NOT NULL
    CHECK (entry_type = ANY (ARRAY['ingreso','egreso','diario','apertura'])),
  entry_date date NOT NULL, period_year integer, period_month integer,
  description text,
  source_type text
    CHECK (source_type = ANY (ARRAY['booking','manual','membership',
                                    'payment_plan_installment'])),
  source_id uuid, is_posted boolean DEFAULT false, posted_at timestamptz,
  updated_at timestamptz DEFAULT now());

CREATE TABLE public.accounting_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid REFERENCES public.accounting_entries(id),
  line_number integer, account_code text, description text,
  debit numeric DEFAULT 0, credit numeric DEFAULT 0);

CREATE TABLE public.payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid, status text, amount numeric,
  payment_processor text, charge_context text, charge_reference_id uuid,
  processor_fee numeric DEFAULT 0,
  processor_fee_base numeric, processor_fee_iva numeric);

CREATE TABLE public.audit_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  error_message text, sqlstate text, raw_payload jsonb,
  created_at timestamptz DEFAULT now());

CREATE OR REPLACE FUNCTION public.generate_entry_number(p_type text, p_year int, p_month int)
RETURNS text LANGUAGE sql AS $$
  SELECT CASE p_type WHEN 'ingreso' THEN 'I' WHEN 'egreso' THEN 'E' ELSE 'D' END
      || '-' || p_year || '-' || lpad(p_month::text,2,'0') || '-'
      || lpad(((SELECT count(*) FROM public.accounting_entries
                WHERE entry_type = p_type) + 1)::text, 4, '0');
$$;

CREATE OR REPLACE FUNCTION public.create_accounting_entry_atomic(
  p_entry_type text, p_description text, p_source_type text,
  p_source_id uuid, p_entry_date date, p_lines jsonb)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_existing uuid; v_entry uuid; v_d numeric; v_c numeric;
BEGIN
  SELECT id INTO v_existing FROM public.accounting_entries
  WHERE source_type = p_source_type AND source_id = p_source_id LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT COALESCE(SUM((x->>'debit')::numeric),0), COALESCE(SUM((x->>'credit')::numeric),0)
  INTO v_d, v_c FROM jsonb_array_elements(p_lines) x;
  IF jsonb_array_length(p_lines) < 2 OR v_d <= 0 OR v_d <> v_c THEN
    RAISE EXCEPTION 'El asiento debe tener al menos dos partidas y estar balanceado';
  END IF;

  v_entry := gen_random_uuid();
  INSERT INTO public.accounting_entries (id, entry_number, entry_type, entry_date,
    period_year, period_month, description, source_type, source_id, is_posted, posted_at)
  VALUES (v_entry,
    public.generate_entry_number(p_entry_type,
      EXTRACT(YEAR FROM p_entry_date)::int, EXTRACT(MONTH FROM p_entry_date)::int),
    p_entry_type, p_entry_date, EXTRACT(YEAR FROM p_entry_date)::int,
    EXTRACT(MONTH FROM p_entry_date)::int, p_description, p_source_type, p_source_id,
    true, now());

  INSERT INTO public.accounting_entry_lines (entry_id, line_number, account_code,
    description, debit, credit)
  SELECT v_entry, row_number() OVER (), x->>'account_code',
         COALESCE(x->>'description', p_description),
         COALESCE((x->>'debit')::numeric,0), COALESCE((x->>'credit')::numeric,0)
  FROM jsonb_array_elements(p_lines) x;
  RETURN v_entry;
END $$;

\ir ../supabase/migrations/20260911030000_comision_que_llega_tarde_al_asiento.sql

-- ---------------------------------------------------------------------------
-- Datos: reproducen los cuatro errores de la consulta original
-- ---------------------------------------------------------------------------
\set bk1 '''11111111-1111-1111-1111-111111111111'''
\set bk2 '''22222222-2222-2222-2222-222222222222'''
\set bk3 '''33333333-3333-3333-3333-333333333333'''
\set plan1 '''aaaaaaaa-1111-1111-1111-111111111111'''

-- A) Reserva simple, Stripe, comision escrita DESPUES del asiento.
INSERT INTO public.accounting_entries (id, entry_number, entry_type, entry_date,
  period_year, period_month, source_type, source_id, is_posted)
VALUES ('e0000001-0000-0000-0000-000000000001','I-2026-07-0001','ingreso','2026-07-21',
        2026,7,'booking',:bk1::uuid,true);
INSERT INTO public.accounting_entry_lines (entry_id, line_number, account_code, debit, credit)
VALUES ('e0000001-0000-0000-0000-000000000001',1,'102',1666.47,0),
       ('e0000001-0000-0000-0000-000000000001',2,'208',0,1666.47);
INSERT INTO public.payment_transactions (id, booking_id, status, amount, payment_processor,
  charge_context, processor_fee, processor_fee_base, processor_fee_iva)
VALUES ('c0000001-0000-0000-0000-000000000001',:bk1::uuid,'succeeded',1666.47,'stripe',
        'booking_deposit',82.74,71.33,11.41);

-- B) Reserva CON PLAN DE PAGOS: deposito + mensualidad, cada uno con su asiento.
--    Mapear por «la tx mas reciente del booking» contaria la mensualidad dos veces.
INSERT INTO public.accounting_entries (id, entry_number, entry_type, entry_date,
  period_year, period_month, source_type, source_id, is_posted)
VALUES ('e0000002-0000-0000-0000-000000000002','I-2026-07-0002','ingreso','2026-07-16',
        2026,7,'booking',:bk2::uuid,true),
       ('e0000003-0000-0000-0000-000000000003','I-2026-07-0042','ingreso','2026-07-16',
        2026,7,'payment_plan_installment',:plan1::uuid,true);
INSERT INTO public.accounting_entry_lines (entry_id, line_number, account_code, debit, credit)
VALUES ('e0000002-0000-0000-0000-000000000002',1,'102',3426.51,0),
       ('e0000002-0000-0000-0000-000000000002',2,'208',0,3426.51),
       ('e0000003-0000-0000-0000-000000000003',1,'102',2118.91,0),
       ('e0000003-0000-0000-0000-000000000003',2,'208',0,2118.91);
INSERT INTO public.payment_transactions (id, booking_id, status, amount, payment_processor,
  charge_context, charge_reference_id, processor_fee, processor_fee_base, processor_fee_iva)
VALUES ('c0000002-0000-0000-0000-000000000002',:bk2::uuid,'succeeded',3426.51,'stripe',
        'booking_deposit',NULL,166.45,143.49,22.96),
       ('c0000003-0000-0000-0000-000000000003',:bk2::uuid,'succeeded',2118.91,'stripe',
        'payment_plan_installment',:plan1::uuid,104.26,89.88,14.38);

-- C) MercadoPago: comision guardada SIN desglose (base e iva nulas), y el
--    asiento YA la trae derivada. No es un hueco.
INSERT INTO public.accounting_entries (id, entry_number, entry_type, entry_date,
  period_year, period_month, source_type, source_id, is_posted)
VALUES ('e0000004-0000-0000-0000-000000000004','I-2026-09-0001','ingreso','2026-09-05',
        2026,9,'booking',:bk3::uuid,true);
INSERT INTO public.accounting_entry_lines (entry_id, line_number, account_code, debit, credit)
VALUES ('e0000004-0000-0000-0000-000000000004',1,'102',800.96,0),
       ('e0000004-0000-0000-0000-000000000004',2,'604',25.03,0),
       ('e0000004-0000-0000-0000-000000000004',3,'108',4.01,0),
       ('e0000004-0000-0000-0000-000000000004',4,'208',0,830.00);
INSERT INTO public.payment_transactions (id, booking_id, status, amount, payment_processor,
  charge_context, processor_fee, processor_fee_base, processor_fee_iva)
VALUES ('c0000004-0000-0000-0000-000000000004',:bk3::uuid,'succeeded',830.00,'mercadopago',
        'booking_deposit',29.04,NULL,NULL);

-- ---------------------------------------------------------------------------
-- Casos
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_n integer; v_r jsonb; v_base numeric; v_iva numeric; v_bancos numeric;
BEGIN
  -- 1. Deteccion: exactamente 3 huecos (A, B-deposito, B-mensualidad).
  --    MercadoPago NO debe aparecer.
  SELECT count(*) INTO v_n FROM public.comisiones_no_asentadas();
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'Caso 1: se esperaban 3 huecos y hay %', v_n;
  END IF;

  -- 2. MercadoPago fuera: la cascada base/1.16 evita el falso positivo que
  --    daba comparar processor_fee_base a secas.
  IF EXISTS (SELECT 1 FROM public.comisiones_no_asentadas() WHERE procesador = 'mercadopago') THEN
    RAISE EXCEPTION 'Caso 2: MercadoPago no tiene hueco, su asiento ya trae la comision derivada';
  END IF;

  -- 3. Sin doble conteo: deposito 166.45 y mensualidad 104.26, cada uno UNA vez.
  SELECT round(sum(d_base + d_iva), 2) INTO v_base FROM public.comisiones_no_asentadas();
  IF v_base <> 353.45 THEN    -- 82.74 + 166.45 + 104.26
    RAISE EXCEPTION 'Caso 3: el total de huecos deberia ser 353.45 y es % (¿mensualidad contada dos veces?)', v_base;
  END IF;

  -- 4. El ajuste se aplica.
  v_r := public.asentar_comisiones_faltantes();
  IF (v_r->>'ajustes')::int <> 3 THEN
    RAISE EXCEPTION 'Caso 4: se esperaban 3 ajustes y hubo %', v_r->>'ajustes';
  END IF;
  IF (v_r->>'total')::numeric <> 353.45 THEN
    RAISE EXCEPTION 'Caso 4: el total ajustado deberia ser 353.45 y es %', v_r->>'total';
  END IF;

  -- 5. Y las partidas son las correctas: 604 y 108 al debe, 102 al haber.
  -- coalesce OBLIGATORIO: sum() sobre cero filas da NULL, y `NULL <> 353.45`
  -- es NULL, asi que el IF de abajo no dispararia. Se descubrio mutando el
  -- abono de 102 a 208: la prueba pasaba con el ajuste escrito contra la
  -- cuenta equivocada.
  SELECT coalesce(round(sum(l.debit)  FILTER (WHERE l.account_code='604'),2), 0),
         coalesce(round(sum(l.debit)  FILTER (WHERE l.account_code='108'),2), 0),
         coalesce(round(sum(l.credit) FILTER (WHERE l.account_code='102'),2), 0)
  INTO v_base, v_iva, v_bancos
  FROM public.accounting_entry_lines l
  JOIN public.accounting_entries e ON e.id = l.entry_id
  WHERE e.entry_type = 'diario' AND e.source_type = 'manual';
  IF v_base <> 304.70 OR v_iva <> 48.75 OR v_bancos <> 353.45 THEN
    RAISE EXCEPTION 'Caso 5: partidas mal: 604=% 108=% 102=%', v_base, v_iva, v_bancos;
  END IF;

  -- 6. Cada ajuste cuadra por si mismo.
  IF EXISTS (
    SELECT 1 FROM public.accounting_entry_lines l
    JOIN public.accounting_entries e ON e.id = l.entry_id
    WHERE e.entry_type = 'diario'
    GROUP BY l.entry_id HAVING abs(sum(l.debit) - sum(l.credit)) > 0.01
  ) THEN
    RAISE EXCEPTION 'Caso 6: quedo un asiento de ajuste descuadrado';
  END IF;

  -- 7. La deteccion queda en CERO: cuenta el asiento original mas su ajuste.
  SELECT count(*) INTO v_n FROM public.comisiones_no_asentadas();
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Caso 7: tras ajustar siguen % huecos; la funcion no cuenta su propio ajuste', v_n;
  END IF;

  -- 8. IDEMPOTENCIA: correrlo otra vez no genera nada.
  v_r := public.asentar_comisiones_faltantes();
  IF (v_r->>'ajustes')::int <> 0 THEN
    RAISE EXCEPTION 'Caso 8: la segunda corrida genero % ajustes: duplicaria el gasto', v_r->>'ajustes';
  END IF;
  SELECT count(*) INTO v_n FROM public.accounting_entries WHERE entry_type = 'diario';
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'Caso 8: hay % polizas de diario y deberian ser 3', v_n;
  END IF;

  RAISE NOTICE 'Casos 1-8 OK';
END $$;

-- ---------------------------------------------------------------------------
-- 10. Un cobro SIN desglose guardado y CON hueco real SI se detecta
-- ---------------------------------------------------------------------------
-- El caso 2 solo comprueba que MercadoPago no de falso positivo. Quitar la
-- cascada `coalesce(base, fee/1.16)` deja `base_real` en NULL, y entonces
-- `abs(NULL - x) > 0.01` es NULL: la fila se EXCLUYE en silencio. O sea que la
-- mutacion cambia un falso positivo por un falso negativo, y el caso 2 pasa
-- igual. Este cierra esa puerta.
DO $$
DECLARE v_n integer; v_d numeric;
BEGIN
  INSERT INTO public.accounting_entries (id, entry_number, entry_type, entry_date,
    period_year, period_month, source_type, source_id, is_posted)
  VALUES ('e0000005-0000-0000-0000-000000000005','I-2026-09-0020','ingreso','2026-09-09',
          2026,9,'booking','44444444-4444-4444-4444-444444444444',true);
  INSERT INTO public.accounting_entry_lines (entry_id, line_number, account_code, debit, credit)
  VALUES ('e0000005-0000-0000-0000-000000000005',1,'102',500.00,0),
         ('e0000005-0000-0000-0000-000000000005',2,'208',0,500.00);
  -- Comision 116.00 sin desglose: la cascada debe derivar 100.00 + 16.00.
  INSERT INTO public.payment_transactions (id, booking_id, status, amount, payment_processor,
    charge_context, processor_fee, processor_fee_base, processor_fee_iva)
  VALUES ('c0000005-0000-0000-0000-000000000005','44444444-4444-4444-4444-444444444444',
          'succeeded',500.00,'conekta','booking_deposit',116.00,NULL,NULL);

  SELECT count(*) INTO v_n FROM public.comisiones_no_asentadas()
  WHERE entry_number = 'I-2026-09-0020';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Caso 10: un cobro sin desglose y con hueco real tiene que detectarse (sin la cascada queda NULL y se excluye callado)';
  END IF;

  SELECT round(d_base, 2) INTO v_d FROM public.comisiones_no_asentadas()
  WHERE entry_number = 'I-2026-09-0020';
  -- El IS NULL va SEPARADO y primero. Sin la cascada, `d_base` sale NULL y
  -- `NULL <> 100.00` es NULL: el IF no dispara y la mutacion sobrevive. Es la
  -- misma trampa que dejo pasar el abono a la cuenta equivocada, y por eso
  -- aqui se afirma explicitamente que hay valor antes de compararlo.
  IF v_d IS NULL THEN
    RAISE EXCEPTION 'Caso 10: d_base salio NULL — la cascada no esta derivando la base';
  END IF;
  IF v_d <> 100.00 THEN
    RAISE EXCEPTION 'Caso 10: la base derivada deberia ser 100.00 y es %', v_d;
  END IF;

  -- Y se limpia para no alterar los casos siguientes.
  DELETE FROM public.accounting_entry_lines WHERE entry_id = 'e0000005-0000-0000-0000-000000000005';
  DELETE FROM public.accounting_entries WHERE id = 'e0000005-0000-0000-0000-000000000005';
  DELETE FROM public.payment_transactions WHERE id = 'c0000005-0000-0000-0000-000000000005';

  RAISE NOTICE 'Caso 10 OK';
END $$;

-- ---------------------------------------------------------------------------
-- 9. Un delta NEGATIVO no se corrige solo: se reporta
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_r jsonb; v_n integer;
BEGIN
  -- El libro tiene mas comision que el cobro. Corregirlo seria ABONAR a 604,
  -- o sea bajar un gasto ya registrado: eso lo mira una persona.
  UPDATE public.payment_transactions
  SET processor_fee = 10.00, processor_fee_base = 8.62, processor_fee_iva = 1.38
  WHERE id = 'c0000004-0000-0000-0000-000000000004';

  IF NOT EXISTS (SELECT 1 FROM public.comisiones_no_asentadas() WHERE d_base < 0) THEN
    RAISE EXCEPTION 'Caso 9: deberia detectarse el delta negativo';
  END IF;

  v_r := public.asentar_comisiones_faltantes();
  IF (v_r->>'ajustes')::int <> 0 THEN
    RAISE EXCEPTION 'Caso 9: un delta negativo NO debe ajustarse solo, y se ajustaron %', v_r->>'ajustes';
  END IF;
  IF jsonb_array_length(v_r->'para_revisar') <> 1 THEN
    RAISE EXCEPTION 'Caso 9: el delta negativo tiene que reportarse para revision humana';
  END IF;

  SELECT count(*) INTO v_n FROM public.audit_errors
  WHERE error_message LIKE '%mas comision que el cobro%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Caso 9: tiene que quedar rastro en audit_errors';
  END IF;

  RAISE NOTICE 'Caso 9 OK';
END $$;

ROLLBACK;

\echo 'Comisiones al libro: 10/10 casos OK'
