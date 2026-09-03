
-- Create agency_reviews table (traveler reviews agencies - PUBLIC)
CREATE TABLE IF NOT EXISTS agency_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  traveler_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(booking_id)
);

-- Create traveler_reviews table (agency reviews travelers - PRIVATE)
CREATE TABLE IF NOT EXISTS traveler_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  traveler_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(booking_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_agency_reviews_agency_id ON agency_reviews(agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_reviews_traveler_id ON agency_reviews(traveler_id);
CREATE INDEX IF NOT EXISTS idx_agency_reviews_booking_id ON agency_reviews(booking_id);
CREATE INDEX IF NOT EXISTS idx_traveler_reviews_traveler_id ON traveler_reviews(traveler_id);
CREATE INDEX IF NOT EXISTS idx_traveler_reviews_agency_id ON traveler_reviews(agency_id);
CREATE INDEX IF NOT EXISTS idx_traveler_reviews_booking_id ON traveler_reviews(booking_id);

-- Enable RLS
ALTER TABLE agency_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE traveler_reviews ENABLE ROW LEVEL SECURITY;

-- Agency Reviews Policies (PUBLIC)

-- Anyone can view agency reviews (they are public)
CREATE POLICY "Anyone can view agency reviews"
  ON agency_reviews FOR SELECT
  TO authenticated
  USING (true);

-- Only the traveler who made the booking can create their review
CREATE POLICY "Travelers can create their own agency reviews"
  ON agency_reviews FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = traveler_id AND
    EXISTS (
      SELECT 1 FROM bookings
      WHERE bookings.id = booking_id
      AND bookings.user_id = auth.uid()
      AND bookings.status = 'confirmed'
    )
  );

-- Only the traveler can update their own review
CREATE POLICY "Travelers can update their own agency reviews"
  ON agency_reviews FOR UPDATE
  TO authenticated
  USING (auth.uid() = traveler_id)
  WITH CHECK (auth.uid() = traveler_id);

-- Only the traveler can delete their own review
CREATE POLICY "Travelers can delete their own agency reviews"
  ON agency_reviews FOR DELETE
  TO authenticated
  USING (auth.uid() = traveler_id);

-- Traveler Reviews Policies (PRIVATE)

-- Travelers can view their own reviews
CREATE POLICY "Travelers can view their own reviews"
  ON traveler_reviews FOR SELECT
  TO authenticated
  USING (auth.uid() = traveler_id);

-- Agencies can view reviews of travelers who have bookings with them
CREATE POLICY "Agencies can view reviews of their customers"
  ON traveler_reviews FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.user_id = auth.uid()
      AND agencies.id = traveler_reviews.agency_id
    )
  );

-- Only the agency can create reviews for their travelers
CREATE POLICY "Agencies can create traveler reviews"
  ON traveler_reviews FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies
      JOIN bookings ON bookings.agency_id = agencies.id
      WHERE agencies.user_id = auth.uid()
      AND agencies.id = traveler_reviews.agency_id
      AND bookings.id = traveler_reviews.booking_id
      AND bookings.status = 'confirmed'
    )
  );

-- Only the agency can update their own reviews
CREATE POLICY "Agencies can update their own traveler reviews"
  ON traveler_reviews FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.user_id = auth.uid()
      AND agencies.id = agency_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.user_id = auth.uid()
      AND agencies.id = agency_id
    )
  );

-- Only the agency can delete their own reviews
CREATE POLICY "Agencies can delete their own traveler reviews"
  ON traveler_reviews FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.user_id = auth.uid()
      AND agencies.id = agency_id
    )
  );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS update_agency_reviews_updated_at ON agency_reviews;
CREATE TRIGGER update_agency_reviews_updated_at
  BEFORE UPDATE ON agency_reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_traveler_reviews_updated_at ON traveler_reviews;
CREATE TRIGGER update_traveler_reviews_updated_at
  BEFORE UPDATE ON traveler_reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
