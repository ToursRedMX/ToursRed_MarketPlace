-- Vigilancia de cobros sin snapshot fiscal.
--
-- POR QUE EXISTE
--
-- Los triggers de 20260901053000 tienen EXCEPTION WHEN OTHERS: si el calculo
-- del snapshot falla, dejan las columnas en NULL antes que tumbar el registro
-- del pago. Esa decision es correcta —el cobro manda— pero convierte el fallo
-- en silencioso: la fila queda cobrada y sin composicion fiscal, y el CFDI
-- saldra con el 16% implicito aunque el tour fuera exento.
--
-- Un fallo silencioso que depende de que alguien se acuerde de correr una
-- consulta no es vigilancia. Ya paso en este proyecto con
-- send-membership-renewal-reminders: 209 ejecuciones fallando sin que nadie lo
-- viera. Por eso esto es un pg_cron, no una nota en un documento.
--
-- Sigue el patron de check_orphaned_cfdi_substitutes(): recorre, notifica a los
-- admins activos con create_notification() y devuelve jsonb con el resumen.

-- ── POR QUE UN CUTOFF Y NO UNA VENTANA DE DIAS ──────────────────────────────
-- La primera version filtraba por "cobrado en los ultimos 90 dias" y disparo
-- con 41 falsos positivos el mismo dia de aplicarla: 32 reservas y 9 opcionales
-- pagados entre el 7-jul y el 28-ago, TODOS anteriores al trigger, todos con
-- NULL por diseno. Una ventana de dias no distingue "el trigger fallo" de "esta
-- fila es anterior a la feature".
--
-- Una alerta que grita el dia uno se silencia, y despues no avisa cuando el
-- fallo es real — que es exactamente el problema de
-- send-membership-renewal-reminders que esta funcion existe para no repetir.
--
-- El criterio correcto es "cobrado DESPUES de que el trigger existe": solo ahi
-- un NULL significa que algo fallo.

CREATE OR REPLACE FUNCTION public.check_missing_tax_snapshots()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Momento en que se instalaron los triggers de snapshot (migracion
  -- 20260901053000). Un cobro anterior con snapshot NULL es historico y
  -- correcto; uno posterior significa que el trigger fallo.
  c_activacion constant timestamptz := '2026-09-01 06:35:00+00';
  v_bookings   integer := 0;
  v_supps      integer := 0;
  v_optionals  integer := 0;
  v_total      integer := 0;
  v_admin      RECORD;
  v_detalle    text;
BEGIN
  -- Cobrado y sin congelar. La ventana de 90 dias evita alertar para siempre
  -- por una fila vieja que ya se reviso y se decidio dejar como esta.
  SELECT count(*) INTO v_bookings
  FROM public.bookings
  WHERE (paid_at IS NOT NULL OR payment_status = 'paid')
    AND tax_treatment IS NULL
    AND COALESCE(paid_at, updated_at, created_at) > c_activacion;

  SELECT count(*) INTO v_supps
  FROM public.booking_supplements
  WHERE paid_at IS NOT NULL
    AND tax_treatment IS NULL
    AND paid_at > c_activacion;

  SELECT count(*) INTO v_optionals
  FROM public.booking_optional_services
  WHERE paid_at IS NOT NULL
    AND tax_treatment IS NULL
    AND paid_at > c_activacion;

  v_total := v_bookings + v_supps + v_optionals;

  IF v_total = 0 THEN
    RETURN jsonb_build_object(
      'ok', true, 'total', 0,
      'checked_at', now(), 'since', c_activacion,
      'message', 'Todos los cobros posteriores a la activacion tienen snapshot fiscal'
    );
  END IF;

  v_detalle :=
    'Hay ' || v_total || ' cobro(s) posteriores a la activacion sin snapshot fiscal: ' ||
    v_bookings || ' reserva(s), ' || v_supps || ' suplemento(s), ' ||
    v_optionals || ' servicio(s) opcional(es). ' ||
    'El trigger de snapshot fallo y esos cobros se facturaran con IVA 16% ' ||
    'implicito aunque su tour/suplemento/opcional fuera exento o mixto. ' ||
    'Revisar los WARNING de snapshot_*_tax en el log de Postgres.';

  FOR v_admin IN SELECT id FROM public.users WHERE role = 'admin' AND is_active = true
  LOOP
    BEGIN
      PERFORM public.create_notification(
        v_admin.id,
        -- 'system_announcement' y no un valor nuevo: p_type es el ENUM
        -- notification_type y agregarle un valor exige ALTER TYPE ADD VALUE,
        -- que no puede correr dentro del bloque transaccional de una migracion.
        --
        -- Ojo: check_orphaned_cfdi_substitutes() usa 'cfdi_reconciliation_alert',
        -- que NO esta entre los 32 valores del enum. Esa llamada lanzaria
        -- excepcion, y como esta envuelta en su propio EXCEPTION, la traga: si
        -- aparece un CFDI sustituto huerfano, ningun admin se entera. Es el
        -- mismo fallo silencioso que esta funcion existe para evitar, y conviene
        -- corregirlo aparte.
        'system_announcement',
        'Cobros sin snapshot fiscal',
        v_detalle
      );
    EXCEPTION WHEN OTHERS THEN
      -- Que falle notificar a un admin no debe impedir notificar al resto ni
      -- tumbar el cron. Mismo criterio que en los triggers.
      RAISE WARNING 'check_missing_tax_snapshots: no se pudo notificar a %: %', v_admin.id, SQLERRM;
    END;
  END LOOP;

  RAISE WARNING '%', v_detalle;

  RETURN jsonb_build_object(
    'ok', false,
    'total', v_total,
    'bookings', v_bookings,
    'supplements', v_supps,
    'optional_services', v_optionals,
    'since', c_activacion, 'checked_at', now(),
    'message', v_detalle
  );
END;
$$;

COMMENT ON FUNCTION public.check_missing_tax_snapshots IS
  'Detecta cobros sin snapshot fiscal (el trigger fallo y degrado a NULL). Corre a diario por pg_cron y notifica a los admins activos.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Programacion
-- ─────────────────────────────────────────────────────────────────────────────
-- 05:00 UTC, justo despues de generate-accounting-entries-daily (04:00), para
-- que si un cobro quedo sin congelar se detecte antes de que la contabilidad
-- del dia lo arrastre.
--
-- unschedule primero para que la migracion sea reejecutable sin duplicar el job.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-missing-tax-snapshots') THEN
    PERFORM cron.unschedule('check-missing-tax-snapshots');
  END IF;

  PERFORM cron.schedule(
    'check-missing-tax-snapshots',
    '0 5 * * *',
    'SELECT public.check_missing_tax_snapshots();'
  );
END$$;
