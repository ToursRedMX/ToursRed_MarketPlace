-- Prueba de `20260910070000_quitar_calculate_payment_breakdown_ambiguo.sql`.
--
-- QUE SE PRUEBA
--
--   1. ANTES: con las dos sobrecargas presentes, una llamada de 3 argumentos
--      REVIENTA con "is not unique". La prueba reproduce el fallo antes de
--      arreglarlo, y lo reproduce de verdad -- no se afirma, se provoca y se
--      captura el SQLSTATE 42725 (ambiguous_function).
--   2. La migracion deja EXACTAMENTE una funcion, y es la de 5 parametros.
--   3. DESPUES: la llamada de 3 argumentos funciona y usa las tasas de
--      `platform_settings`, no el 10%/3% clavado de la version vieja.
--   4. Si le pasas las tasas explicitas, manda lo explicito.
--   5. La migracion es reaplicable: correrla dos veces no falla.
--   6. Si NO existe la de 5 parametros, la migracion aborta en vez de dejar a
--      la plataforma sin ninguna.
--
-- Las dos definiciones se copian aqui de las migraciones originales
-- (`20250628161215` y `20260529170840`) porque el objetivo es reproducir el
-- estado de produccion en un Postgres pelado, sin correr 400 migraciones.
--
--   psql -f scripts/test-calculate-payment-breakdown.sql

\set ON_ERROR_STOP on
\set QUIET on

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
SET search_path = public;

-- `platform_settings` con las tasas REALES del 10-sep-2026: 15% y 5%. Se eligen
-- distintas del 10%/3% de la funcion vieja a proposito: si la vieja siguiera
-- ganando, los numeros de abajo lo delatan.
CREATE TABLE public.platform_settings (
  agency_commission_percentage numeric,
  service_charge_percentage    numeric
);
INSERT INTO public.platform_settings VALUES (15, 5);

-- ---------------------------------------------------------------------------
-- Caso 6 primero: sin la de 5 parametros, la migracion tiene que abortar.
-- ---------------------------------------------------------------------------
-- Se crea SOLO la vieja y se corre la migracion DE VERDAD (`\ir`), no una
-- copia de su guardia pegada aqui. Una copia probaria que la copia esta bien.

CREATE FUNCTION public.calculate_payment_breakdown(
  p_price numeric, p_deposit_percentage integer, p_travelers_count integer DEFAULT 1
) RETURNS TABLE(
  total_price numeric, deposit_amount numeric, agency_commission numeric,
  service_charge numeric, user_payment numeric, platform_revenue numeric,
  agency_receives numeric, balance_due numeric
) LANGUAGE plpgsql AS $$
BEGIN
  total_price       := p_price * p_travelers_count;
  deposit_amount    := total_price * (p_deposit_percentage / 100.0);
  agency_commission := total_price * 0.10;  -- clavado
  service_charge    := total_price * 0.03;  -- clavado
  user_payment      := deposit_amount + service_charge;
  platform_revenue  := agency_commission + service_charge;
  agency_receives   := deposit_amount - agency_commission;
  balance_due       := total_price - deposit_amount;
  RETURN NEXT;
END; $$;

\echo '=== Caso 6: sin la de 5 parametros, la migracion aborta ==='

-- La migracion tiene que reventar aqui. Se apaga ON_ERROR_STOP solo para esa
-- linea y se vuelve a encender enseguida.
--
-- Que la migracion sea UNA sola sentencia (un `DO` con el COMMENT por EXECUTE
-- dentro) es lo que hace que esto se pueda comprobar: LAST_ERROR_MESSAGE queda
-- con el mensaje de la guardia y no con el de una segunda sentencia que corrio
-- despues del aborto.
\set ON_ERROR_STOP off
\ir ../supabase/migrations/20260910070000_quitar_calculate_payment_breakdown_ambiguo.sql
\set ON_ERROR_STOP on

