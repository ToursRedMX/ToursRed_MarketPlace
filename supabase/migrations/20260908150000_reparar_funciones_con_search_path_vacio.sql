/*
  # Reparar las funciones que quedaron con search_path vacio

  ## Contexto

  La migracion 20251220004110_fix_all_function_search_paths.sql aplico
  `ALTER FUNCTION ... SET search_path = ''` sobre TODAS las funciones del
  esquema public, a ciegas. La intencion era buena (cerrar el vector de
  secuestro de search_path que marca el linter de Supabase), pero con
  search_path vacio solo resuelve pg_catalog: cualquier referencia sin
  calificar deja de resolver EN TIEMPO DE EJECUCION.

  Cuatro funciones tenian referencias sin calificar. Confirmado el 08-sep-2026
  leyendo la base: las cuatro reportan proconfig = {search_path=""}.

  ## Impacto real, verificado llamador por llamador

    update_agency_rating
      La llaman TRES TRIGGERS VIVOS sobre agency_reviews (AFTER INSERT,
      AFTER UPDATE, AFTER DELETE), creados en 20251215234545. Como el trigger
      lanza excepcion y no la maneja, la excepcion aborta la sentencia:
      >>> HOY NO SE PUEDEN ESCRIBIR RESEÑAS. <<<
      Este es el unico de los cuatro con impacto en produccion.

    cleanup_expired_notifications
    update_booking_payment_status
      Sin llamadores hoy: cero referencias en src/ y en supabase/functions/,
      y ninguna esta en un cron.schedule. Son codigo muerto. Se reparan igual
      para no dejar la trampa armada a quien las revive sin saber que estan
      rotas.

    get_all_reviews_with_details
      Tambien codigo muerto, pero esta NO se repara: SE BORRA.
      Devuelve el email de TODOS los viajeros con reseña, y la migracion
      20260831050459 ya la habia marcado como fuga y revocado de PUBLIC, anon
      y authenticated. Repararla volveria a poner en marcha una funcion que
      nadie usa y cuyo unico efecto es exponer esos correos: quedaria a un
      GRANT de descuido de volver a ser la fuga que ya se detecto.

      Borrarla no cambia nada operativo: hoy ya esta rota por el search_path
      vacio, asi que cualquier llamador externo que existiera (una consulta
      guardada, un reporte) ya venia fallando desde diciembre de 2025.
      Decision de Axel, 08-sep-2026. La definicion queda en el historial de
      git por si algun dia se necesita reconstruir el listado, esa vez con
      control de acceso.

  Las tres funciones de trigger (trigger_update_agency_rating_on_*) tambien se
  recrean: hacen `PERFORM update_agency_rating(...)` sin calificar, asi que con
  search_path vacio ni siquiera resuelven el NOMBRE de la funcion.

  ## Que hace esta migracion

    1. Repara SEIS funciones: fija `SET search_path = public, pg_catalog` y
       califica con `public.` todas las referencias a tablas y funciones.
    2. BORRA get_all_reviews_with_details (motivo arriba).

  Reparar son las dos cosas juntas, no una sola: calificar restaura la
  resolucion, y fijar el search_path cierra el vector de secuestro que la
  migracion de diciembre queria cerrar. Quitar el search_path habria arreglado
  lo primero reabriendo lo segundo.

  ## Por que CREATE OR REPLACE en las seis que se reparan

  CREATE OR REPLACE conserva los privilegios existentes; DROP los borra. Usar
  DROP + CREATE obligaria a rehacer a mano los REVOKE de 20260527192829, que
  son los que quitaron a authenticated el acceso directo a
  update_booking_payment_status y update_wallet_balance.

  Esta migracion no toca ni un solo GRANT ni REVOKE: el unico DROP que hay es
  el de get_all_reviews_with_details, y ahi el borrado es el objetivo, no un
  paso intermedio.

  Por la misma razon se conservan tal cual los modos de seguridad actuales de
  las seis: update_agency_rating, los tres triggers,
  cleanup_expired_notifications y update_booking_payment_status siguen siendo
  SECURITY DEFINER (20260527192829 dice explicitamente "Keep DEFINER but
  restrict to service_role only" para la ultima).

  Los triggers de agency_reviews NO se recrean: apuntan a estas funciones por
  nombre y quedan reparados al reemplazar el cuerpo.
*/

