-- Prueba de `20261016042518_puntos_tope_50_y_pago_mixto_con_cash.sql`.
--
-- Corre la migracion REAL (con \ir) sobre un esquema minimo, con
-- deduct_points y update_wallet_balance copiadas de pg_get_functiondef el
-- 16-oct-2026: el cobro nuevo se apoya en ellas y una version inventada
-- escondería justo lo que importa (que lancen cuando el saldo no alcanza).
--
-- QUE SE PRUEBA
--   1. cobrar_saldo_y_puntos: cobra los dos medios; si el Cash no alcanza, NO
--      quedan descontados los puntos (todo o nada).
--   2. reembolsar_saldo_y_puntos: Cash como Cash, puntos como puntos, y quitar
--      los puntos ganados nunca deja el saldo negativo.
--   3. allocate_payment_plan_installment: guarda points_used y da Cash doble +
--      puntos sencillos; con pasarela, todo sencillo. Sin p_points_used, igual
--      que antes.
--   4. Asientos: cada uno cuadra (debe = haber) y la parte de puntos va a 603,
--      no a Bancos ni al monedero. Los dos casos del 16-oct:
--        TRG-0E05WC6UZ7P  $250 Stripe + 25,000 pts -> antes 102 = 484.63
--        TRG-IDBZH9ZXZHX  $250 Cash   + 25,000 pts -> antes 102 = 250.00
--   5. reparto_saldo_de_reserva con puntos, Cash, pasarela y un extra a la vez:
--      cada componente cuadra contra lo que pago, no solo la suma.
--
--   psql -f scripts/test-puntos-tope-50-y-pago-mixto.sql

\set ON_ERROR_STOP on
\set QUIET on

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
SET search_path = public;

DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;

CREATE TYPE public.toursred_cash_transaction_type AS ENUM
  ('credit','debit','refund','promotion','gift_card','adjustment','topup_spei','topup_codi');

CREATE TABLE users (id uuid PRIMARY KEY, first_name text, last_name text, role text);
CREATE TABLE tours (id uuid PRIMARY KEY, name text);
CREATE TABLE agencies (id uuid PRIMARY KEY, name text);
CREATE TABLE memberships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, status text, current_period_end timestamptz);
CREATE TABLE platform_settings (
  stripe_commission_pct numeric, stripe_commission_fixed numeric,
  paypal_commission_pct numeric, paypal_commission_fixed numeric,
  mercadopago_commission_pct numeric, mercadopago_commission_fixed numeric,
  conekta_commission_pct numeric, conekta_commission_fixed numeric,
  openpay_commission_pct numeric, openpay_commission_fixed numeric,
  travel_insurance_price_per_day_per_traveler numeric,
  travel_insurance_cost_per_day_per_traveler numeric
);
INSERT INTO platform_settings (travel_insurance_price_per_day_per_traveler, travel_insurance_cost_per_day_per_traveler) VALUES (79, 59);

CREATE TABLE bookings (
  id uuid PRIMARY KEY, user_id uuid, tour_id uuid, agency_id uuid, booking_code text,
  total_price numeric, deposit_amount numeric, service_charge numeric DEFAULT 0,
  user_payment numeric, toursred_cash_used numeric DEFAULT 0, points_used integer DEFAULT 0,
  points_earned integer DEFAULT 0, payment_status text, status text,
  paid_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz,
  travel_insurance_included boolean DEFAULT false, travel_insurance_cost numeric,
  membership_purchased boolean DEFAULT false, membership_cost numeric,
  payment_plan_paid numeric, payment_plan_status text
);
CREATE TABLE booking_supplements (
  id uuid PRIMARY KEY, booking_id uuid, total_paid numeric, service_charge numeric DEFAULT 0,
  supplement_commission numeric DEFAULT 0, status text, payment_method text, paid_at timestamptz
);
CREATE TABLE booking_optional_services (
  id uuid PRIMARY KEY, booking_id uuid, subtotal numeric, total_paid numeric,
  service_charge numeric DEFAULT 0, payment_method text, paid_at timestamptz,
  is_cancelled boolean DEFAULT false, description text
);
CREATE TABLE booking_payment_plans (
  id uuid PRIMARY KEY, booking_id uuid, total_amount_paid numeric DEFAULT 0,
  total_plan_amount numeric, status text, updated_at timestamptz
);
CREATE TABLE booking_payment_plan_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid, amount_due numeric,
  penalty_applied numeric DEFAULT 0, amount_paid numeric DEFAULT 0, status text,
  due_date date, paid_at timestamptz, updated_at timestamptz
);
CREATE TABLE booking_payment_plan_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid, booking_id uuid, user_id uuid,
  amount numeric, service_charge numeric DEFAULT 0, gross_service_charge numeric,
  total_charged numeric GENERATED ALWAYS AS (amount + service_charge) STORED,
  payment_provider text, provider_transaction_id text, membership_exemption_used boolean,
  points_earned integer, status text, created_at timestamptz DEFAULT now()
);
CREATE TABLE booking_payment_plan_transaction_allocations (
  transaction_id uuid, installment_id uuid, amount_allocated numeric
);

