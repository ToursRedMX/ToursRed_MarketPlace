-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260901064252
--   name:    check_missing_tax_snapshots_cutoff
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

-- Corrige el criterio de check_missing_tax_snapshots().
--
-- La primera version filtraba por "cobrado en los ultimos 90 dias", y eso no
-- distingue un fallo del trigger de una fila legitimamente anterior a la
-- feature. Al aplicarla disparo con 41 falsos positivos: 32 reservas y 9
-- opcionales pagados entre el 7-jul y el 28-ago, todos ANTES de que el trigger
-- existiera, todos con NULL por diseno (= 16% implicito, sin recalcular nada).
--
-- Una alerta que grita el dia uno se silencia, y despues no avisa cuando el
-- fallo es real. El criterio correcto es "cobrado DESPUES de que el trigger
-- existe": solo ahi un NULL significa que algo fallo.

CREATE OR REPLACE FUNCTION public.check_missing_tax_snapshots()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  -- Momento en que se instalaron los triggers de snapshot (migracion
  -- snapshot_tax_on_charge). Un cobro anterior a esta marca con snapshot NULL
  -- es historico y correcto; uno posterior significa que el trigger fallo.
  c_activacion constant timestamptz := '2026-09-01 06:35:00+00';
  v_bookings   integer := 0;
  v_supps      integer := 0;
  v_optionals  integer := 0;
  v_total      integer := 0;
  v_admin      RECORD;
  v_detalle    text;
BEGIN
  SELECT count(*) INTO v_bookings
  FROM public.bookings
  WHERE (paid_at IS NOT NULL OR payment_status = 'paid')
    AND tax_treatment IS NULL
    AND COALESCE(paid_at, updated_at, created_at) > c_activacion;

  SELECT count(*) INTO v_supps
  FROM public.booking_supplements
  WHERE paid_at IS NOT NULL AND tax_treatment IS NULL AND paid_at > c_activacion;

  SELECT count(*) INTO v_optionals
  FROM public.booking_optional_services
  WHERE paid_at IS NOT NULL AND tax_treatment IS NULL AND paid_at > c_activacion;

  v_total := v_bookings + v_supps + v_optionals;

  IF v_total = 0 THEN
    RETURN jsonb_build_object('ok', true, 'total', 0, 'checked_at', now(),
      'since', c_activacion,
      'message', 'Todos los cobros posteriores a la activacion tienen snapshot fiscal');
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
        v_admin.id, 'system_announcement', 'Cobros sin snapshot fiscal', v_detalle
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'check_missing_tax_snapshots: no se pudo notificar a %: %', v_admin.id, SQLERRM;
    END;
  END LOOP;

  RAISE WARNING '%', v_detalle;

  RETURN jsonb_build_object('ok', false, 'total', v_total,
    'bookings', v_bookings, 'supplements', v_supps, 'optional_services', v_optionals,
    'since', c_activacion, 'checked_at', now(), 'message', v_detalle);
END;
$fn$;

COMMENT ON FUNCTION public.check_missing_tax_snapshots IS
  'Detecta cobros POSTERIORES a la activacion de los triggers sin snapshot fiscal (el trigger fallo y degrado a NULL). Los cobros anteriores tienen NULL por diseno y no alertan. Corre a diario por pg_cron.'
;
