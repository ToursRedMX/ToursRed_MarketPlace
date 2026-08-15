-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER FUNCTION: is_admin_with_executive_permission
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_admin_with_executive_permission()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u
    LEFT JOIN admin_permissions ap ON ap.user_id = u.id
    WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'super_admin')
      AND (u.is_super_admin = true OR ap.can_manage_executives = true)
  );
$$;

GRANT EXECUTE ON FUNCTION is_admin_with_executive_permission() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER FUNCTION: get_executive_id_for_user
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_executive_id_for_user(p_user_id UUID)
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM account_executives WHERE user_id = p_user_id AND is_active = true LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_executive_id_for_user(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: account_executives
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY "Admins can view all account executives"
  ON account_executives FOR SELECT
  TO authenticated
  USING (is_admin_with_executive_permission());

CREATE POLICY "Admins can insert account executives"
  ON account_executives FOR INSERT
  TO authenticated
  WITH CHECK (is_admin_with_executive_permission());

CREATE POLICY "Admins can update account executives"
  ON account_executives FOR UPDATE
  TO authenticated
  USING (is_admin_with_executive_permission())
  WITH CHECK (is_admin_with_executive_permission());

CREATE POLICY "Executives can view own record"
  ON account_executives FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: executive_commission_settings
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY "Admins can view commission settings"
  ON executive_commission_settings FOR SELECT
  TO authenticated
  USING (is_admin_with_executive_permission());

CREATE POLICY "Admins can update commission settings"
  ON executive_commission_settings FOR UPDATE
  TO authenticated
  USING (is_admin_with_executive_permission())
  WITH CHECK (is_admin_with_executive_permission());

CREATE POLICY "Executives can view commission settings"
  ON executive_commission_settings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM account_executives ae
      WHERE ae.user_id = auth.uid() AND ae.is_active = true
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: executive_bonus_rules
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY "Admins can manage bonus rules"
  ON executive_bonus_rules FOR SELECT
  TO authenticated
  USING (is_admin_with_executive_permission());

CREATE POLICY "Admins can insert bonus rules"
  ON executive_bonus_rules FOR INSERT
  TO authenticated
  WITH CHECK (is_admin_with_executive_permission());

CREATE POLICY "Admins can update bonus rules"
  ON executive_bonus_rules FOR UPDATE
  TO authenticated
  USING (is_admin_with_executive_permission())
  WITH CHECK (is_admin_with_executive_permission());

CREATE POLICY "Executives can view active bonus rules"
  ON executive_bonus_rules FOR SELECT
  TO authenticated
  USING (
    is_active = true AND
    EXISTS (
      SELECT 1 FROM account_executives ae
      WHERE ae.user_id = auth.uid() AND ae.is_active = true
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: agency_leads
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY "Admins can view all leads"
  ON agency_leads FOR SELECT
  TO authenticated
  USING (is_admin_with_executive_permission());

CREATE POLICY "Executives can view own leads"
  ON agency_leads FOR SELECT
  TO authenticated
  USING (
    executive_id = get_executive_id_for_user(auth.uid())
  );

CREATE POLICY "Executives can insert own leads"
  ON agency_leads FOR INSERT
  TO authenticated
  WITH CHECK (
    executive_id = get_executive_id_for_user(auth.uid())
  );

CREATE POLICY "Executives can update own leads"
  ON agency_leads FOR UPDATE
  TO authenticated
  USING (executive_id = get_executive_id_for_user(auth.uid()))
  WITH CHECK (executive_id = get_executive_id_for_user(auth.uid()));

CREATE POLICY "Admins can update any lead"
  ON agency_leads FOR UPDATE
  TO authenticated
  USING (is_admin_with_executive_permission())
  WITH CHECK (is_admin_with_executive_permission());

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: executive_commissions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY "Admins can view all executive commissions"
  ON executive_commissions FOR SELECT
  TO authenticated
  USING (is_admin_with_executive_permission());

CREATE POLICY "Executives can view own commissions"
  ON executive_commissions FOR SELECT
  TO authenticated
  USING (
    executive_id = get_executive_id_for_user(auth.uid())
  );

CREATE POLICY "Executives can update own commissions to upload CFDI"
  ON executive_commissions FOR UPDATE
  TO authenticated
  USING (
    executive_id = get_executive_id_for_user(auth.uid())
    AND status = 'pending'
  )
  WITH CHECK (
    executive_id = get_executive_id_for_user(auth.uid())
    AND status IN ('pending', 'invoiced')
  );

CREATE POLICY "Admins can update executive commissions for approval"
  ON executive_commissions FOR UPDATE
  TO authenticated
  USING (is_admin_with_executive_permission())
  WITH CHECK (is_admin_with_executive_permission());

CREATE POLICY "System can insert executive commissions"
  ON executive_commissions FOR INSERT
  TO authenticated
  WITH CHECK (is_admin_with_executive_permission());

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: executive_bonus_awards
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY "Admins can view all bonus awards"
  ON executive_bonus_awards FOR SELECT
  TO authenticated
  USING (is_admin_with_executive_permission());

CREATE POLICY "Executives can view own bonus awards"
  ON executive_bonus_awards FOR SELECT
  TO authenticated
  USING (
    executive_id = get_executive_id_for_user(auth.uid())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: on_agency_approved — genera comisión approval
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_agency_approved()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings executive_commission_settings%ROWTYPE;
  v_exec_id UUID;
BEGIN
  -- Solo actuar cuando is_approved cambia de false/null a true
  IF (NEW.is_approved = true AND (OLD.is_approved IS DISTINCT FROM true)) THEN
    -- Solo para agencias registradas por ejecutivo con ejecutivo asignado
    IF NEW.registered_by_executive = true AND NEW.account_executive_id IS NOT NULL THEN
      -- Registrar fecha de inicio del periodo
      IF NEW.approval_period_start IS NULL THEN
        NEW.approval_period_start := now();
      END IF;

      -- Obtener configuración vigente
      SELECT * INTO v_settings
      FROM executive_commission_settings
      WHERE is_current = true
      LIMIT 1;

      -- Crear comisión de aprobación
      IF v_settings.id IS NOT NULL THEN
        INSERT INTO executive_commissions (
          executive_id,
          agency_id,
          commission_type,
          amount,
          status,
          commission_settings_snapshot
        ) VALUES (
          NEW.account_executive_id,
          NEW.id,
          'approval',
          v_settings.amount_per_approval,
          'pending',
          jsonb_build_object(
            'amount_per_approval', v_settings.amount_per_approval,
            'amount_per_first_booking', v_settings.amount_per_first_booking,
            'platform_revenue_percentage', v_settings.platform_revenue_percentage,
            'commission_period_months', v_settings.commission_period_months,
            'settings_id', v_settings.id
          )
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agency_approved ON agencies;
CREATE TRIGGER trg_agency_approved
  BEFORE UPDATE ON agencies
  FOR EACH ROW
  EXECUTE FUNCTION handle_agency_approved();

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: on_tour_published — registra primer tour
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_tour_published()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Cuando un tour queda visible/activo por primera vez
  -- is_active no existe en tours, se detecta cuando se inserta o cuando end_date > now
  -- Actualizamos first_tour_published_at si es null
  UPDATE agencies
  SET first_tour_published_at = now()
  WHERE id = NEW.agency_id
    AND first_tour_published_at IS NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tour_published ON tours;
CREATE TRIGGER trg_tour_published
  AFTER INSERT ON tours
  FOR EACH ROW
  EXECUTE FUNCTION handle_tour_published();

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: on_booking_paid — registra primera reserva pagada
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_booking_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agency agencies%ROWTYPE;
  v_settings executive_commission_settings%ROWTYPE;
  v_already_generated BOOLEAN;
BEGIN
  -- Solo actuar cuando payment_status cambia a 'paid'
  IF (NEW.payment_status = 'paid' AND (OLD.payment_status IS DISTINCT FROM 'paid')) THEN

    -- Cargar agencia
    SELECT * INTO v_agency FROM agencies WHERE id = NEW.agency_id LIMIT 1;

    -- Actualizar first_paid_booking_at si es null
    IF v_agency.first_paid_booking_at IS NULL THEN
      UPDATE agencies
      SET first_paid_booking_at = now()
      WHERE id = NEW.agency_id;

      -- Recargar después del UPDATE
      SELECT * INTO v_agency FROM agencies WHERE id = NEW.agency_id LIMIT 1;
    END IF;

    -- Verificar si hay que generar comisión first_tour_and_booking
    -- Condiciones: registered_by_executive=true, ejecutivo asignado,
    --              primer tour ya publicado, esta es la primera reserva pagada
    IF v_agency.registered_by_executive = true
      AND v_agency.account_executive_id IS NOT NULL
      AND v_agency.first_tour_published_at IS NOT NULL
    THEN
      -- Verificar que aún no se haya generado esta comisión
      SELECT EXISTS (
        SELECT 1 FROM executive_commissions
        WHERE agency_id = NEW.agency_id
          AND commission_type = 'first_tour_and_booking'
      ) INTO v_already_generated;

      IF NOT v_already_generated THEN
        SELECT * INTO v_settings
        FROM executive_commission_settings
        WHERE is_current = true
        LIMIT 1;

        IF v_settings.id IS NOT NULL THEN
          INSERT INTO executive_commissions (
            executive_id,
            agency_id,
            commission_type,
            amount,
            status,
            commission_settings_snapshot
          ) VALUES (
            v_agency.account_executive_id,
            NEW.agency_id,
            'first_tour_and_booking',
            v_settings.amount_per_first_booking,
            'pending',
            jsonb_build_object(
              'amount_per_approval', v_settings.amount_per_approval,
              'amount_per_first_booking', v_settings.amount_per_first_booking,
              'platform_revenue_percentage', v_settings.platform_revenue_percentage,
              'commission_period_months', v_settings.commission_period_months,
              'settings_id', v_settings.id
            )
          );
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_booking_paid ON bookings;
CREATE TRIGGER trg_booking_paid
  AFTER UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION handle_booking_paid();

-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCIÓN: calculate_executive_platform_commissions
-- Calcula comisiones de periodo para un mes/año dado
-- Ejecutar manualmente cada mes desde admin o con cron
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION calculate_executive_platform_commissions(
  p_month INTEGER,
  p_year INTEGER
)
RETURNS TABLE(
  executive_id UUID,
  executive_name TEXT,
  agency_id UUID,
  agency_name TEXT,
  platform_revenue DECIMAL,
  commission_percentage DECIMAL,
  commission_amount DECIMAL,
  already_exists BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings executive_commission_settings%ROWTYPE;
  v_period_start DATE;
  v_period_end DATE;
BEGIN
  SELECT * INTO v_settings FROM executive_commission_settings WHERE is_current = true LIMIT 1;

  v_period_start := make_date(p_year, p_month, 1);
  v_period_end := (v_period_start + INTERVAL '1 month')::DATE;

  RETURN QUERY
  SELECT
    ae.id AS executive_id,
    (ae.first_name || ' ' || ae.last_name) AS executive_name,
    a.id AS agency_id,
    a.name AS agency_name,
    COALESCE(SUM(cr.platform_total_revenue), 0) AS platform_revenue,
    v_settings.platform_revenue_percentage AS commission_percentage,
    ROUND(COALESCE(SUM(cr.platform_total_revenue), 0) * v_settings.platform_revenue_percentage / 100, 2) AS commission_amount,
    EXISTS (
      SELECT 1 FROM executive_commissions ec2
      WHERE ec2.executive_id = ae.id
        AND ec2.agency_id = a.id
        AND ec2.commission_type = 'platform_period'
        AND ec2.period_month = p_month
        AND ec2.period_year = p_year
    ) AS already_exists
  FROM account_executives ae
  JOIN agencies a ON a.account_executive_id = ae.id
  JOIN commission_records cr ON cr.agency_id = a.id
  WHERE
    ae.is_active = true
    AND a.registered_by_executive = true
    AND a.approval_period_start IS NOT NULL
    -- Solo durante el periodo configurable desde la aprobación
    AND v_period_start >= DATE_TRUNC('month', a.approval_period_start)::DATE
    AND v_period_start < (a.approval_period_start + (v_settings.commission_period_months || ' months')::INTERVAL)::DATE
    -- Solo comisiones del mes consultado
    AND cr.created_at >= v_period_start
    AND cr.created_at < v_period_end
    AND cr.status != 'disputed'
  GROUP BY ae.id, ae.first_name, ae.last_name, a.id, a.name
  HAVING COALESCE(SUM(cr.platform_total_revenue), 0) > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_executive_platform_commissions(INTEGER, INTEGER) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCIÓN: generate_executive_platform_commissions
-- Genera (inserta) las comisiones de periodo para un mes/año dado
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_executive_platform_commissions(
  p_month INTEGER,
  p_year INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings executive_commission_settings%ROWTYPE;
  v_count INTEGER := 0;
  v_rec RECORD;
BEGIN
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
        'platform_revenue', v_rec.platform_revenue,
        'commission_percentage', v_rec.commission_percentage,
        'settings_id', v_settings.id
      )
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_executive_platform_commissions(INTEGER, INTEGER) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Bucket para contratos firmados
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'signed-contracts',
  'signed-contracts',
  false,
  10485760, -- 10MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Política de acceso al bucket de contratos
CREATE POLICY "Admins can upload signed contracts"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'signed-contracts'
    AND is_admin_with_executive_permission()
  );

CREATE POLICY "Admins and executives can view signed contracts"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'signed-contracts'
    AND (
      is_admin_with_executive_permission()
      OR EXISTS (
        SELECT 1 FROM account_executives ae
        WHERE ae.user_id = auth.uid() AND ae.is_active = true
      )
    )
  );
