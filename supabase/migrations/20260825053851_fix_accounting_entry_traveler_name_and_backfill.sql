-- create_accounting_entry_for_booking referenciaba users.full_name, columna que no
-- existe: users tiene first_name y last_name. La funcion lanzaba 42703 en TODA
-- llamada. sync-booking-to-accounting logueaba el error y devolvia 500, pero los
-- webhooks la invocan con EdgeRuntime.waitUntil(...).catch(console.error), asi que
-- fallaba en silencio absoluto.
--
-- Resultado: 19 reservas pagadas entre 2026-07-22 y 2026-08-25 (~$97,498 aprox) sin
-- asiento contable. Es la unica funcion de BD que referenciaba full_name.
--
-- El backfill usa la propia funcion, que deriva entry_date de paid_at, asi que cada
-- asiento cae en su mes real (12 del 31-jul quedan en periodo 2026-07) en vez de
-- amontonarse en el mes del backfill.

DO $mig$
DECLARE v_new text; v_prev text;
BEGIN
  v_new := pg_get_functiondef('public.create_accounting_entry_for_booking(uuid)'::regprocedure);
  v_prev := v_new;
  v_new := replace(v_new,
    'SELECT b.*, t.name AS tour_name, u.full_name AS traveler_name',
    'SELECT b.*, t.name AS tour_name, TRIM(COALESCE(u.first_name, '''') || '' '' || COALESCE(u.last_name, '''')) AS traveler_name');
  IF v_new = v_prev THEN RAISE EXCEPTION 'ancla u.full_name no encontrada'; END IF;
  EXECUTE v_new;
END $mig$;

-- Backfill retroactivo. La funcion ya es idempotente: sale con RETURN NULL si la
-- reserva ya tiene asiento de tipo 'ingreso'.
DO $backfill$
DECLARE r record; v_id uuid; v_ok integer := 0; v_null integer := 0;
BEGIN
  FOR r IN
    SELECT b.id, b.booking_code FROM public.bookings b
    WHERE b.payment_status = 'succeeded'
      AND NOT EXISTS (SELECT 1 FROM public.accounting_entries e
                      WHERE e.source_type = 'booking' AND e.source_id = b.id
                        AND e.entry_type = 'ingreso')
    ORDER BY b.paid_at
  LOOP
    SELECT public.create_accounting_entry_for_booking(r.id) INTO v_id;
    IF v_id IS NULL THEN v_null := v_null + 1; ELSE v_ok := v_ok + 1; END IF;
  END LOOP;
  RAISE NOTICE 'Backfill contable: % asientos creados, % omitidos', v_ok, v_null;
END $backfill$;