CREATE TABLE toursred_points_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE,
  balance integer NOT NULL DEFAULT 0, total_earned integer NOT NULL DEFAULT 0,
  total_used integer NOT NULL DEFAULT 0, updated_at timestamptz
);
-- Los CHECK reales (16-oct-2026): un tipo o referencia que no esten aqui revientan.
CREATE TABLE toursred_points_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_id uuid, user_id uuid,
  amount integer, balance_after integer CHECK (balance_after >= 0),
  type text CHECK (type IN ('earned','redeemed','expired','refund','adjustment','partial_cancellation','clawback')),
  description text, reference_id uuid,
  reference_type text CHECK (reference_type IN ('booking','adjustment','promotion','referral',
    'booking_partial_cancellation','supplement_payment','supplement','payment_plan',
    'optional_service_payment','insurance_payment','post_booking_extra','admin_cancellation',
    'traveler_cancellation','membership','featured_slot','expiration','tour_cancellation',
    'agency_booking_cancellation','payment_plan_auto_cancel')),
  expires_at timestamptz
);
CREATE TABLE toursred_cash_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, balance numeric, is_active boolean DEFAULT true
);
CREATE TABLE toursred_cash_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_id uuid, user_id uuid, amount numeric,
  balance_after numeric, type toursred_cash_transaction_type, description text,
  reference_id uuid, reference_type text, idempotency_key text
);

CREATE TABLE accounting_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entry_number text, entry_type text,
  entry_date date, period_year integer, period_month integer, description text,
  source_type text, source_id uuid, is_posted boolean
);
CREATE TABLE accounting_entry_lines (
  entry_id uuid, line_number integer, account_code text, description text,
  debit numeric, credit numeric, cfdi_uuid text
);
CREATE TABLE cfdi_invoices (
  booking_id uuid, booking_supplement_id uuid, booking_optional_service_id uuid,
  invoice_type text, status text, uuid_fiscal text
);
CREATE TABLE payment_transactions (
  booking_id uuid, status text, created_at timestamptz DEFAULT now(), payment_processor text,
  charge_context text, processor_fee_base numeric, processor_fee_iva numeric, processor_fee numeric
);

CREATE FUNCTION generate_entry_number(text, integer, integer) RETURNS text
LANGUAGE sql AS $$ SELECT 'I-' || gen_random_uuid()::text $$;

CREATE FUNCTION create_accounting_entry_atomic(p_entry_type text, p_description text, p_source_type text,
  p_source_id uuid, p_entry_date date, p_lines jsonb) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_l jsonb; v_n integer := 0;
BEGIN
  INSERT INTO accounting_entries (entry_number, entry_type, entry_date, description, source_type, source_id, is_posted)
  VALUES ('I-x', p_entry_type, p_entry_date, p_description, p_source_type, p_source_id, true) RETURNING id INTO v_id;
  FOR v_l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_n := v_n + 1;
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
    VALUES (v_id, v_n, v_l->>'account_code', v_l->>'description', (v_l->>'debit')::numeric, (v_l->>'credit')::numeric);
  END LOOP;
  RETURN v_id;
END $$;

