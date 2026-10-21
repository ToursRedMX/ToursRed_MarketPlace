-- ============================================================================
-- Un anticipo pagado con DOS métodos: el asiento suma la comisión de los dos cobros
-- ============================================================================
--
-- Prueba la migración 20261020051530 contra un Postgres de verdad, con el esquema
-- mínimo que necesita (mismo patrón que test-comisiones-al-libro.sql).
--
-- El defecto: create_accounting_entry_for_booking tomaba la comisión solo del ÚLTIMO
-- cobro, así que con Stripe $350 + PayPal $200 la comisión del primero se perdía: la
-- póliza cuadraba (debe = haber) pero Bancos salía de más y 604/108 de menos.
--
--   1. Dos cobros: Bancos = 550 - (15 + 10), 604 = 21.55, 108 = 3.45, y cuadra.
--   2. Un solo cobro (el caso de siempre) queda idéntico: Bancos = 550 - 25.
--   3. Un cobro sin comisión guardada se estima con platform_settings (PayPal 3.95% + $4).
--   4. comisiones_no_asentadas NO reporta nada para esos asientos: suma por asiento y no
--      compara cada cobro contra todo lo asentado.
--
--   psql -f scripts/test-asiento-varios-cobros.sql
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION public.is_admin_user() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;

CREATE TABLE public.accounting_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number text NOT NULL, entry_type text NOT NULL, entry_date date NOT NULL,
  period_year integer, period_month integer, description text,
  source_type text, source_id uuid, is_posted boolean DEFAULT false);
CREATE TABLE public.accounting_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid REFERENCES public.accounting_entries(id),
  line_number integer, account_code text, description text,
  debit numeric DEFAULT 0, credit numeric DEFAULT 0, cfdi_uuid text);
CREATE TABLE public.payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid, status text, amount numeric, payment_processor text,
  charge_context text, charge_reference_id uuid,
  processor_fee numeric DEFAULT 0, processor_fee_base numeric, processor_fee_iva numeric,
  created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY, tour_id uuid, user_id uuid, payment_status text,
  deposit_amount numeric, service_charge numeric, total_price numeric,
  paid_at timestamptz, created_at timestamptz DEFAULT now(),
  booking_code text, payment_provider text);
CREATE TABLE public.tours (id uuid PRIMARY KEY, name text);
CREATE TABLE public.users (id uuid PRIMARY KEY, first_name text, last_name text);
CREATE TABLE public.cfdi_invoices (booking_id uuid, status text, uuid_fiscal text);
CREATE TABLE public.platform_settings (
  stripe_commission_pct numeric, stripe_commission_fixed numeric,
  paypal_commission_pct numeric, paypal_commission_fixed numeric,
  mercadopago_commission_pct numeric, mercadopago_commission_fixed numeric,
  conekta_commission_pct numeric, conekta_commission_fixed numeric,
  openpay_commission_pct numeric, openpay_commission_fixed numeric);
INSERT INTO public.platform_settings VALUES (4.176, 3.48, 3.95, 4.0, 3.49, 4.0, 3.29, 2.5, 2.9, 0);

CREATE OR REPLACE FUNCTION public.generate_entry_number(p_type text, p_year int, p_month int)
RETURNS text LANGUAGE sql AS $$
  SELECT 'I-' || p_year || '-' || lpad(p_month::text,2,'0') || '-'
      || lpad(((SELECT count(*) FROM public.accounting_entries) + 1)::text, 4, '0') $$;
-- Sin puntos ni Cash: todo lo cobra la pasarela.
CREATE OR REPLACE FUNCTION public.reparto_saldo_de_reserva(p_booking uuid, p_total numeric, p_deposito numeric)
RETURNS TABLE(cash numeric, puntos numeric) LANGUAGE sql AS $$ SELECT 0::numeric, 0::numeric $$;

\ir ../supabase/migrations/20261020051530_asiento_suma_comision_de_todos_los_cobros_del_anticipo.sql

INSERT INTO public.tours VALUES ('00000000-0000-0000-0000-0000000000a1', 'Tour de prueba');
INSERT INTO public.bookings (id, tour_id, payment_status, deposit_amount, service_charge, booking_code, payment_provider, paid_at) VALUES
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000a1', 'succeeded', 500, 50, 'TRG-DOS', 'paypal', now()),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000a1', 'succeeded', 500, 50, 'TRG-UNO', 'stripe', now()),
  ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-0000000000a1', 'succeeded', 500, 50, 'TRG-EST', 'paypal', now());

-- b: Stripe 350 (fee 15) + PayPal 200 (fee 10)
INSERT INTO public.payment_transactions (booking_id, status, amount, payment_processor, charge_context, processor_fee) VALUES
  ('00000000-0000-0000-0000-00000000000b', 'succeeded', 350, 'stripe', 'booking_deposit', 15),
  ('00000000-0000-0000-0000-00000000000b', 'succeeded', 200, 'paypal', 'booking_deposit', 10);
-- c: un solo cobro de 550 (fee 25)
INSERT INTO public.payment_transactions (booking_id, status, amount, payment_processor, charge_context, processor_fee) VALUES
  ('00000000-0000-0000-0000-00000000000c', 'succeeded', 550, 'stripe', 'booking_deposit', 25);
