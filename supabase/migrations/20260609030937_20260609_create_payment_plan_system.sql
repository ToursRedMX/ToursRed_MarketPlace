
-- ============================================================
-- SISTEMA DE PLANES DE PAGO - MIGRACION COMPLETA
-- ============================================================

-- ============================================================
-- PASO 1: Columnas en tabla tours
-- ============================================================

ALTER TABLE tours
  ADD COLUMN IF NOT EXISTS payment_option TEXT NOT NULL DEFAULT 'full_upfront'
    CHECK (payment_option IN ('full_upfront', 'payment_plan', 'both')),
  ADD COLUMN IF NOT EXISTS full_payment_days_before_departure INTEGER DEFAULT 15
    CHECK (full_payment_days_before_departure >= 15),
  ADD COLUMN IF NOT EXISTS payment_plan_mode TEXT
    CHECK (payment_plan_mode IN ('free_form', 'installments')),
  ADD COLUMN IF NOT EXISTS installment_definitions JSONB,
  ADD COLUMN IF NOT EXISTS late_payment_grace_days INTEGER NOT NULL DEFAULT 5
    CHECK (late_payment_grace_days >= 0),
  ADD COLUMN IF NOT EXISTS late_payment_penalty_pct NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (late_payment_penalty_pct >= 0 AND late_payment_penalty_pct <= 100),
  ADD COLUMN IF NOT EXISTS late_payment_penalty_fixed NUMERIC(12,2) NOT NULL DEFAULT 0
    CHECK (late_payment_penalty_fixed >= 0);

-- ============================================================
-- PASO 2: Tabla booking_payment_plans
-- ============================================================

CREATE TABLE IF NOT EXISTS booking_payment_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('free_form', 'installments', 'full_upfront')),
  total_plan_amount NUMERIC(12,2) NOT NULL CHECK (total_plan_amount > 0),
  total_amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount_paid >= 0),
  pending_balance NUMERIC(12,2) GENERATED ALWAYS AS (total_plan_amount - total_amount_paid) STORED,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'cancelled', 'defaulted')),
  paid_100_pct_at_booking BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (booking_id)
);