CREATE FUNCTION get_or_create_points_wallet(p_user_id uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM toursred_points_wallets WHERE user_id = p_user_id;
  IF v_id IS NULL THEN
    INSERT INTO toursred_points_wallets (user_id) VALUES (p_user_id) RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

-- deduct_points VIGENTE (pg_get_functiondef, 16-oct-2026).
CREATE FUNCTION public.deduct_points(p_user_id uuid, p_amount integer, p_description text DEFAULT 'Puntos canjeados'::text, p_reference_id uuid DEFAULT NULL::uuid, p_reference_type text DEFAULT 'general'::text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
v_wallet_id uuid;
v_new_balance integer;
v_current_balance integer;
BEGIN
IF p_amount <= 0 THEN
RETURN false;
END IF;
IF auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN
RAISE EXCEPTION 'Acceso no autorizado: no puedes deducir puntos de otro usuario';
END IF;
v_wallet_id := get_or_create_points_wallet(p_user_id);
PERFORM 1 FROM public.toursred_points_wallets WHERE id = v_wallet_id FOR UPDATE;
IF p_reference_id IS NOT NULL AND EXISTS (
SELECT 1 FROM public.toursred_points_transactions
WHERE reference_id = p_reference_id
AND type = 'redeemed'
AND (reference_type = p_reference_type OR reference_type IS NULL)
) THEN
RAISE NOTICE 'Points already deducted for reference %', p_reference_id;
RETURN true;
END IF;
SELECT balance INTO v_current_balance
FROM public.toursred_points_wallets
WHERE id = v_wallet_id;
IF v_current_balance < p_amount THEN
RAISE EXCEPTION 'Puntos insuficientes. Saldo: %, Requerido: %', v_current_balance, p_amount;
END IF;
UPDATE public.toursred_points_wallets
SET balance = balance - p_amount,
total_used = total_used + p_amount,
updated_at = now()
WHERE id = v_wallet_id
RETURNING balance INTO v_new_balance;
INSERT INTO public.toursred_points_transactions (
wallet_id, user_id, amount, balance_after, type,
description, reference_id, reference_type
) VALUES (
v_wallet_id, p_user_id, -p_amount, v_new_balance,
'redeemed', p_description, p_reference_id, p_reference_type
);
RETURN true;
END;
$function$;

-- update_wallet_balance VIGENTE (pg_get_functiondef, 16-oct-2026).
CREATE FUNCTION public.update_wallet_balance(p_user_id uuid, p_amount numeric, p_type toursred_cash_transaction_type, p_description text, p_reference_id uuid DEFAULT NULL::uuid, p_reference_type text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
v_caller_id uuid;
v_caller_role text;
v_wallet_id uuid;
v_current_balance decimal;
v_new_balance decimal;
v_transaction_id uuid;
v_existing json;
BEGIN
v_caller_id := auth.uid();
SELECT role INTO v_caller_role FROM users WHERE id = v_caller_id;
IF v_caller_id IS NOT NULL AND v_caller_id <> p_user_id AND COALESCE(v_caller_role, '') NOT IN ('agency', 'admin', 'super_admin') THEN
RAISE EXCEPTION 'Unauthorized: cannot modify wallet of another user';
END IF;
SELECT id, balance INTO v_wallet_id, v_current_balance
FROM public.toursred_cash_wallets
WHERE user_id = p_user_id AND is_active = true
FOR UPDATE;
IF v_wallet_id IS NULL THEN
RAISE EXCEPTION 'Wallet not found for user %', p_user_id;
END IF;
IF p_idempotency_key IS NOT NULL THEN
SELECT json_build_object(
'success', true,
'transaction_id', t.id,
'previous_balance', t.balance_after - t.amount,
'amount', t.amount,
'new_balance', t.balance_after,
'idempotent_replay', true
) INTO v_existing
FROM public.toursred_cash_transactions t
WHERE t.wallet_id = v_wallet_id AND t.idempotency_key = p_idempotency_key
LIMIT 1;
IF v_existing IS NOT NULL THEN
RETURN v_existing;
END IF;
END IF;
v_new_balance := v_current_balance + p_amount;
IF v_new_balance < 0 THEN
RAISE EXCEPTION 'Insufficient balance. Current: %, Attempting: %', v_current_balance, p_amount;
END IF;
UPDATE public.toursred_cash_wallets
SET balance = v_new_balance
WHERE id = v_wallet_id;
INSERT INTO public.toursred_cash_transactions (
wallet_id, user_id, amount, balance_after, type, description,
reference_id, reference_type, idempotency_key
) VALUES (
v_wallet_id, p_user_id, p_amount, v_new_balance, p_type, p_description,
p_reference_id, p_reference_type, p_idempotency_key
) RETURNING id INTO v_transaction_id;
RETURN json_build_object(
'success', true,
'transaction_id', v_transaction_id,
'previous_balance', v_current_balance,
'amount', p_amount,
'new_balance', v_new_balance
);
END;
$function$;

-- La version VIGENTE de allocate_payment_plan_installment (sin p_points_used),
-- para que el DROP de la migracion tenga algo que borrar, como en produccion.
CREATE FUNCTION public.allocate_payment_plan_installment(p_plan_id uuid, p_amount numeric, p_provider text, p_service_charge numeric DEFAULT 0, p_gross_service_charge numeric DEFAULT 0, p_provider_transaction_id text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid, p_membership_exemption_used boolean DEFAULT false, p_is_wallet_payment boolean DEFAULT false)
 RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;

-- ---------------------------------------------------------------------------
-- LA MIGRACION REAL
-- ---------------------------------------------------------------------------
\ir ../supabase/migrations/20261016042518_puntos_tope_50_y_pago_mixto_con_cash.sql

-- ---------------------------------------------------------------------------
-- DATOS
-- ---------------------------------------------------------------------------
INSERT INTO users (id) VALUES ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2');
INSERT INTO memberships (user_id, status, current_period_end) VALUES ('00000000-0000-0000-0000-0000000000a1', 'active', now() + interval '30 days');
INSERT INTO toursred_cash_wallets (user_id, balance) VALUES ('00000000-0000-0000-0000-0000000000a1', 1000), ('00000000-0000-0000-0000-0000000000a2', 0);
INSERT INTO toursred_points_wallets (user_id, balance) VALUES ('00000000-0000-0000-0000-0000000000a1', 60000), ('00000000-0000-0000-0000-0000000000a2', 100);

CREATE FUNCTION pg_temp.cash(u text) RETURNS numeric LANGUAGE sql AS
  $$ SELECT balance FROM toursred_cash_wallets WHERE user_id = u::uuid $$;
CREATE FUNCTION pg_temp.pts(u text) RETURNS integer LANGUAGE sql AS
  $$ SELECT balance FROM toursred_points_wallets WHERE user_id = u::uuid $$;
-- Lineas de la poliza de una fuente, como 'cuenta:debe:haber' ordenadas.
CREATE FUNCTION pg_temp.poliza(p_source_type text, p_source_id uuid) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(l.account_code || ':' || round(l.debit, 2) || ':' || round(l.credit, 2), ' ' ORDER BY l.account_code, l.debit DESC)
    FROM accounting_entries e JOIN accounting_entry_lines l ON l.entry_id = e.id
   WHERE e.source_type = p_source_type AND e.source_id = p_source_id
     AND (l.debit <> 0 OR l.credit <> 0)
$$;

-- ---------------------------------------------------------------------------
-- 1. cobrar_saldo_y_puntos
-- ---------------------------------------------------------------------------
DO $$
DECLARE u uuid := '00000000-0000-0000-0000-0000000000a1'; v_ok boolean := false;
BEGIN
  PERFORM cobrar_saldo_y_puntos(u, 300, 20000, '00000000-0000-0000-0000-00000000c001', 'supplement_payment', 'Suplemento', 'c001_charge');
  IF pg_temp.cash(u::text) <> 700 OR pg_temp.pts(u::text) <> 40000 THEN
    RAISE EXCEPTION '1a: esperaba Cash 700 y 40000 pts, hay % y %', pg_temp.cash(u::text), pg_temp.pts(u::text);
  END IF;

  -- Repetir la misma operacion no cobra dos veces.
  PERFORM cobrar_saldo_y_puntos(u, 300, 20000, '00000000-0000-0000-0000-00000000c001', 'supplement_payment', 'Suplemento', 'c001_charge');
  IF pg_temp.cash(u::text) <> 700 OR pg_temp.pts(u::text) <> 40000 THEN
    RAISE EXCEPTION '1b: el reintento cobro otra vez: Cash % y % pts', pg_temp.cash(u::text), pg_temp.pts(u::text);
  END IF;

  -- El Cash no alcanza: los puntos NO deben quedar descontados.
  BEGIN
    PERFORM cobrar_saldo_y_puntos(u, 5000, 10000, '00000000-0000-0000-0000-00000000c002', 'supplement_payment', 'Suplemento', 'c002_charge');
  EXCEPTION WHEN OTHERS THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '1c: cobrar mas Cash del que hay no lanzo'; END IF;
  IF pg_temp.pts(u::text) <> 40000 OR pg_temp.cash(u::text) <> 700 THEN
    RAISE EXCEPTION '1c: quedo cobrado a medias: Cash % y % pts', pg_temp.cash(u::text), pg_temp.pts(u::text);
  END IF;

  v_ok := false;
  BEGIN
    PERFORM cobrar_saldo_y_puntos(u, -1, 0, NULL, 'supplement_payment', 'x', NULL);
  EXCEPTION WHEN OTHERS THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '1d: un monto negativo no lanzo'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. reembolsar_saldo_y_puntos
-- ---------------------------------------------------------------------------
DO $$
DECLARE u uuid := '00000000-0000-0000-0000-0000000000a1'; u2 uuid := '00000000-0000-0000-0000-0000000000a2'; r jsonb;
BEGIN
  r := reembolsar_saldo_y_puntos(u, 100, 5000, 300, '00000000-0000-0000-0000-00000000c001', 'supplement', 'supplement_cancellation', 'Suplemento', 'c001_refund');
  IF pg_temp.cash(u::text) <> 800 OR pg_temp.pts(u::text) <> 44700 THEN
    RAISE EXCEPTION '2a: esperaba Cash 800 y 44700 pts, hay % y %', pg_temp.cash(u::text), pg_temp.pts(u::text);
  END IF;
  IF (r->>'points_clawed_back')::int <> 300 OR (r->>'points_returned')::int <> 5000 THEN
    RAISE EXCEPTION '2a: resultado inesperado %', r;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM toursred_points_transactions WHERE reference_id = '00000000-0000-0000-0000-00000000c001' AND type = 'refund' AND amount = 5000)
     OR NOT EXISTS (SELECT 1 FROM toursred_points_transactions WHERE reference_id = '00000000-0000-0000-0000-00000000c001' AND type = 'redeemed' AND amount = -300) THEN
    RAISE EXCEPTION '2a: faltan los movimientos de puntos (refund +5000 y redeemed -300)';
  END IF;

  -- Quitar mas puntos de los que hay: se quita lo que haya, sin saldo negativo.
  r := reembolsar_saldo_y_puntos(u2, 0, 0, 500, '00000000-0000-0000-0000-00000000c003', 'optional_service_payment', 'optional_service_cancellation', 'Extra', NULL);
  IF pg_temp.pts(u2::text) <> 0 OR (r->>'points_clawed_back')::int <> 100 THEN
    RAISE EXCEPTION '2b: esperaba quitar 100 y quedar en 0, quedo % (%)', pg_temp.pts(u2::text), r;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. allocate_payment_plan_installment
-- ---------------------------------------------------------------------------
INSERT INTO bookings (id, user_id, booking_code, deposit_amount, payment_status, status)
VALUES ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a1', 'TRG-PLAN', 0, 'succeeded', 'confirmed');
INSERT INTO booking_payment_plans (id, booking_id, total_plan_amount, status)
VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b3', 2000, 'active');
INSERT INTO booking_payment_plan_installments (plan_id, amount_due, status, due_date) VALUES
  ('00000000-0000-0000-0000-0000000000f1', 1000, 'pending', '2026-11-01'),
  ('00000000-0000-0000-0000-0000000000f1', 1000, 'pending', '2026-12-01');

DO $$
DECLARE p uuid := '00000000-0000-0000-0000-0000000000f1'; u uuid := '00000000-0000-0000-0000-0000000000a1'; r jsonb;
BEGIN
  -- $1000: 50,000 pts ($500) + $500 Cash, sin pasarela -> 500*2 + 500 = 1500.
  r := allocate_payment_plan_installment(p_plan_id => p, p_amount => 1000, p_provider => 'toursred_cash',
         p_user_id => u, p_is_wallet_payment => true, p_points_used => 50000);
  IF (r->>'points_earned')::int <> 1500 THEN
    RAISE EXCEPTION '3a: Cash + puntos deberia dar 1500 puntos, dio %', r->>'points_earned';
  END IF;
  IF (SELECT points_used FROM booking_payment_plan_transactions WHERE id = (r->>'transaction_id')::uuid) <> 50000 THEN
    RAISE EXCEPTION '3a: no guardo points_used';
  END IF;
  IF (SELECT status FROM booking_payment_plan_installments WHERE plan_id = p ORDER BY due_date LIMIT 1) <> 'paid' THEN
    RAISE EXCEPTION '3a: el abono completo (con puntos) no liquido la primera parcialidad';
  END IF;

  -- Sin p_points_used (los llamadores de hoy): igual que antes.
  r := allocate_payment_plan_installment(p_plan_id => p, p_amount => 500, p_provider => 'stripe',
         p_service_charge => 25, p_gross_service_charge => 25, p_provider_transaction_id => 'pi_1',
         p_user_id => u, p_is_wallet_payment => false);
  IF (r->>'points_earned')::int <> 525 THEN
    RAISE EXCEPTION '3b: pasarela deberia dar 525 puntos (500 + 25), dio %', r->>'points_earned';
  END IF;

  r := allocate_payment_plan_installment(p_plan_id => p, p_amount => 500, p_provider => 'stripe',
         p_provider_transaction_id => 'pi_1', p_user_id => u);
  IF NOT (r->>'idempotent_skip')::boolean THEN
    RAISE EXCEPTION '3c: repetir el mismo cobro de pasarela no fue idempotente';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Asientos
-- ---------------------------------------------------------------------------
-- TRG-0E05WC6UZ7P: $500 de anticipo = 25,000 pts + $250 Stripe (comision 15.37).
INSERT INTO bookings (id, user_id, booking_code, total_price, deposit_amount, service_charge, user_payment, points_used, toursred_cash_used, payment_status, status, paid_at)
VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'TRG-0E05WC6UZ7P', 1000, 500, 0, 250, 25000, 0, 'succeeded', 'confirmed', now());
INSERT INTO payment_transactions (booking_id, status, payment_processor, charge_context, processor_fee_base, processor_fee_iva, processor_fee)
VALUES ('00000000-0000-0000-0000-0000000000b1', 'succeeded', 'stripe', 'booking', 13.25, 2.12, 15.37);

-- TRG-IDBZH9ZXZHX: $500 = $250 Cash + 25,000 pts, sin pasarela.
INSERT INTO bookings (id, user_id, booking_code, total_price, deposit_amount, service_charge, user_payment, points_used, toursred_cash_used, payment_status, status, paid_at)
VALUES ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'TRG-IDBZH9ZXZHX', 1000, 500, 0, 0, 25000, 250, 'succeeded', 'confirmed', now());

