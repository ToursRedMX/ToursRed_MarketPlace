
-- Create promotion type enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'promotion_type_enum') THEN
    CREATE TYPE promotion_type_enum AS ENUM ('2x1', '3x2', 'grupo_precio_fijo');
  END IF;
END $$;

-- Create tour_promotions table
CREATE TABLE IF NOT EXISTS tour_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id uuid NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  promotion_type promotion_type_enum NOT NULL,
  min_travelers integer NOT NULL DEFAULT 2 CHECK (min_travelers >= 2),
  group_size integer NOT NULL DEFAULT 2 CHECK (group_size >= 2),
  pay_count integer NOT NULL DEFAULT 1 CHECK (pay_count >= 1),
  fixed_group_price numeric(10,2),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz NOT NULL,
  max_uses integer,
  times_used integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  deactivation_reason text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Constraint: only one active promotion per tour at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_tour_promotions_one_active_per_tour
  ON tour_promotions (tour_id)
  WHERE is_active = true;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tour_promotions_tour_id ON tour_promotions(tour_id);
CREATE INDEX IF NOT EXISTS idx_tour_promotions_agency_id ON tour_promotions(agency_id);
CREATE INDEX IF NOT EXISTS idx_tour_promotions_is_active ON tour_promotions(is_active);
CREATE INDEX IF NOT EXISTS idx_tour_promotions_valid_until ON tour_promotions(valid_until);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_tour_promotions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_tour_promotions_updated_at ON tour_promotions;
CREATE TRIGGER trigger_tour_promotions_updated_at
  BEFORE UPDATE ON tour_promotions
  FOR EACH ROW EXECUTE FUNCTION public.update_tour_promotions_updated_at();

-- Enable RLS
ALTER TABLE tour_promotions ENABLE ROW LEVEL SECURITY;

-- Public can read active non-expired promotions (to show badges on tour cards)
CREATE POLICY "Public can view active tour promotions"
  ON tour_promotions FOR SELECT
  TO anon, authenticated
  USING (
    is_active = true
    AND valid_until >= now()
    AND (max_uses IS NULL OR times_used < max_uses)
  );

-- Agencies can view all their own tour promotions (including inactive/expired)
CREATE POLICY "Agencies can view their own tour promotions"
  ON tour_promotions FOR SELECT
  TO authenticated
  USING (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = auth.uid()
    )
  );

-- Agencies can create promotions for their own tours
CREATE POLICY "Agencies can create promotions for their tours"
  ON tour_promotions FOR INSERT
  TO authenticated
  WITH CHECK (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = auth.uid()
    )
  );

-- Agencies can update their own promotions
CREATE POLICY "Agencies can update their own promotions"
  ON tour_promotions FOR UPDATE
  TO authenticated
  USING (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = auth.uid()
    )
  );

-- Agencies can delete their own promotions
CREATE POLICY "Agencies can delete their own promotions"
  ON tour_promotions FOR DELETE
  TO authenticated
  USING (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = auth.uid()
    )
  );

-- Admins can view all promotions
CREATE POLICY "Admins can view all tour promotions"
  ON tour_promotions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND role = 'admin'
    )
  );

-- Admins can update any promotion (for deactivation)
CREATE POLICY "Admins can update any tour promotion"
  ON tour_promotions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND role = 'admin'
    )
  );

-- Add promotion fields to bookings table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'promotion_id'
  ) THEN
    ALTER TABLE bookings ADD COLUMN promotion_id uuid REFERENCES tour_promotions(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'promo_discount_amount'
  ) THEN
    ALTER TABLE bookings ADD COLUMN promo_discount_amount numeric(10,2) DEFAULT 0;
  END IF;
END $$;

-- Index for looking up bookings by promotion
CREATE INDEX IF NOT EXISTS idx_bookings_promotion_id ON bookings(promotion_id);

-- Function to get active promotion for a tour
CREATE OR REPLACE FUNCTION public.get_active_promotion_for_tour(p_tour_id uuid)
RETURNS TABLE (
  id uuid,
  promotion_type text,
  min_travelers integer,
  group_size integer,
  pay_count integer,
  fixed_group_price numeric,
  valid_from timestamptz,
  valid_until timestamptz,
  max_uses integer,
  times_used integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    tp.id,
    tp.promotion_type::text,
    tp.min_travelers,
    tp.group_size,
    tp.pay_count,
    tp.fixed_group_price,
    tp.valid_from,
    tp.valid_until,
    tp.max_uses,
    tp.times_used
  FROM tour_promotions tp
  WHERE tp.tour_id = p_tour_id
    AND tp.is_active = true
    AND tp.valid_from <= now()
    AND tp.valid_until >= now()
    AND (tp.max_uses IS NULL OR tp.times_used < tp.max_uses)
  LIMIT 1;
END;
$$;
