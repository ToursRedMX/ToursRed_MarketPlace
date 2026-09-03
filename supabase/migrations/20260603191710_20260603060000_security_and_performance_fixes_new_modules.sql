-- ─── 1. Eliminar políticas RLS abiertas en wallet_checkin_otps ───────────────
-- Los edge functions usan service_role y bypasean RLS; authenticated no necesita estas políticas.

DROP POLICY IF EXISTS "System can insert checkin otps" ON wallet_checkin_otps;
DROP POLICY IF EXISTS "System can update checkin otps" ON wallet_checkin_otps;


-- ─── 2. Eliminar política RLS abierta en wallet_checkin_charges ──────────────

DROP POLICY IF EXISTS "System can insert checkin charges" ON wallet_checkin_charges;


-- ─── 3. Revocar EXECUTE de authenticated en funciones no-frontend ────────────

REVOKE EXECUTE ON FUNCTION create_accounting_entry_for_manual_cfdi(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION calculate_executive_platform_commissions(integer, integer) FROM authenticated;


-- ─── 4. Recrear get_garbage_bookings con validación interna de rol admin ─────
-- Convertida de LANGUAGE sql a plpgsql para poder validar el rol del llamante.

DROP FUNCTION IF EXISTS get_garbage_bookings(int);

CREATE FUNCTION get_garbage_bookings(threshold_days int DEFAULT 7)
RETURNS TABLE (
  id uuid,
  booking_code text,
  created_at timestamptz,
  status text,
  payment_status text,
  payment_method text,
  total_price numeric,
  travelers_count int,
  user_name text,
  user_email text,
  tour_name text,
  agency_name text,
  reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = (SELECT auth.uid())
      AND role IN ('admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Acceso denegado: se requiere rol de administrador';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.booking_code,
    b.created_at,
    b.status,
    b.payment_status,
    b.payment_method,
    b.total_price,
    b.travelers_count,
    COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), '—') AS user_name,
    COALESCE(u.email, '—') AS user_email,
    COALESCE(t.name, '—') AS tour_name,
    COALESCE(a.name, '—') AS agency_name,
    CASE
      WHEN b.payment_status = 'pending'
        THEN 'abandoned'
      WHEN b.payment_status = 'processing' AND b.payment_method = 'Transferencia Bancaria'
        THEN 'unconfirmed_transfer'
      WHEN b.payment_status = 'processing'
        THEN 'expired_processing'
      ELSE 'other'
    END AS reason
  FROM bookings b
  LEFT JOIN users u ON u.id = b.user_id
  LEFT JOIN tours t ON t.id = b.tour_id
  LEFT JOIN agencies a ON a.id = b.agency_id
  WHERE b.status IN ('pending', 'cancelled')
    AND (
      (
        b.payment_status = 'pending'
        AND b.created_at < NOW() - (threshold_days || ' days')::interval
      )
      OR (
        b.payment_status = 'processing'
        AND b.payment_method = 'Transferencia Bancaria'
        AND b.created_at < NOW() - (threshold_days || ' days')::interval
      )
      OR (
        b.payment_status = 'processing'
        AND b.payment_method != 'Transferencia Bancaria'
        AND b.created_at < NOW() - INTERVAL '3 days'
      )
    )
  ORDER BY b.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_garbage_bookings(int) TO authenticated;


-- ─── 5. Recrear generate_and_notify_platform_commissions con check de rol ────

CREATE OR REPLACE FUNCTION generate_and_notify_platform_commissions(
  p_month INTEGER,
  p_year  INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings     executive_commission_settings%ROWTYPE;
  v_count        INTEGER := 0;
  v_rec          RECORD;
  v_exec_rec     RECORD;
BEGIN
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
        'platform_revenue',       v_rec.platform_revenue,
        'commission_percentage',  v_rec.commission_percentage,
        'settings_id',            v_settings.id
      )
    );
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    RETURN 0;
  END IF;

  FOR v_exec_rec IN
    SELECT
      ae.id             AS executive_id,
      ae.first_name,
      ae.last_name,
      ae.email,
      SUM(ec.amount)    AS total_amount,
      jsonb_agg(
        jsonb_build_object(
          'agencyName', a.name,
          'amount',     ec.amount
        ) ORDER BY a.name
      ) AS agencies_detail
    FROM executive_commissions ec
    JOIN account_executives ae ON ae.id = ec.executive_id
    JOIN agencies a ON a.id = ec.agency_id
    WHERE ec.commission_type = 'platform_period'
      AND ec.period_month = p_month
      AND ec.period_year  = p_year
      AND ec.status = 'pending'
      AND ec.created_at >= (now() - INTERVAL '5 minutes')
    GROUP BY ae.id, ae.first_name, ae.last_name, ae.email
  LOOP
    PERFORM notify_executive_by_email(jsonb_build_object(
      'type',               'monthly_commission',
      'executiveEmail',     v_exec_rec.email,
      'executiveFirstName', v_exec_rec.first_name,
      'executiveLastName',  v_exec_rec.last_name,
      'periodMonth',        p_month,
      'periodYear',         p_year,
      'totalAmount',        v_exec_rec.total_amount,
      'agenciesDetail',     v_exec_rec.agencies_detail
    ));

    INSERT INTO notifications (user_id, type, title, message, data)
    SELECT
      ae.user_id,
      'commission_earned',
      'Comisiones de ' || TO_CHAR(make_date(p_year, p_month, 1), 'TMMonth YYYY'),
      'Generaste ' || TO_CHAR(v_exec_rec.total_amount, 'FM$999,990.00') || ' MXN en comisiones de plataforma este mes.',
      jsonb_build_object(
        'commission_type',  'platform_period',
        'period_month',     p_month,
        'period_year',      p_year,
        'total_amount',     v_exec_rec.total_amount,
        'agencies_count',   jsonb_array_length(v_exec_rec.agencies_detail)
      )
    FROM account_executives ae
    WHERE ae.id = v_exec_rec.executive_id;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_and_notify_platform_commissions(integer, integer) TO authenticated;