-- psql NO interpola variables dentro de `$$ ... $$`, asi que la comprobacion se
-- arma fuera del bloque y solo se entra a el para reventar con un mensaje util.
SELECT
  (position('Aplica antes 20260529170840' in :'LAST_ERROR_MESSAGE') > 0)                    AS razon_ok,
  (to_regprocedure('public.calculate_payment_breakdown(numeric, integer, integer)') IS NOT NULL) AS vieja_sigue
\gset caso6_

\if :caso6_razon_ok
\else
DO $$ BEGIN RAISE EXCEPTION 'FALLO caso 6: la migracion no aborto, o aborto por otra razon'; END $$;
\endif

\if :caso6_vieja_sigue
\else
DO $$ BEGIN RAISE EXCEPTION 'FALLO caso 6: aborto pero se llevo por delante la unica funcion que habia'; END $$;
\endif

\echo '  aborta, avisa que falta 20260529170840, y no borra nada. OK'

-- ---------------------------------------------------------------------------
-- Ahora si, el estado real de produccion: LAS DOS.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.calculate_payment_breakdown(
  p_price numeric, p_deposit_percentage integer, p_travelers_count integer DEFAULT 1,
  p_agency_commission_rate numeric DEFAULT NULL, p_service_charge_rate numeric DEFAULT NULL
) RETURNS TABLE(
  total_price numeric, deposit_amount numeric, agency_commission numeric,
  service_charge numeric, user_payment numeric, platform_revenue numeric,
  agency_receives numeric, balance_due numeric
) LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_commission_rate numeric; v_service_rate numeric;
  v_platform_commission numeric; v_platform_service_charge numeric;
BEGIN
  IF p_agency_commission_rate IS NULL OR p_service_charge_rate IS NULL THEN
    SELECT ps.agency_commission_percentage / 100.0, ps.service_charge_percentage / 100.0
      INTO v_platform_commission, v_platform_service_charge
      FROM public.platform_settings ps LIMIT 1;
  END IF;
  v_commission_rate := COALESCE(p_agency_commission_rate, v_platform_commission, 0.15);
  v_service_rate    := COALESCE(p_service_charge_rate,    v_platform_service_charge, 0.05);
  total_price       := p_price * p_travelers_count;
  deposit_amount    := total_price * (p_deposit_percentage / 100.0);
  agency_commission := total_price * v_commission_rate;
  service_charge    := total_price * v_service_rate;
  user_payment      := deposit_amount + service_charge;
  platform_revenue  := agency_commission + service_charge;
  agency_receives   := deposit_amount - agency_commission;
  balance_due       := total_price - deposit_amount;
  RETURN NEXT;
END; $$;

\echo '=== Caso 1: ANTES, la llamada de 3 argumentos revienta ==='
DO $$
DECLARE v_estado text; v_x numeric;
BEGIN
  BEGIN
    SELECT agency_commission INTO v_x FROM public.calculate_payment_breakdown(1000, 30, 1);
    RAISE EXCEPTION 'FALLO caso 1: la llamada de 3 argumentos NO fue ambigua; devolvio %', v_x;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE;
    -- 42725 = ambiguous_function
    IF v_estado <> '42725' THEN
      RAISE EXCEPTION 'FALLO caso 1: se esperaba 42725 (ambiguous_function) y llego %', v_estado;
    END IF;
  END;
  RAISE NOTICE '  con las dos sobrecargas, 3 argumentos = ERROR 42725. OK';
END $$;

-- ---------------------------------------------------------------------------
-- La migracion.
-- ---------------------------------------------------------------------------
\ir ../supabase/migrations/20260910070000_quitar_calculate_payment_breakdown_ambiguo.sql

\echo '=== Caso 2: queda exactamente una, y es la de 5 parametros ==='
DO $$
DECLARE v_n int; v_firma text;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'calculate_payment_breakdown';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALLO caso 2: quedaron % funciones', v_n; END IF;

  SELECT p.oid::regprocedure::text INTO v_firma FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'calculate_payment_breakdown';
  IF position('numeric,numeric' in replace(v_firma, ' ', '')) = 0 THEN
    RAISE EXCEPTION 'FALLO caso 2: sobrevivio la equivocada: %', v_firma;
  END IF;
  RAISE NOTICE '  queda solo %. OK', v_firma;