-- Suplemento $1000 = 50,000 pts + $500 Cash; y uno viejo pagado 100% con puntos.
INSERT INTO booking_supplements (id, booking_id, total_paid, service_charge, status, payment_method, paid_at, points_used) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 1000, 0, 'paid', 'toursred_cash', now(), 50000),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b1', 300, 0, 'paid', 'points', now(), 0);

-- Extra comprado despues: $400 = 20,000 pts + $200 Cash.
INSERT INTO booking_optional_services (id, booking_id, subtotal, total_paid, service_charge, payment_method, paid_at, points_used, description)
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 400, 400, 0, 'toursred_cash', now(), 20000, 'Kayak');

-- Seguro comprado despues: $790 = 39,500 pts + $395 Cash.
INSERT INTO bookings (id, user_id, booking_code, deposit_amount, payment_status, status, paid_at, travel_insurance_included, travel_insurance_cost, travel_insurance_points_used, travel_insurance_cash_used)
VALUES ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000a1', 'TRG-SEGURO', 0, 'succeeded', 'confirmed', now(), true, 790, 39500, 395);

DO $$
DECLARE v text; r record; n integer := 0;
BEGIN
  PERFORM create_accounting_entry_for_booking('00000000-0000-0000-0000-0000000000b1');
  v := pg_temp.poliza('booking', '00000000-0000-0000-0000-0000000000b1');
  IF v IS DISTINCT FROM '102:234.63:0.00 108:2.12:0.00 208:0.00:500.00 603:250.00:0.00 604:13.25:0.00' THEN
    RAISE EXCEPTION '4a TRG-0E05: %', v;
  END IF;

  PERFORM create_accounting_entry_for_booking('00000000-0000-0000-0000-0000000000b2');
  v := pg_temp.poliza('booking', '00000000-0000-0000-0000-0000000000b2');
  IF v IS DISTINCT FROM '208:0.00:500.00 218-11:250.00:0.00 603:250.00:0.00' THEN
    RAISE EXCEPTION '4b TRG-IDBZH: %', v;
  END IF;

  PERFORM create_accounting_entry_for_supplement('00000000-0000-0000-0000-0000000000d1');
  v := pg_temp.poliza('supplement', '00000000-0000-0000-0000-0000000000d1');
  IF v IS DISTINCT FROM '208:0.00:1000.00 218-11:500.00:0.00 603:500.00:0.00' THEN
    RAISE EXCEPTION '4c suplemento Cash + puntos: %', v;
  END IF;

  PERFORM create_accounting_entry_for_supplement('00000000-0000-0000-0000-0000000000d2');
  v := pg_temp.poliza('supplement', '00000000-0000-0000-0000-0000000000d2');
  IF v IS DISTINCT FROM '208:0.00:300.00 603:300.00:0.00' THEN
    RAISE EXCEPTION '4d suplemento viejo pagado solo con puntos (antes iba a Bancos): %', v;
  END IF;

  PERFORM create_accounting_entry_for_optional_service('00000000-0000-0000-0000-0000000000e1');
  v := pg_temp.poliza('optional_service', '00000000-0000-0000-0000-0000000000e1');
  IF v IS DISTINCT FROM '208:0.00:400.00 218-11:200.00:0.00 603:200.00:0.00' THEN
    RAISE EXCEPTION '4e extra Cash + puntos: %', v;
  END IF;

  FOR r IN SELECT id, payment_provider FROM booking_payment_plan_transactions LOOP
    PERFORM create_accounting_entry_for_payment_plan_installment(r.id);
    v := pg_temp.poliza('payment_plan_installment', r.id);
    n := n + 1;
    IF r.payment_provider = 'toursred_cash' AND v IS DISTINCT FROM '208:0.00:1000.00 218-11:500.00:0.00 603:500.00:0.00' THEN
      RAISE EXCEPTION '4f abono Cash + puntos: %', v;
    ELSIF r.payment_provider = 'stripe' AND v IS DISTINCT FROM '102:525.00:0.00 208:0.00:500.00 402:0.00:25.00' THEN
      RAISE EXCEPTION '4g abono con pasarela (no debe cambiar): %', v;
    END IF;
  END LOOP;
  IF n <> 2 THEN RAISE EXCEPTION '4f/4g: esperaba 2 abonos, hubo %', n; END IF;

  PERFORM create_accounting_entry_for_insurance_purchase('00000000-0000-0000-0000-0000000000b4');
  v := pg_temp.poliza('insurance', '00000000-0000-0000-0000-0000000000b4');
  IF v IS DISTINCT FROM '201.01:0.00:590.00 218-11:395.00:0.00 401.02:0.00:200.00 603:395.00:0.00' THEN
    RAISE EXCEPTION '4h seguro Cash + puntos: %', v;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Reserva con puntos, Cash, pasarela y un extra a la vez