ALTER TABLE booking_payment_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_payment_plan" ON booking_payment_plans FOR SELECT
  TO authenticated USING (
    booking_id IN (
      SELECT id FROM bookings WHERE user_id = (SELECT auth.uid())
    ) OR
    booking_id IN (
      SELECT b.id FROM bookings b
      JOIN tours t ON t.id = b.tour_id
      JOIN agencies a ON a.id = t.agency_id
      WHERE a.user_id = (SELECT auth.uid())
    ) OR
    EXISTS (SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin','accountant'))
  );

CREATE POLICY "insert_own_payment_plan" ON booking_payment_plans FOR INSERT
  TO authenticated WITH CHECK (
    booking_id IN (
      SELECT id FROM bookings WHERE user_id = (SELECT auth.uid())
    ) OR
    EXISTS (SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin'))
  );

CREATE POLICY "update_own_payment_plan" ON booking_payment_plans FOR UPDATE
  TO authenticated USING (
    booking_id IN (
      SELECT b.id FROM bookings b
      JOIN tours t ON t.id = b.tour_id
      JOIN agencies a ON a.id = t.agency_id
      WHERE a.user_id = (SELECT auth.uid())
    ) OR
    EXISTS (SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin'))
  );

CREATE POLICY "service_role_payment_plan" ON booking_payment_plans
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- PASO 3: Tabla booking_payment_plan_installments
-- ============================================================

CREATE TABLE IF NOT EXISTS booking_payment_plan_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES booking_payment_plans(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  installment_number INTEGER NOT NULL,
  label TEXT NOT NULL,
  amount_due NUMERIC(12,2) NOT NULL CHECK (amount_due >= 0),
  amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'partially_paid', 'paid', 'overdue', 'overdue_grace', 'waived', 'cancelled')),
  penalty_applied NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (penalty_applied >= 0),
  late_payment_penalty_apply_once BOOLEAN NOT NULL DEFAULT false,
  cfdi_invoice_id UUID,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_installments_plan_id ON booking_payment_plan_installments(plan_id);
CREATE INDEX IF NOT EXISTS idx_installments_booking_id ON booking_payment_plan_installments(booking_id);
CREATE INDEX IF NOT EXISTS idx_installments_status ON booking_payment_plan_installments(status);
CREATE INDEX IF NOT EXISTS idx_installments_due_date ON booking_payment_plan_installments(due_date);

ALTER TABLE booking_payment_plan_installments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_installment" ON booking_payment_plan_installments FOR SELECT
  TO authenticated USING (
    booking_id IN (
      SELECT id FROM bookings WHERE user_id = (SELECT auth.uid())
    ) OR
    booking_id IN (
      SELECT b.id FROM bookings b
      JOIN tours t ON t.id = b.tour_id
      JOIN agencies a ON a.id = t.agency_id
      WHERE a.user_id = (SELECT auth.uid())
    ) OR
    EXISTS (SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin','accountant'))
  );

CREATE POLICY "insert_installment" ON booking_payment_plan_installments FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin'))
  );

CREATE POLICY "update_installment" ON booking_payment_plan_installments FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin'))
  );

CREATE POLICY "service_role_installment" ON booking_payment_plan_installments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- PASO 4: Tabla booking_payment_plan_transactions
-- ============================================================

CREATE TABLE IF NOT EXISTS booking_payment_plan_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES booking_payment_plans(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  service_charge NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (service_charge >= 0),
  total_charged NUMERIC(12,2) GENERATED ALWAYS AS (amount + service_charge) STORED,
  payment_provider TEXT NOT NULL
    CHECK (payment_provider IN ('stripe', 'paypal', 'mercadopago', 'toursred_cash', 'points', 'bank_transfer', 'cash')),
  provider_transaction_id TEXT,
  membership_exemption_used BOOLEAN NOT NULL DEFAULT false,
  membership_exemption_id UUID,
  points_earned INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ppt_plan_id ON booking_payment_plan_transactions(plan_id);
CREATE INDEX IF NOT EXISTS idx_ppt_booking_id ON booking_payment_plan_transactions(booking_id);
CREATE INDEX IF NOT EXISTS idx_ppt_user_id ON booking_payment_plan_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_ppt_status ON booking_payment_plan_transactions(status);

ALTER TABLE booking_payment_plan_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_ppt" ON booking_payment_plan_transactions FOR SELECT
  TO authenticated USING (
    user_id = (SELECT auth.uid()) OR
    booking_id IN (
      SELECT b.id FROM bookings b
      JOIN tours t ON t.id = b.tour_id
      JOIN agencies a ON a.id = t.agency_id
      WHERE a.user_id = (SELECT auth.uid())
    ) OR
    EXISTS (SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin','accountant'))
  );

CREATE POLICY "insert_own_ppt" ON booking_payment_plan_transactions FOR INSERT
  TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "update_own_ppt" ON booking_payment_plan_transactions FOR UPDATE
  TO authenticated USING (
    user_id = (SELECT auth.uid()) OR
    EXISTS (SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin'))
  );

CREATE POLICY "service_role_ppt" ON booking_payment_plan_transactions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- PASO 5: Tabla booking_payment_plan_transaction_allocations
-- ============================================================

CREATE TABLE IF NOT EXISTS booking_payment_plan_transaction_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES booking_payment_plan_transactions(id) ON DELETE CASCADE,
  installment_id UUID NOT NULL REFERENCES booking_payment_plan_installments(id) ON DELETE CASCADE,
  amount_allocated NUMERIC(12,2) NOT NULL CHECK (amount_allocated > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (transaction_id, installment_id)
);

CREATE INDEX IF NOT EXISTS idx_alloc_transaction_id ON booking_payment_plan_transaction_allocations(transaction_id);
CREATE INDEX IF NOT EXISTS idx_alloc_installment_id ON booking_payment_plan_transaction_allocations(installment_id);

ALTER TABLE booking_payment_plan_transaction_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_alloc" ON booking_payment_plan_transaction_allocations FOR SELECT
  TO authenticated USING (
    transaction_id IN (
      SELECT id FROM booking_payment_plan_transactions
      WHERE user_id = (SELECT auth.uid())
    ) OR
    EXISTS (SELECT 1 FROM public.users WHERE id = (SELECT auth.uid()) AND role IN ('admin','super_admin','accountant'))
  );

CREATE POLICY "service_role_alloc" ON booking_payment_plan_transaction_allocations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- PASO 6: Columnas en tabla bookings
-- ============================================================

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS has_payment_plan BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_plan_total NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS payment_plan_paid NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_plan_status TEXT
    CHECK (payment_plan_status IN ('active', 'completed', 'defaulted', 'cancelled'));

-- ============================================================
-- PASO 7: Columnas en tabla cfdi_invoices y nuevo tipo
-- ============================================================

ALTER TABLE cfdi_invoices
  ADD COLUMN IF NOT EXISTS booking_payment_plan_transaction_id UUID
    REFERENCES booking_payment_plan_transactions(id),
  ADD COLUMN IF NOT EXISTS installment_id UUID
    REFERENCES booking_payment_plan_installments(id);

-- Actualizar constraint con todos los tipos existentes + nuevo
ALTER TABLE cfdi_invoices DROP CONSTRAINT IF EXISTS cfdi_invoices_invoice_type_check;
ALTER TABLE cfdi_invoices ADD CONSTRAINT cfdi_invoices_invoice_type_check
  CHECK (invoice_type = ANY (ARRAY[
    'booking'::text,
    'commission'::text,
    'membership'::text,
    'manual'::text,
    'checkin_wallet'::text,
    'supplement'::text,
    'optional_service'::text,
    'post_booking_insurance'::text,
    'post_booking_extras'::text,
    'booking_installment'::text
  ]));

-- Indice unico para evitar CFDI duplicados por parcialidad
CREATE UNIQUE INDEX IF NOT EXISTS uq_cfdi_booking_installment
  ON cfdi_invoices (installment_id)
  WHERE invoice_type = 'booking_installment'
    AND installment_id IS NOT NULL
    AND status IN ('pending', 'stamped');

-- ============================================================
-- PASO 8: Ajustes en platform_settings
-- ============================================================

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS cfdi_serie_installment TEXT NOT NULL DEFAULT 'AI',
  ADD COLUMN IF NOT EXISTS payment_plan_service_charge_pct NUMERIC(5,2) NOT NULL DEFAULT 5.00
    CHECK (payment_plan_service_charge_pct >= 0 AND payment_plan_service_charge_pct <= 100);

-- ============================================================
-- PASO 9: Nuevos valores en el ENUM notification_type
-- ============================================================

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'payment_plan_reminder';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'payment_plan_overdue';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'payment_plan_overdue_critical';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'payment_plan_paid';

-- ============================================================
-- PASO 10: Trigger updated_at para nuevas tablas
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_payment_plan_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bpp_updated_at
  BEFORE UPDATE ON booking_payment_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_payment_plan_updated_at();

CREATE TRIGGER trg_bppi_updated_at
  BEFORE UPDATE ON booking_payment_plan_installments
  FOR EACH ROW EXECUTE FUNCTION public.update_payment_plan_updated_at();

CREATE TRIGGER trg_bppt_updated_at
  BEFORE UPDATE ON booking_payment_plan_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_payment_plan_updated_at();

-- ============================================================
-- PASO 11: Funcion cron para procesar vencimientos (cada 5 horas)
-- ============================================================

CREATE OR REPLACE FUNCTION public.process_payment_plan_deadlines()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now DATE := CURRENT_DATE;
  v_installment RECORD;
BEGIN
  -- pending -> overdue_grace si within grace period, o overdue directo
  FOR v_installment IN
    SELECT i.id, i.plan_id, i.due_date, i.status,
           t.late_payment_grace_days, t.late_payment_penalty_pct, t.late_payment_penalty_fixed,
           i.amount_due, i.late_payment_penalty_apply_once
    FROM booking_payment_plan_installments i
    JOIN booking_payment_plans p ON p.id = i.plan_id
    JOIN bookings b ON b.id = p.booking_id
    JOIN tours t ON t.id = b.tour_id
    WHERE i.status = 'pending'
      AND i.due_date < v_now
      AND p.status = 'active'
  LOOP
    IF (v_now - v_installment.due_date) <= v_installment.late_payment_grace_days THEN
      UPDATE booking_payment_plan_installments
      SET status = 'overdue_grace', updated_at = NOW()
      WHERE id = v_installment.id;
    ELSE
      IF NOT v_installment.late_payment_penalty_apply_once THEN
        UPDATE booking_payment_plan_installments
        SET status = 'overdue',
            penalty_applied = CASE
              WHEN v_installment.late_payment_penalty_pct > 0
              THEN ROUND(v_installment.amount_due * v_installment.late_payment_penalty_pct / 100, 2)
              ELSE v_installment.late_payment_penalty_fixed
            END,
            late_payment_penalty_apply_once = true,
            updated_at = NOW()
        WHERE id = v_installment.id;
      ELSE
        UPDATE booking_payment_plan_installments
        SET status = 'overdue', updated_at = NOW()
        WHERE id = v_installment.id;
      END IF;
    END IF;
  END LOOP;

  -- overdue_grace que ya superaron el grace period -> overdue
  FOR v_installment IN
    SELECT i.id, i.amount_due, i.late_payment_penalty_apply_once,
           t.late_payment_grace_days, t.late_payment_penalty_pct, t.late_payment_penalty_fixed,
           i.due_date
    FROM booking_payment_plan_installments i
    JOIN booking_payment_plans p ON p.id = i.plan_id
    JOIN bookings b ON b.id = p.booking_id
    JOIN tours t ON t.id = b.tour_id
    WHERE i.status = 'overdue_grace'
      AND (v_now - i.due_date) > t.late_payment_grace_days
      AND p.status = 'active'
  LOOP
    IF NOT v_installment.late_payment_penalty_apply_once THEN
      UPDATE booking_payment_plan_installments
      SET status = 'overdue',
          penalty_applied = CASE
            WHEN v_installment.late_payment_penalty_pct > 0
            THEN ROUND(v_installment.amount_due * v_installment.late_payment_penalty_pct / 100, 2)
            ELSE v_installment.late_payment_penalty_fixed
          END,
          late_payment_penalty_apply_once = true,
          updated_at = NOW()
      WHERE id = v_installment.id;
    ELSE
      UPDATE booking_payment_plan_installments
      SET status = 'overdue', updated_at = NOW()
      WHERE id = v_installment.id;
    END IF;
  END LOOP;

  -- Planes con installments overdue > 30 dias -> defaulted
  UPDATE booking_payment_plans p
  SET status = 'defaulted', updated_at = NOW()
  WHERE p.status = 'active'
    AND EXISTS (
      SELECT 1 FROM booking_payment_plan_installments i
      WHERE i.plan_id = p.id
        AND i.status = 'overdue'
        AND (v_now - i.due_date) > 30
    );

  -- Planes donde todas las parcialidades estan pagadas -> completed
  UPDATE booking_payment_plans p
  SET status = 'completed', updated_at = NOW()
  WHERE p.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM booking_payment_plan_installments i
      WHERE i.plan_id = p.id
        AND i.status NOT IN ('paid', 'waived', 'cancelled')
    );

END;
$$;

SELECT cron.schedule(
  'process_payment_plan_deadlines',
  '0 */5 * * *',
  $$SELECT public.process_payment_plan_deadlines()$$
);

-- ============================================================
-- PASO 12: RPC para calcular el minimo a cobrar al reservar
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_payment_plan_minimum_at_booking(
  p_tour_id UUID,
  p_booking_date DATE,
  p_total_amount NUMERIC,
  p_departure_date DATE DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tour RECORD;
  v_def JSONB;
  v_min NUMERIC := 0;
  v_def_date DATE;
BEGIN
  SELECT payment_option, payment_plan_mode, installment_definitions,
         full_payment_days_before_departure
  INTO v_tour
  FROM tours WHERE id = p_tour_id;

  IF NOT FOUND OR v_tour.payment_plan_mode IS NULL THEN
    RETURN p_total_amount;
  END IF;

  IF v_tour.payment_plan_mode = 'free_form' THEN
    RETURN 0;
  END IF;

  IF v_tour.installment_definitions IS NOT NULL THEN
    FOR v_def IN SELECT * FROM jsonb_array_elements(v_tour.installment_definitions)
    LOOP
      IF v_def->>'days_after_booking' IS NOT NULL THEN
        v_def_date := p_booking_date + (v_def->>'days_after_booking')::INTEGER;
      ELSIF v_def->>'days_before_departure' IS NOT NULL AND p_departure_date IS NOT NULL THEN
        v_def_date := p_departure_date - (v_def->>'days_before_departure')::INTEGER;
      ELSE
        CONTINUE;
      END IF;

      IF v_def_date <= p_booking_date THEN
        v_min := v_min + ROUND(p_total_amount * (v_def->>'pct_of_total')::NUMERIC / 100, 2);
      END IF;
    END LOOP;
  END IF;

  RETURN v_min;
END;
$$;

REVOKE ALL ON FUNCTION public.get_payment_plan_minimum_at_booking(UUID, DATE, NUMERIC, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_payment_plan_minimum_at_booking(UUID, DATE, NUMERIC, DATE) TO authenticated;