-- ---------------------------------------------------------------------------
-- 1. update_agency_rating  (la unica con impacto real)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_agency_rating(agency_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  avg_rating numeric;
BEGIN
  -- Promedio de todas las reseñas de la agencia
  SELECT COALESCE(AVG(rating), 0)
  INTO avg_rating
  FROM public.agency_reviews
  WHERE agency_id = agency_uuid;

  UPDATE public.agencies
  SET rating = avg_rating,
      updated_at = now()
  WHERE id = agency_uuid;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Las tres funciones de trigger sobre agency_reviews
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_update_agency_rating_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM public.update_agency_rating(NEW.agency_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_update_agency_rating_on_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM public.update_agency_rating(NEW.agency_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_update_agency_rating_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM public.update_agency_rating(OLD.agency_id);
  RETURN OLD;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. cleanup_expired_notifications  (codigo muerto, se repara igual)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_expired_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  DELETE FROM public.notifications
  WHERE expires_at IS NOT NULL
    AND expires_at < now() - INTERVAL '30 days';
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. update_booking_payment_status  (codigo muerto, se repara igual)
--    Se mantiene SECURITY DEFINER a proposito: ver 20260527192829.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_booking_payment_status(
  p_booking_id uuid,
  p_status text,
  p_payment_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  success boolean;
BEGIN
  UPDATE public.bookings
  SET
    status = p_status,
    payment_status = p_payment_status,
    updated_at = now(),
    paid_at = CASE WHEN p_payment_status = 'succeeded' THEN now() ELSE paid_at END
  WHERE id = p_booking_id;

  GET DIAGNOSTICS success = ROW_COUNT;
  RETURN success > 0;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. get_all_reviews_with_details  -> SE BORRA
--
--    Codigo muerto (0 llamadores en src/, en supabase/functions/ y en crons)
--    cuyo unico efecto es devolver el email de todos los viajeros con reseña.
--    Ya estaba revocada de PUBLIC/anon/authenticated por 20260831050459 y hoy
--    esta rota por el search_path vacio, asi que borrarla no quita nada que
--    este funcionando.
--
--    Sin CASCADE a proposito: si algo dependiera de ella, el DROP debe fallar
--    y avisar, no arrastrarse objetos en silencio.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_all_reviews_with_details();

-- ---------------------------------------------------------------------------
-- 6. Verificacion: la migracion falla si el arreglo no quedo aplicado
--    Mismo criterio que 20260903035817, que lleva su propia asercion.
-- ---------------------------------------------------------------------------

-- 6a. Prueba de humo real sobre el camino que estaba roto.
--     Con un uuid inexistente: el SELECT no devuelve filas y el UPDATE no
--     toca ninguna. Sin efectos secundarios. Si las referencias no
--     resolvieran, esto lanzaria y abortaria la migracion.
DO $$
BEGIN
  PERFORM public.update_agency_rating('00000000-0000-0000-0000-000000000000'::uuid);
END $$;

-- 6b. Ninguna de las seis reparadas puede quedar con search_path vacio
--     o sin fijar.
DO $$
DECLARE
  v_pendientes text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname)
  INTO v_pendientes
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'update_agency_rating',
      'trigger_update_agency_rating_on_insert',
      'trigger_update_agency_rating_on_update',
      'trigger_update_agency_rating_on_delete',
      'cleanup_expired_notifications',
      'update_booking_payment_status'
    )
    AND (
      p.proconfig IS NULL
      OR 'search_path=""' = ANY(p.proconfig)
    );

  IF v_pendientes IS NOT NULL THEN
    RAISE EXCEPTION
      'Quedaron funciones con search_path vacio o sin fijar: %', v_pendientes;
  END IF;
END $$;

-- 6b-bis. get_all_reviews_with_details no debe existir ya.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_all_reviews_with_details'
  ) THEN
    RAISE EXCEPTION
      'get_all_reviews_with_details sigue existiendo: el DROP no se aplico';
  END IF;
END $$;

-- 6c. Los tres triggers de agency_reviews deben seguir existiendo.
--     Esta migracion no los toca; si faltan, algo mas los quito.
DO $$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n
  FROM pg_trigger
  WHERE tgrelid = 'public.agency_reviews'::regclass
    AND NOT tgisinternal
    AND tgname IN (
      'update_agency_rating_on_review_insert',
      'update_agency_rating_on_review_update',
      'update_agency_rating_on_review_delete'
    );

  IF v_n <> 3 THEN
    RAISE EXCEPTION
      'Se esperaban 3 triggers de rating sobre agency_reviews y hay %', v_n;
  END IF;
END $$;
