
-- Create booking_cancellations table
CREATE TABLE IF NOT EXISTS booking_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  cancelled_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cancelled_at timestamptz NOT NULL DEFAULT now(),
  tour_start_date date NOT NULL,
  days_before_tour integer NOT NULL,
  cancellation_policy_type text NOT NULL CHECK (cancellation_policy_type IN ('100_percent', '50_percent', 'no_refund', 'no_show', 'pending_approval')),
  original_deposit_amount numeric(10, 2) NOT NULL DEFAULT 0,
  original_service_charge numeric(10, 2) NOT NULL DEFAULT 0,
  refund_amount_to_traveler numeric(10, 2) NOT NULL DEFAULT 0,
  amount_to_agency numeric(10, 2) NOT NULL DEFAULT 0,
  amount_to_platform numeric(10, 2) NOT NULL DEFAULT 0,
  toursred_cash_transaction_id uuid REFERENCES toursred_cash_transactions(id) ON DELETE SET NULL,
  refund_processed boolean NOT NULL DEFAULT false,
  cancellation_reason text,
  emails_sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_booking_cancellations_booking_id ON booking_cancellations(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_cancellations_user_id ON booking_cancellations(cancelled_by_user_id);
CREATE INDEX IF NOT EXISTS idx_booking_cancellations_created_at ON booking_cancellations(created_at DESC);

-- Add new columns to tours table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'cancellation_not_allowed'
  ) THEN
    ALTER TABLE tours ADD COLUMN cancellation_not_allowed boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- Add new columns to bookings table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'cancelled_at'
  ) THEN
    ALTER TABLE bookings ADD COLUMN cancelled_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'cancellation_type'
  ) THEN
    ALTER TABLE bookings ADD COLUMN cancellation_type text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'cancellation_refund_amount'
  ) THEN
    ALTER TABLE bookings ADD COLUMN cancellation_refund_amount numeric(10, 2);
  END IF;
END $$;

-- Enable RLS on booking_cancellations
ALTER TABLE booking_cancellations ENABLE ROW LEVEL SECURITY;

-- Policy: Travelers can view their own cancellations
CREATE POLICY "Travelers can view own cancellations"
  ON booking_cancellations
  FOR SELECT
  TO authenticated
  USING (cancelled_by_user_id = auth.uid());

-- Policy: Agencies can view cancellations for their tours
CREATE POLICY "Agencies can view their tour cancellations"
  ON booking_cancellations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings b
      JOIN tours t ON b.tour_id = t.id
      JOIN agencies a ON t.agency_id = a.id
      WHERE b.id = booking_cancellations.booking_id
      AND a.user_id = auth.uid()
    )
  );

-- Policy: Admins can view all cancellations
CREATE POLICY "Admins can view all cancellations"
  ON booking_cancellations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'super_admin'
    )
  );

-- Policy: Service role can insert cancellations (for backend processing)
CREATE POLICY "Service role can insert cancellations"
  ON booking_cancellations
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_booking_cancellations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS update_booking_cancellations_updated_at_trigger ON booking_cancellations;
CREATE TRIGGER update_booking_cancellations_updated_at_trigger
  BEFORE UPDATE ON booking_cancellations
  FOR EACH ROW
  EXECUTE FUNCTION update_booking_cancellations_updated_at();
