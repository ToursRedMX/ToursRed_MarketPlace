-- ═══════════════════════════════════════════════════════════════════════════════
-- GRUPO A: Revocar de anon Y authenticated
-- ═══════════════════════════════════════════════════════════════════════════════

-- Trigger functions
REVOKE EXECUTE ON FUNCTION handle_agency_approved() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION handle_booking_paid() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION handle_tour_published() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION sync_agency_approval_to_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION sync_user_approval_to_agency() FROM anon, authenticated;

-- Helpers internos
REVOKE EXECUTE ON FUNCTION notify_executive_by_email(jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION calculate_executive_platform_commissions(integer, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION generate_executive_platform_commissions(integer, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION create_accounting_entry_for_manual_cfdi(uuid) FROM anon, authenticated;

-- Función de cron
REVOKE EXECUTE ON FUNCTION process_expired_slot_reschedules() FROM anon, authenticated;

-- get_effective_commission_rates (ambas variantes)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'get_effective_commission_rates'
      AND n.nspname = 'public' AND p.pronargs = 1
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION get_effective_commission_rates(uuid) FROM anon, authenticated';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'get_effective_commission_rates'
      AND n.nspname = 'public' AND p.pronargs = 2
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION get_effective_commission_rates(uuid, uuid) FROM anon, authenticated';
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- GRUPO B: Revocar de anon solamente, conservar authenticated
-- ═══════════════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION is_admin_with_executive_permission() FROM anon;
REVOKE EXECUTE ON FUNCTION get_executive_id_for_user(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION generate_and_notify_platform_commissions(integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION get_garbage_bookings(integer) FROM anon;

-- Re-confirmar grants a authenticated para las funciones del grupo B
-- (por si REVOKE FROM PUBLIC de la migración anterior los afectó)
GRANT EXECUTE ON FUNCTION is_admin_with_executive_permission() TO authenticated;
GRANT EXECUTE ON FUNCTION get_executive_id_for_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_and_notify_platform_commissions(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_garbage_bookings(integer) TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════════
-- GRUPO C: Guard de admin en generate_executive_platform_commissions (obsoleta)
-- Defensa en profundidad: aunque está revocada, si alguien re-otorga acceso
-- en el futuro la función misma rechazará usuarios no-admin.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION generate_executive_platform_commissions(
  p_month INTEGER,
  p_year  INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings executive_commission_settings%ROWTYPE;
  v_count    INTEGER := 0;
  v_rec      RECORD;
BEGIN
  -- Guard: solo administradores pueden ejecutar esta función
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = (SELECT auth.uid())
      AND role IN ('admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Acceso denegado: se requiere rol de administrador';
  END IF;

  SELECT * INTO v_settings FROM executive_commission_settings WHERE is_current = true LIMIT 1;

  FOR v_rec IN
    SELECT * FROM calculate_executive_platform_commissions(p_month, p_year)
    WHERE NOT already_exists AND commission_amount > 0
  LOOP
    INSERT INTO executive_commissions (
      executive_id,
      agency_id,
      commission_type,
      amount,
      period_month,
      period_year,
      status,
      commission_settings_snapshot
    ) VALUES (
      v_rec.executive_id,
      v_rec.agency_id,
      'platform_period',
      v_rec.commission_amount,
      p_month,
      p_year,
      'pending',
      jsonb_build_object(
        'platform_revenue',      v_rec.platform_revenue,
        'commission_percentage', v_rec.commission_percentage,
        'settings_id',           v_settings.id
      )
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- No GRANT: la función queda accesible solo para postgres (el owner)