-- ─── 6. Corregir políticas de notifications ──────────────────────────────────
-- Eliminar política INSERT abierta (authenticated) — las notificaciones siempre
-- las crea el sistema vía funciones SECURITY DEFINER o edge functions (service_role).
-- Recrear SELECT y UPDATE con (SELECT auth.uid()) para evitar re-evaluación por fila.
-- Separar la política FOR ALL del admin en una política FOR SELECT específica.

DROP POLICY IF EXISTS "System can create notifications" ON notifications;
DROP POLICY IF EXISTS "Users can view their own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can update their own notifications" ON notifications;
DROP POLICY IF EXISTS "Admins can view all notifications" ON notifications;
-- Nombre alternativo que pudo haber creado la migración de consolidación
DROP POLICY IF EXISTS "Users and admins can view their notifications" ON notifications;

CREATE POLICY "Users can view their own notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update their own notifications"
  ON notifications FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Admins can view all notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role IN ('admin', 'super_admin')
    )
  );


-- ─── 7. Corregir booking_cleanup_logs con (SELECT auth.uid()) ────────────────

DROP POLICY IF EXISTS "Admins can insert cleanup logs" ON booking_cleanup_logs;
DROP POLICY IF EXISTS "Admins can view cleanup logs" ON booking_cleanup_logs;

CREATE POLICY "Admins can insert cleanup logs"
  ON booking_cleanup_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = (SELECT auth.uid())
        AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Admins can view cleanup logs"
  ON booking_cleanup_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = (SELECT auth.uid())
        AND role IN ('admin', 'super_admin')
    )
  );


-- ─── 8. Crear índices en foreign keys sin cobertura ──────────────────────────

CREATE INDEX IF NOT EXISTS idx_cfdi_invoices_accounting_account_code
  ON cfdi_invoices(accounting_account_code);

CREATE INDEX IF NOT EXISTS idx_manual_cfdi_recipients_created_by
  ON manual_cfdi_recipients(created_by);

CREATE INDEX IF NOT EXISTS idx_wallet_checkin_charges_otp_id
  ON wallet_checkin_charges(otp_id);
