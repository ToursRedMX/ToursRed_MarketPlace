
-- Add new columns to booking_cancellations table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_cancellations' AND column_name = 'cancelled_by_agency'
  ) THEN
    ALTER TABLE booking_cancellations ADD COLUMN cancelled_by_agency boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_cancellations' AND column_name = 'agency_cancellation_reason'
  ) THEN
    ALTER TABLE booking_cancellations ADD COLUMN agency_cancellation_reason text;
  END IF;
END $$;

-- Add new column to bookings table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'cancelled_by_agency_at'
  ) THEN
    ALTER TABLE bookings ADD COLUMN cancelled_by_agency_at timestamptz;
  END IF;
END $$;

-- Create indexes for filtering and performance
CREATE INDEX IF NOT EXISTS idx_booking_cancellations_cancelled_by_agency
  ON booking_cancellations(cancelled_by_agency) WHERE cancelled_by_agency = true;

CREATE INDEX IF NOT EXISTS idx_bookings_cancelled_by_agency_at
  ON bookings(cancelled_by_agency_at) WHERE cancelled_by_agency_at IS NOT NULL;

-- Update RLS policies to allow agencies to manage their booking cancellations
-- Note: Service role policies already exist for insert, this adds agency-specific access

-- Policy: Agencies can insert cancellations for their tour bookings
CREATE POLICY "Agencies can cancel their tour bookings"
  ON booking_cancellations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings b
      JOIN tours t ON b.tour_id = t.id
      JOIN agencies a ON t.agency_id = a.id
      WHERE b.id = booking_cancellations.booking_id
      AND a.user_id = auth.uid()
    )
  );

-- Comment on new columns
COMMENT ON COLUMN booking_cancellations.cancelled_by_agency IS 'True if booking was cancelled by the agency (not the traveler)';
COMMENT ON COLUMN booking_cancellations.agency_cancellation_reason IS 'Agency explanation for cancelling the booking (min 50 characters)';
COMMENT ON COLUMN bookings.cancelled_by_agency_at IS 'Timestamp when agency cancelled this specific booking';