-- ---------------------------------------------------------------------------
-- Anticipo $1000 + cargo por servicio $50 + extra de reserva $200 = $1250.
-- Puntos: 60,000 ($600, el 50% de 1200: el cargo por servicio no se paga con
-- puntos). Cash $400. Pasarela $250.
--
-- Con la funcion vieja el Cash se repartia sobre 1250 (incluyendo lo pagado
-- con puntos) y cada asiento salia descuadrado contra su propio cobro, aunque
-- la suma de los dos cuadrara (patron 1). Se afirma cada asiento por separado.
INSERT INTO bookings (id, user_id, booking_code, total_price, deposit_amount, service_charge, user_payment, points_used, toursred_cash_used, payment_status, status, paid_at)
VALUES ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000a1', 'TRG-MIXTA', 2000, 1000, 50, 250, 60000, 400, 'succeeded', 'confirmed', now());
INSERT INTO payment_transactions (booking_id, status, payment_processor, charge_context, processor_fee_base, processor_fee_iva, processor_fee)
VALUES ('00000000-0000-0000-0000-0000000000b5', 'succeeded', 'stripe', 'booking', 0, 0, 0);
INSERT INTO booking_optional_services (id, booking_id, subtotal, total_paid, service_charge, payment_method, paid_at, description)
VALUES ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000b5', 200, 200, 0, NULL, now(), 'Comida');

