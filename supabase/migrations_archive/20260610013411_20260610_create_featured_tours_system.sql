-- ============================================================
-- FEATURED TOURS SYSTEM
-- source of truth: featured_tour_slots (no flag on tours table)
-- ============================================================

-- 1. Configurable plans (no hardcoded prices)
CREATE TABLE featured_plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  duration_days int NOT NULL CHECK (duration_days > 0),
  price       numeric(10,2) NOT NULL CHECK (price > 0),
  is_active   boolean NOT NULL DEFAULT true,
  display_order int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO featured_plans (name, duration_days, price, display_order) VALUES
  ('7 días',  7,   299.00, 1),
  ('15 días', 15,  499.00, 2),
  ('30 días', 30,  799.00, 3),
  ('60 días', 60, 1299.00, 4),
  ('90 días', 90, 1799.00, 5);

-- 2. Active slots (max 50 active at a time, one per tour)
CREATE TABLE featured_tour_slots (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id    uuid NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  agency_id  uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  plan_id    uuid NOT NULL REFERENCES featured_plans(id),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled')),
  starts_at  timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One active slot per tour at a time
CREATE UNIQUE INDEX uq_featured_tour_active
  ON featured_tour_slots(tour_id)
  WHERE status = 'active';

-- 3. Waitlist
CREATE TABLE featured_tour_waitlist (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id     uuid NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  agency_id   uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  plan_id     uuid NOT NULL REFERENCES featured_plans(id),
  position    int NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'waiting'
              CHECK (status IN ('waiting','notified','paid','skipped','expired')),
  notified_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_featured_waitlist_tour ON featured_tour_waitlist(tour_id, status, position);

-- 4. Metrics per slot
CREATE TABLE featured_tour_stats (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id      uuid NOT NULL REFERENCES featured_tour_slots(id) ON DELETE CASCADE,
  impressions  int NOT NULL DEFAULT 0,
  clicks       int NOT NULL DEFAULT 0,
  bookings_generated int NOT NULL DEFAULT 0,
  first_impression_at timestamptz,
  last_impression_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_featured_stats_slot ON featured_tour_stats(slot_id);

-- 5. Add source_type to bookings for attribution
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'organic'
    CHECK (source_type IN ('organic','featured','promotion','direct')),
  ADD COLUMN IF NOT EXISTS featured_slot_id uuid REFERENCES featured_tour_slots(id) ON DELETE SET NULL;

-- 6. Indexes for performance
CREATE INDEX idx_featured_slots_active ON featured_tour_slots(status, expires_at)
  WHERE status = 'active';
CREATE INDEX idx_featured_slots_agency  ON featured_tour_slots(agency_id);
CREATE INDEX idx_featured_slots_tour    ON featured_tour_slots(tour_id);
CREATE INDEX idx_bookings_featured_slot ON bookings(featured_slot_id)
  WHERE featured_slot_id IS NOT NULL;

-- 7. RLS
ALTER TABLE featured_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE featured_tour_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE featured_tour_waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE featured_tour_stats ENABLE ROW LEVEL SECURITY;

-- featured_plans: public read, admin write
CREATE POLICY "public_read_featured_plans" ON featured_plans
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "admin_all_featured_plans" ON featured_plans
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','super_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','super_admin')));

-- featured_tour_slots: public read active+non-expired; agencies own; admin all
CREATE POLICY "public_read_active_slots" ON featured_tour_slots
  FOR SELECT TO anon, authenticated
  USING (status = 'active' AND expires_at > now());

CREATE POLICY "agency_read_own_slots" ON featured_tour_slots
  FOR SELECT TO authenticated
  USING (agency_id IN (SELECT id FROM agencies WHERE user_id = auth.uid()));

CREATE POLICY "admin_read_all_slots" ON featured_tour_slots
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','super_admin')));

CREATE POLICY "admin_insert_slots" ON featured_tour_slots
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','super_admin')));

CREATE POLICY "admin_update_slots" ON featured_tour_slots
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','super_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','super_admin')));

CREATE POLICY "service_role_all_slots" ON featured_tour_slots
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- featured_tour_waitlist: agencies own; admin all
CREATE POLICY "agency_read_own_waitlist" ON featured_tour_waitlist
  FOR SELECT TO authenticated
  USING (agency_id IN (SELECT id FROM agencies WHERE user_id = auth.uid()));

CREATE POLICY "agency_insert_waitlist" ON featured_tour_waitlist
  FOR INSERT TO authenticated
  WITH CHECK (agency_id IN (SELECT id FROM agencies WHERE user_id = auth.uid()));

CREATE POLICY "admin_all_waitlist" ON featured_tour_waitlist
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','super_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','super_admin')));

CREATE POLICY "service_role_all_waitlist" ON featured_tour_waitlist
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- featured_tour_stats: public read; agencies read own; service_role write
CREATE POLICY "public_read_stats" ON featured_tour_stats
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "service_role_all_stats" ON featured_tour_stats
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "admin_all_stats" ON featured_tour_stats
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','super_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','super_admin')));

-- Allow authenticated users to increment stats (for client-side tracking)
CREATE POLICY "authenticated_update_stats" ON featured_tour_stats
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- 8. Function to safely increment stats (avoids race conditions)
CREATE OR REPLACE FUNCTION increment_featured_stat(
  p_slot_id uuid,
  p_field   text  -- 'impressions' | 'clicks' | 'bookings_generated'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_field NOT IN ('impressions', 'clicks', 'bookings_generated') THEN
    RAISE EXCEPTION 'Invalid field: %', p_field;
  END IF;

  INSERT INTO featured_tour_stats (slot_id, impressions, clicks, bookings_generated,
    first_impression_at, last_impression_at)
  VALUES (p_slot_id,
    CASE WHEN p_field = 'impressions' THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'clicks'      THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'bookings_generated' THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'impressions' THEN now() ELSE NULL END,
    CASE WHEN p_field = 'impressions' THEN now() ELSE NULL END)
  ON CONFLICT (slot_id) DO UPDATE SET
    impressions = CASE WHEN p_field = 'impressions'
      THEN featured_tour_stats.impressions + 1
      ELSE featured_tour_stats.impressions END,
    clicks = CASE WHEN p_field = 'clicks'
      THEN featured_tour_stats.clicks + 1
      ELSE featured_tour_stats.clicks END,
    bookings_generated = CASE WHEN p_field = 'bookings_generated'
      THEN featured_tour_stats.bookings_generated + 1
      ELSE featured_tour_stats.bookings_generated END,
    first_impression_at = CASE WHEN p_field = 'impressions' AND featured_tour_stats.first_impression_at IS NULL
      THEN now() ELSE featured_tour_stats.first_impression_at END,
    last_impression_at = CASE WHEN p_field = 'impressions'
      THEN now() ELSE featured_tour_stats.last_impression_at END,
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION increment_featured_stat(uuid, text) TO anon, authenticated;

-- 9. Function to activate a featured slot (validates max-50 constraint)
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
  v_active_count int;
  v_plan_duration int;
  v_slot_id uuid;
BEGIN
  -- Check global cap
  SELECT COUNT(*) INTO v_active_count
  FROM featured_tour_slots
  WHERE status = 'active' AND expires_at > now();

  IF v_active_count >= 50 THEN
    RAISE EXCEPTION 'Maximum of 50 active featured slots reached';
  END IF;

  -- Check no active slot for this tour
  IF EXISTS (
    SELECT 1 FROM featured_tour_slots
    WHERE tour_id = p_tour_id AND status = 'active' AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'Tour already has an active featured slot';
  END IF;

  SELECT duration_days INTO v_plan_duration FROM featured_plans WHERE id = p_plan_id;

  INSERT INTO featured_tour_slots (tour_id, agency_id, plan_id, status, starts_at, expires_at)
  VALUES (p_tour_id, p_agency_id, p_plan_id, 'active', now(), now() + (v_plan_duration || ' days')::interval)
  RETURNING id INTO v_slot_id;

  -- Initialize stats row
  INSERT INTO featured_tour_stats (slot_id) VALUES (v_slot_id)
  ON CONFLICT (slot_id) DO NOTHING;

  RETURN v_slot_id;
END;
$$;

GRANT EXECUTE ON FUNCTION activate_featured_slot(uuid, uuid, uuid) TO authenticated;
