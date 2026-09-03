-- ============================================================
-- FEATURED TOURS FINANCIAL SYSTEM
-- Adds payment-gating, accounting fields and SQL helper functions
-- ============================================================

-- 1. Add pending_payment status to featured_tour_slots
ALTER TABLE featured_tour_slots
  DROP CONSTRAINT IF EXISTS featured_tour_slots_status_check;

ALTER TABLE featured_tour_slots
  ADD CONSTRAINT featured_tour_slots_status_check
    CHECK (status IN ('pending_payment', 'active', 'expired', 'cancelled'));

-- 2. Add financial traceability fields to featured_tour_slots
ALTER TABLE featured_tour_slots
  ADD COLUMN IF NOT EXISTS subtotal             numeric(10,2),
  ADD COLUMN IF NOT EXISTS tax_amount           numeric(10,2),
  ADD COLUMN IF NOT EXISTS total_amount         numeric(10,2),
  ADD COLUMN IF NOT EXISTS payment_id           text,
  ADD COLUMN IF NOT EXISTS payment_provider     text,
  ADD COLUMN IF NOT EXISTS payment_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_id           uuid REFERENCES cfdi_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accounting_entry_id  uuid REFERENCES accounting_entries(id) ON DELETE SET NULL;

-- 3. Seed account 406 — Ingresos por Publicidad y Promocion
INSERT INTO chart_of_accounts (code, sat_group_code, name, account_type, parent_code, level, nature, is_system, description)
VALUES (
  '406', '406-01',
  'Ingresos por Publicidad y Promocion',
  'ingreso', '40', 3, 'acreedora', true,
  'Ingresos por servicios de publicidad en plataforma — tours destacados y promociones pagadas'
)
ON CONFLICT (code) DO NOTHING;

-- 4. Add source_type 'featured_slot' to accounting_entries
ALTER TABLE accounting_entries
  DROP CONSTRAINT IF EXISTS accounting_entries_source_type_check;

ALTER TABLE accounting_entries
  ADD CONSTRAINT accounting_entries_source_type_check
    CHECK (source_type IN ('booking', 'payout', 'cancellation', 'manual', 'membership', 'gift_card', 'featured_slot'));

-- 5. Expand cfdi_invoices.invoice_type CHECK to include all existing values + featured_slot
ALTER TABLE cfdi_invoices
  DROP CONSTRAINT IF EXISTS cfdi_invoices_invoice_type_check;

ALTER TABLE cfdi_invoices
  ADD CONSTRAINT cfdi_invoices_invoice_type_check
    CHECK (invoice_type IN (
      'booking', 'commission', 'membership', 'featured_slot',
      'supplement', 'optional_service', 'post_booking_insurance',
      'checkin_wallet', 'manual'
    ));

-- Add featured_slot_id FK column to cfdi_invoices
ALTER TABLE cfdi_invoices
  ADD COLUMN IF NOT EXISTS featured_slot_id uuid REFERENCES featured_tour_slots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cfdi_invoices_featured_slot
  ON cfdi_invoices(featured_slot_id)
  WHERE featured_slot_id IS NOT NULL;

