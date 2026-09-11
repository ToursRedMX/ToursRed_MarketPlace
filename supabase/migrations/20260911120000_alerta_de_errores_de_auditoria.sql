-- `audit_errors` deja rastro y nadie lo lee. Ahora avisa.
--
-- POR QUE
--
-- La tabla existe desde hace semanas y varias funciones escriben en ella
-- —`snapshot_booking_tax` cuando no puede calcular el snapshot fiscal,
-- `check_cobros_sin_comision` cuando encuentra cobros sin comision, y el
-- embudo de auditoria cuando algo falla—. Pero NADA la mira: no hay funcion,
-- ni cron, ni pantalla que la consulte.
--
-- Se vio el 11-sep-2026: tenia 31 filas, todas iguales, del 24-ago al 05-sep.
-- Eran intentos de registrar `BOOKING_CREATED` rechazados con «Acceso no
-- autorizado» — o sea que las reservas de los viajeros llevaban DOS SEMANAS
-- sin quedar en la bitacora, y la propia base lo estaba diciendo. Aparecio
-- mirando la tabla por curiosidad, no por un aviso.
--
-- Dejar rastro no sirve de nada si el rastro no dispara nada.
--
-- ---------------------------------------------------------------------------
-- LA TRAMPA DE ESTE CASO CONCRETO, Y COMO SE EVITA
--
-- El patron del repo (`check_cobros_sin_comision`) hace dos cosas al encontrar
-- algo: notifica a los admins Y deja una fila en `audit_errors`.
--
-- Aqui ESO NO SE PUEDE HACER. Una vigilancia que mira `audit_errors` y ademas
-- escribe en `audit_errors` se alimenta a si misma: su propia fila seria un
-- hallazgo nuevo en la siguiente pasada, que generaria otra fila, y el aviso no
-- pararia nunca aunque el problema original estuviera resuelto.
--
-- Asi que esta funcion SOLO notifica. Su rastro es el jsonb que devuelve, que
-- pg_cron guarda en `cron.job_run_details`.
--
-- ---------------------------------------------------------------------------
-- QUE CUENTA COMO «SIN REVISAR»
--
-- Lo que haya entrado en las ultimas 24 horas, que es justo el periodo entre
-- dos pasadas del cron. No se marcan filas como vistas —eso pediria una columna
-- nueva y un sitio donde marcarlas— y no hace falta: si un error se repite cada
-- dia, avisar cada dia es lo correcto; y si deja de repetirse, el aviso para
-- solo.
--
-- Con esa ventana, las 31 filas historicas NO disparan nada: son de agosto y
-- principios de septiembre, y su causa ya se arreglo en `20260911100000`. Una
-- guardia que nace gritando por cosas viejas se aprende a ignorar.

BEGIN;

-- El valor nuevo del enum. `ADD VALUE` se permite dentro de una transaccion
-- desde PG12, pero el valor NO se puede usar hasta que la transaccion cierre:
-- por eso aqui solo se declara, y quien lo usa es la funcion, en ejecucion.
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'errores_de_auditoria';

COMMIT;

BEGIN;

CREATE OR REPLACE FUNCTION public.check_errores_de_auditoria()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- Una pasada del cron. Ver el encabezado: no se marcan filas como revisadas.
  c_ventana constant interval := interval '24 hours';

  v_total   integer := 0;
  v_filas   integer := 0;
  v_detalle jsonb;
  v_admin   RECORD;
  v_texto   text;
BEGIN
  SELECT count(*), coalesce(sum(t.veces), 0), jsonb_agg(t)
  INTO v_total, v_filas, v_detalle
  FROM (
    SELECT
      left(coalesce(e.error_message, '(sin mensaje)'), 120)        AS error,
      coalesce(e.sqlstate, '(sin sqlstate)')                       AS sqlstate,
      coalesce(e.raw_payload->>'funcion', '(sin funcion)')         AS origen,
      count(*)                                                     AS veces,
      min(e.attempted_at)                                          AS primero,
      max(e.attempted_at)                                          AS ultimo
    FROM public.audit_errors e
    WHERE e.attempted_at >= now() - c_ventana
    GROUP BY 1, 2, 3
    ORDER BY 4 DESC
  ) t;

  IF v_total = 0 THEN
    RETURN jsonb_build_object('ok', true, 'grupos', 0, 'ventana', c_ventana::text);
  END IF;

  v_texto := 'La base registro ' || v_filas || ' error(es) en audit_errors en las ultimas 24 horas, '
          || 'repartidos en ' || v_total || ' grupo(s). Esa tabla la escriben los caminos que fallan '
          || 'SIN tumbar la operacion: un snapshot fiscal que no se pudo calcular, un cobro sin '
          || 'comision, un evento de auditoria rechazado. Conviene mirarlos porque nadie mas lo hace. '
          || 'Detalle: ' || v_detalle::text;

  FOR v_admin IN
    SELECT id FROM public.users
    WHERE role IN ('admin', 'super_admin') AND is_active
  LOOP
    INSERT INTO public.notifications (user_id, type, title, message, data)
    VALUES (
      v_admin.id,
      'errores_de_auditoria',
      'Errores registrados en la bitacora tecnica',
      v_texto,
      jsonb_build_object('grupos', v_detalle, 'ventana', c_ventana::text, 'filas', v_filas)
    );
  END LOOP;

  -- A proposito NO se inserta en `audit_errors`: ver el encabezado. Lo que
  -- queda como rastro es este jsonb, en `cron.job_run_details`.
  RETURN jsonb_build_object('ok', false, 'grupos', v_total, 'filas', v_filas, 'detalle', v_detalle);
END;
$function$;

COMMIT;

-- ---------------------------------------------------------------------------
-- El cron.
--
-- A las 06:15 UTC, separado a proposito de los otros dos vigilantes
-- —`check-missing-tax-snapshots` a las 05:00 y `cobros-sin-comision` a las
-- 13:30— para que los avisos no lleguen todos de golpe y se lean como uno solo.
--
-- `unschedule` primero: la migracion tiene que poder reaplicarse sin duplicar
-- el trabajo, y `cron.schedule` con el mismo nombre no reemplaza en todas las
-- versiones de pg_cron.
DO $cron$
BEGIN
  PERFORM cron.unschedule('errores-de-auditoria');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- no existia; es el caso normal la primera vez
END
$cron$;

SELECT cron.schedule(
  'errores-de-auditoria',
  '15 6 * * *',
  $$SELECT public.check_errores_de_auditoria();$$
);

-- ---------------------------------------------------------------------------
-- Aserciones.
--
-- La primera es la que de verdad importa: si alguien "mejora" la funcion
-- haciendola escribir en `audit_errors` —que es lo que hacen sus dos hermanas y
-- por tanto lo que parece correcto al leerlas— la vigilancia se alimentaria a
-- si misma y avisaria para siempre. Ver el encabezado.
DO $verificacion$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'check_errores_de_auditoria';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'check_errores_de_auditoria no quedo creada';
  END IF;

  IF v_def ILIKE '%INSERT INTO public.audit_errors%' OR v_def ILIKE '%INSERT INTO audit_errors%' THEN
    RAISE EXCEPTION 'check_errores_de_auditoria escribe en audit_errors: se alimentaria a si misma y el aviso no pararia nunca';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'errores-de-auditoria' AND active) THEN
    RAISE EXCEPTION 'el cron errores-de-auditoria no quedo programado o esta inactivo';
  END IF;
END
$verificacion$;