END $$;

\echo '=== Caso 3: DESPUES, 3 argumentos funciona y usa la configuracion ==='
DO $$
DECLARE v_com numeric; v_sc numeric;
BEGIN
  SELECT agency_commission, service_charge INTO v_com, v_sc
    FROM public.calculate_payment_breakdown(1000, 30, 1);

  -- 15% de 1000 = 150. Si saliera 100, seria la vieja (10%) y no la habriamos
  -- borrado. Si saliera 150 pero el cargo fuera 30, seria un hibrido imposible.
  IF v_com <> 150 THEN
    RAISE EXCEPTION 'FALLO caso 3: comision % -- se esperaba 150 (15%% de platform_settings)', v_com;
  END IF;
  IF v_sc <> 50 THEN
    RAISE EXCEPTION 'FALLO caso 3: cargo por servicio % -- se esperaba 50 (5%% de platform_settings)', v_sc;
  END IF;
  RAISE NOTICE '  1000 -> comision 150 (15%%) y cargo 50 (5%%), leidos de platform_settings. OK';
END $$;

\echo '=== Caso 3b: si cambia la configuracion, la funcion la sigue ==='
DO $$
DECLARE v_com numeric;
BEGIN
  UPDATE public.platform_settings SET agency_commission_percentage = 18;
  SELECT agency_commission INTO v_com FROM public.calculate_payment_breakdown(1000, 30, 1);
  IF v_com <> 180 THEN
    RAISE EXCEPTION 'FALLO caso 3b: comision % -- se esperaba 180 tras subir el default a 18%%', v_com;
  END IF;
  UPDATE public.platform_settings SET agency_commission_percentage = 15;
  RAISE NOTICE '  default a 18%% -> comision 180. La funcion sigue a la configuracion. OK';
END $$;

\echo '=== Caso 4: una tasa explicita manda sobre la configuracion ==='
DO $$
DECLARE v_com numeric;
BEGIN
  -- Una agencia con 10% por contrato, como AVENTOURAX.
  SELECT agency_commission INTO v_com
    FROM public.calculate_payment_breakdown(1000, 30, 1, 0.10, 0.05);
  IF v_com <> 100 THEN
    RAISE EXCEPTION 'FALLO caso 4: comision % -- se esperaba 100 con tasa explicita de 0.10', v_com;
  END IF;

  -- Y el 0% pactado tambien tiene que respetarse: es el mismo bug del front,
  -- pero aqui el COALESCE ya lo trataba bien y conviene que quede clavado.
  SELECT agency_commission INTO v_com
    FROM public.calculate_payment_breakdown(1000, 30, 1, 0, 0.05);
  IF v_com <> 0 THEN
    RAISE EXCEPTION 'FALLO caso 4: una comision pactada de 0%% se convirtio en %', v_com;
  END IF;
  RAISE NOTICE '  tasa explicita manda, y el 0%% pactado sobrevive. OK';
END $$;

\echo '=== Caso 5: la migracion es reaplicable ==='
\ir ../supabase/migrations/20260910070000_quitar_calculate_payment_breakdown_ambiguo.sql
DO $$
DECLARE v_n int; v_com numeric;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'calculate_payment_breakdown';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALLO caso 5: tras reaplicar quedaron %', v_n; END IF;
  SELECT agency_commission INTO v_com FROM public.calculate_payment_breakdown(1000, 30, 1);
  IF v_com <> 150 THEN RAISE EXCEPTION 'FALLO caso 5: tras reaplicar la comision es %', v_com; END IF;
  RAISE NOTICE '  segunda aplicacion: sin cambios y sin error. OK';
END $$;

\echo ''
\echo 'calculate_payment_breakdown: 6/6 casos OK'