-- 6. Replace activate_featured_slot to create pending_payment slots
CREATE OR REPLACE FUNCTION activate_featured_slot(
  p_tour_id   uuid,
  p_agency_id uuid,
  p_plan_id   uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_count  int;
  v_plan_duration int;
  v_plan_price    numeric(10,2);
  v_subtotal      numeric(10,2);
  v_tax           numeric(10,2);
  v_slot_id       uuid;
BEGIN
  -- Global cap on active slots
  SELECT COUNT(*) INTO v_active_count
  FROM featured_tour_slots
  WHERE status = 'active' AND expires_at > now();

  IF v_active_count >= 50 THEN
    RAISE EXCEPTION 'Maximum of 50 active featured slots reached';
  END IF;

  -- No active slot for this tour
  IF EXISTS (
    SELECT 1 FROM featured_tour_slots
    WHERE tour_id = p_tour_id AND status = 'active' AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'Tour already has an active featured slot';
  END IF;

  SELECT duration_days, price INTO v_plan_duration, v_plan_price
  FROM featured_plans WHERE id = p_plan_id;

  v_subtotal := ROUND((v_plan_price / 1.16)::numeric, 2);
  v_tax      := v_plan_price - v_subtotal;

  -- Create slot in pending_payment; starts_at/expires_at finalized on payment confirmation
  INSERT INTO featured_tour_slots (
    tour_id, agency_id, plan_id, status,
    starts_at, expires_at,
    subtotal, tax_amount, total_amount
  )
  VALUES (
    p_tour_id, p_agency_id, p_plan_id,
    'pending_payment',
    now(),
    now() + (v_plan_duration || ' days')::interval,
    v_subtotal, v_tax, v_plan_price
  )
  RETURNING id INTO v_slot_id;

  RETURN v_slot_id;
END;
$$;

GRANT EXECUTE ON FUNCTION activate_featured_slot(uuid, uuid, uuid) TO authenticated;

-- 7. Function: confirm payment and activate slot
CREATE OR REPLACE FUNCTION confirm_featured_slot_payment(
  p_slot_id          uuid,
  p_payment_id       text,
  p_payment_provider text,
  p_total            numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot     record;
  v_subtotal numeric(10,2);
  v_tax      numeric(10,2);
BEGIN
  SELECT * INTO v_slot
  FROM featured_tour_slots
  WHERE id = p_slot_id AND status = 'pending_payment';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Slot not found or not in pending_payment status: %', p_slot_id;
  END IF;

  v_subtotal := ROUND((p_total / 1.16)::numeric, 2);
  v_tax      := p_total - v_subtotal;

  UPDATE featured_tour_slots SET
    status               = 'active',
    payment_id           = p_payment_id,
    payment_provider     = p_payment_provider,
    payment_confirmed_at = now(),
    subtotal             = v_subtotal,
    tax_amount           = v_tax,
    total_amount         = p_total,
    starts_at            = now(),
    expires_at           = now() + ((
      SELECT duration_days FROM featured_plans WHERE id = v_slot.plan_id
    ) || ' days')::interval,
    updated_at           = now()
  WHERE id = p_slot_id;

  -- Initialize stats row
  INSERT INTO featured_tour_stats (slot_id) VALUES (p_slot_id)
  ON CONFLICT (slot_id) DO NOTHING;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_featured_slot_payment(uuid, text, text, numeric) TO service_role;

-- 8. Function: create accounting entry for featured slot payment
CREATE OR REPLACE FUNCTION create_accounting_entry_for_featured_slot(p_slot_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot         record;
  v_cfdi_uuid    text;
  v_entry_id     uuid;
  v_entry_number text;
  v_year         integer;
  v_month        integer;
BEGIN
  -- Idempotencia
  IF EXISTS (
    SELECT 1 FROM accounting_entries
    WHERE source_type = 'featured_slot' AND source_id = p_slot_id
      AND entry_type = 'ingreso'
  ) THEN
    RETURN NULL;
  END IF;

  SELECT s.*, a.name AS agency_name_col
  INTO v_slot
  FROM featured_tour_slots s
  JOIN agencies a ON a.id = s.agency_id
  WHERE s.id = p_slot_id
    AND s.status = 'active'
    AND s.payment_confirmed_at IS NOT NULL;

  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Retrieve cfdi uuid if already stamped
  SELECT uuid_fiscal INTO v_cfdi_uuid
  FROM cfdi_invoices
  WHERE featured_slot_id = p_slot_id AND status = 'stamped'
  LIMIT 1;

  v_year  := EXTRACT(YEAR  FROM COALESCE(v_slot.payment_confirmed_at, v_slot.created_at))::integer;
  v_month := EXTRACT(MONTH FROM COALESCE(v_slot.payment_confirmed_at, v_slot.created_at))::integer;

  v_entry_number := generate_entry_number('ingreso', v_year, v_month);

  INSERT INTO accounting_entries (
    entry_number, entry_type, entry_date, period_year, period_month,
    description, source_type, source_id, is_posted
  ) VALUES (
    v_entry_number, 'ingreso',
    COALESCE(v_slot.payment_confirmed_at::date, v_slot.created_at::date),
    v_year, v_month,
    'Tour Destacado — ' || COALESCE(v_slot.agency_name_col, v_slot.agency_id::text),
    'featured_slot', p_slot_id, true
  )
  RETURNING id INTO v_entry_id;

  -- Line 1: Debit Bancos (total con IVA)
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, 1, '102',
    'Cobro tour destacado — ' || COALESCE(v_slot.agency_name_col, ''),
    v_slot.total_amount, 0, v_cfdi_uuid);

  -- Line 2: Credit IVA Trasladado
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, 2, '210',
    'IVA 16% tour destacado',
    0, v_slot.tax_amount, v_cfdi_uuid);

  -- Line 3: Credit Ingresos por Publicidad y Promocion
  INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
  VALUES (v_entry_id, 3, '406',
    'Ingreso publicidad tour destacado — ' || COALESCE(v_slot.agency_name_col, ''),
    0, v_slot.subtotal, v_cfdi_uuid);

  -- Link entry to slot record
  UPDATE featured_tour_slots
  SET accounting_entry_id = v_entry_id, updated_at = now()
  WHERE id = p_slot_id;

  RETURN v_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_accounting_entry_for_featured_slot(uuid) TO service_role;