DO $$
DECLARE v text;
BEGIN
  -- Anticipo + cargo: puntos 1000*600/1200 = 500; Cash (1050-500)*400/650 = 338.46; banco 211.54.
  PERFORM create_accounting_entry_for_booking('00000000-0000-0000-0000-0000000000b5');
  v := pg_temp.poliza('booking', '00000000-0000-0000-0000-0000000000b5');
  IF v IS DISTINCT FROM '102:211.54:0.00 208:0.00:1000.00 218-11:338.46:0.00 402:0.00:50.00 603:500.00:0.00' THEN
    RAISE EXCEPTION '5a anticipo de reserva mixta: %', v;
  END IF;

  -- Extra: puntos 200*600/1200 = 100; Cash 100*400/650 = 61.54; banco 38.46.
  PERFORM create_accounting_entry_for_optional_service('00000000-0000-0000-0000-0000000000e2');
  v := pg_temp.poliza('optional_service', '00000000-0000-0000-0000-0000000000e2');
  IF v IS DISTINCT FROM '102:38.46:0.00 208:0.00:200.00 218-11:61.54:0.00 603:100.00:0.00' THEN
    RAISE EXCEPTION '5b extra de reserva mixta: %', v;
  END IF;

  -- Y entre los dos: $600 de puntos, $400 de Cash y $250 de pasarela, al centavo.
  IF (SELECT sum(l.debit) FILTER (WHERE l.account_code = '603') FROM accounting_entries e JOIN accounting_entry_lines l ON l.entry_id = e.id
       WHERE e.source_id IN ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000e2')) IS DISTINCT FROM 600
  OR (SELECT sum(l.debit) FILTER (WHERE l.account_code = '218-11') FROM accounting_entries e JOIN accounting_entry_lines l ON l.entry_id = e.id
       WHERE e.source_id IN ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000e2')) IS DISTINCT FROM 400
  OR (SELECT sum(l.debit) FILTER (WHERE l.account_code = '102') FROM accounting_entries e JOIN accounting_entry_lines l ON l.entry_id = e.id
       WHERE e.source_id IN ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000e2')) IS DISTINCT FROM 250 THEN
    RAISE EXCEPTION '5c: la reserva mixta no suma 600 puntos / 400 Cash / 250 pasarela';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Toda poliza cuadra
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record; n integer;
BEGIN
  SELECT count(*) INTO n FROM accounting_entries;
  IF n <> 10 THEN RAISE EXCEPTION 'esperaba 10 polizas, hay %', n; END IF;
  FOR r IN
    SELECT e.source_type, e.source_id, sum(l.debit) d, sum(l.credit) c
      FROM accounting_entries e JOIN accounting_entry_lines l ON l.entry_id = e.id
     GROUP BY 1, 2
  LOOP
    IF r.d IS DISTINCT FROM r.c THEN
      RAISE EXCEPTION 'poliza descuadrada (% %): debe % haber %', r.source_type, r.source_id, r.d, r.c;
    END IF;
  END LOOP;
END $$;

\echo 'puntos tope 50 y pago mixto: cobro, reembolso, abonos y 10 polizas OK'
