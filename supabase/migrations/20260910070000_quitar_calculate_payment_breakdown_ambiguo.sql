-- Quitar la version vieja de `calculate_payment_breakdown`, que ademas de
-- estar mal hace que la buena no se pueda llamar.
--
-- ============================================================================
-- QUE PASA HOY
-- ============================================================================
--
-- Existen DOS funciones con el mismo nombre:
--
--   calculate_payment_breakdown(numeric, integer, integer)
--     -> creada por `20250628161215_divine_lake.sql`.
--        Comision clavada al 10% y cargo por servicio clavado al 3%.
--
--   calculate_payment_breakdown(numeric, integer, integer, numeric, numeric)
--     -> creada por `20260529170840_fix_remove_hardcoded_commission_rates.sql`.
--        Lee las tasas de `platform_settings` cuando no se le pasan.
--
-- La segunda migracion se llama "fix_remove_hardcoded_commission_rates" y su
-- intencion era claramente REEMPLAZAR a la primera. No lo hizo. Uso
-- `CREATE OR REPLACE FUNCTION` agregando dos parametros, y en Postgres la
-- firma es parte de la identidad de la funcion: agregar parametros no
-- reemplaza nada, CREA UNA FUNCION NUEVA. La vieja se quedo donde estaba,
-- con su 10% y su 3%, desde el 29-may-2026.
--
-- ============================================================================
-- LA CONSECUENCIA NO ES "CODIGO MUERTO": ES UN ERROR DURO
-- ============================================================================
--
-- Los dos parametros nuevos tienen DEFAULT, asi que una llamada de 3
-- argumentos encaja en las DOS funciones y Postgres no puede elegir.
-- Comprobado en Postgres 16.13 con las dos firmas reales:
--
--   SELECT * FROM calculate_payment_breakdown(1000, 30, 1);
--   ERROR:  function calculate_payment_breakdown(integer, integer, integer)
--           is not unique
--   HINT:  Could not choose a best candidate function.
--
-- O sea que la funcion "buena" solo se puede llamar pasandole los 5
-- argumentos -- justo la forma que NO usa la configuracion, porque si le pasas
-- las tasas ya no las lee de `platform_settings`. La forma corta, la unica que
-- consulta la configuracion, esta bloqueada desde hace tres meses y medio.
--
-- Eso tambien explica por que no hay ningun llamador: verificado el
-- 10-sep-2026 en `src/`, en `supabase/functions/` y dentro del propio SQL de
-- las migraciones -> cero. Cualquiera que lo hubiera intentado se habria
-- topado con el error de inmediato.
--
-- ============================================================================
-- POR QUE SE BORRA Y NO SE ARREGLA
-- ============================================================================
--
-- La vieja no tiene nada que rescatar: sus dos tasas son datos viejos (10% y
-- 3%, cuando la configuracion dice 15% y 5%) y no consulta nada. Ademas quedo
-- con `GRANT EXECUTE ... TO public` de la migracion original.
--
-- Borrarla no quita funcionalidad -- no hay quien la llame -- y ADEMAS
-- desbloquea la llamada de 3 argumentos de la funcion correcta, que es la
-- unica que respeta `platform_settings`.
--
-- No se toca la funcion de 5 parametros.

DO $migracion$
DECLARE
  v_cuantas int;
  v_firma   text;
BEGIN
  -- -------------------------------------------------------------------------
  -- 1. La de 5 parametros TIENE que estar antes de borrar nada.
  -- -------------------------------------------------------------------------
  -- Si por lo que sea no existe (una base a la que nunca llego la migracion de
  -- mayo), borrar la vieja dejaria a la plataforma sin ninguna. Mejor abortar
  -- que quedarse sin las dos.
  IF to_regprocedure('public.calculate_payment_breakdown(numeric, integer, integer, numeric, numeric)') IS NULL THEN
    RAISE EXCEPTION
      'Abortada: no existe calculate_payment_breakdown de 5 parametros. Aplica antes 20260529170840.';
  END IF;

  -- -------------------------------------------------------------------------
  -- 2. Fuera la vieja.
  -- -------------------------------------------------------------------------
  -- Con firma explicita: es lo unico que NO es ambiguo cuando hay dos
  -- sobrecargas. `IF EXISTS` para que la migracion sea reaplicable.
  DROP FUNCTION IF EXISTS public.calculate_payment_breakdown(numeric, integer, integer);

  -- -------------------------------------------------------------------------
  -- 3. Y se comprueba que quedo como debe.
  -- -------------------------------------------------------------------------
  SELECT count(*) INTO v_cuantas
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'calculate_payment_breakdown';

  IF v_cuantas <> 1 THEN
    RAISE EXCEPTION
      'Abortada: deberia quedar exactamente 1 calculate_payment_breakdown y quedaron %.', v_cuantas;
  END IF;

  SELECT p.oid::regprocedure::text INTO v_firma
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'calculate_payment_breakdown';

  IF position('numeric,numeric' in replace(v_firma, ' ', '')) = 0 THEN
    RAISE EXCEPTION
      'Abortada: la que sobrevivio no es la de 5 parametros. Quedo: %', v_firma;
  END IF;

  -- -------------------------------------------------------------------------
  -- 4. El comentario, DENTRO del bloque.
  -- -------------------------------------------------------------------------
  -- Un `DO` es UNA sola sentencia: si la guardia de arriba aborta, no se
  -- ejecuta nada de lo de aqui. Dejar el COMMENT fuera lo convertiria en una
  -- segunda sentencia suelta que, en autocommit, correria igual aunque la
  -- guardia hubiera abortado -- que es exactamente el fallo que se encontro en
  -- `20260910050000` al probarla. Por eso va por EXECUTE.
  EXECUTE $comentario$
    COMMENT ON FUNCTION public.calculate_payment_breakdown(numeric, integer, integer, numeric, numeric) IS
      'Desglose de pagos de un tour. Si no se le pasan p_agency_commission_rate y p_service_charge_rate, los lee de platform_settings. La version de 3 parametros (comision 10% y cargo 3% clavados) se elimino el 10-sep-2026: ademas de estar desactualizada, hacia ambigua toda llamada de 3 argumentos.'
  $comentario$;

  RAISE NOTICE 'Listo: quedo solo %, y la llamada de 3 argumentos vuelve a funcionar.', v_firma;
END $migracion$;