-- d: Stripe 350 con fee 15 + PayPal 200 SIN comision guardada (se estima: 200*3.95% + 4 = 11.90)
INSERT INTO public.payment_transactions (booking_id, status, amount, payment_processor, charge_context, processor_fee) VALUES
  ('00000000-0000-0000-0000-00000000000d', 'succeeded', 350, 'stripe', 'booking_deposit', 15),
  ('00000000-0000-0000-0000-00000000000d', 'succeeded', 200, 'paypal', 'booking_deposit', 0);

CREATE FUNCTION public.monto_linea(p_booking uuid, p_code text) RETURNS numeric LANGUAGE sql AS $$
  SELECT COALESCE(sum(l.debit + l.credit), 0) FROM public.accounting_entry_lines l
  JOIN public.accounting_entries e ON e.id = l.entry_id
  WHERE e.source_type = 'booking' AND e.source_id = p_booking AND l.account_code = p_code $$;
CREATE FUNCTION public.igual(p_que text, p_obtenido numeric, p_esperado numeric) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_obtenido IS NULL OR p_obtenido <> p_esperado THEN
    RAISE EXCEPTION 'FALLO %: obtenido %, esperado %', p_que, p_obtenido, p_esperado;
  END IF;
  RAISE NOTICE 'ok - %', p_que;
END $$;

DO $$
DECLARE
  v_b uuid := '00000000-0000-0000-0000-00000000000b';
  v_c uuid := '00000000-0000-0000-0000-00000000000c';
  v_d uuid := '00000000-0000-0000-0000-00000000000d';
  v_deb numeric; v_hab numeric; v_desc text;
BEGIN
  PERFORM public.create_accounting_entry_for_booking(v_b);
  PERFORM public.create_accounting_entry_for_booking(v_c);
  PERFORM public.create_accounting_entry_for_booking(v_d);

  -- 1. Dos cobros: se suman las comisiones de Stripe (15) y PayPal (10).
  PERFORM public.igual('dos cobros: Bancos 102 = 550 - 25', public.monto_linea(v_b, '102'), 525.00);
  PERFORM public.igual('dos cobros: 604 = 12.93 + 8.62', public.monto_linea(v_b, '604'), 21.55);
  PERFORM public.igual('dos cobros: 108 = 2.07 + 1.38', public.monto_linea(v_b, '108'), 3.45);
  SELECT sum(l.debit), sum(l.credit) INTO v_deb, v_hab FROM public.accounting_entry_lines l
    JOIN public.accounting_entries e ON e.id = l.entry_id WHERE e.source_id = v_b;
  PERFORM public.igual('dos cobros: la poliza cuadra', v_deb - v_hab, 0);
  SELECT l.description INTO v_desc FROM public.accounting_entry_lines l JOIN public.accounting_entries e ON e.id = l.entry_id
    WHERE e.source_id = v_b AND l.account_code = '604';
  IF v_desc NOT LIKE '%paypal + stripe%' THEN RAISE EXCEPTION 'FALLO: la leyenda de 604 deberia nombrar ambos procesadores y dice %', v_desc; END IF;

  -- 2. Un solo cobro: identico a antes.
  PERFORM public.igual('un cobro: Bancos 102 = 550 - 25', public.monto_linea(v_c, '102'), 525.00);
  PERFORM public.igual('un cobro: 604', public.monto_linea(v_c, '604'), 21.55);
  PERFORM public.igual('un cobro: 108', public.monto_linea(v_c, '108'), 3.45);

  -- 3. Cobro sin comision guardada: se estima (PayPal 200 * 3.95% + 4 = 11.90) y se suma a los 15 de Stripe.
  PERFORM public.igual('estimado: Bancos 102 = 550 - 26.90', public.monto_linea(v_d, '102'), 523.10);
  PERFORM public.igual('estimado: 604 = 12.93 + 10.26', public.monto_linea(v_d, '604'), 23.19);
  PERFORM public.igual('estimado: 108 = 2.07 + 1.64', public.monto_linea(v_d, '108'), 3.71);
END $$;

-- 4. comisiones_no_asentadas: b y c ya tienen toda su comision asentada y no se reportan. d tiene la de
--    PayPal solo ESTIMADA (el cobro aun dice processor_fee = 0): el libro trae mas que el cobro conocido y
--    eso es un delta negativo, que la funcion reporta y NO corrige sola (lo mira una persona).
DO $$
DECLARE v_n integer; v_otros integer; v_neg integer;
BEGIN
  SELECT count(*) INTO v_otros FROM public.comisiones_no_asentadas() c
    WHERE c.entry_id NOT IN (SELECT id FROM public.accounting_entries WHERE source_id = '00000000-0000-0000-0000-00000000000d');
  PERFORM public.igual('comisiones_no_asentadas no reporta los asientos con dos cobros ya completos', v_otros, 0);
  SELECT count(*) INTO v_neg FROM public.comisiones_no_asentadas() c WHERE c.d_base < 0;
  PERFORM public.igual('el asiento con comision solo estimada se reporta como delta negativo', v_neg, 1);
END $$;

ROLLBACK;
