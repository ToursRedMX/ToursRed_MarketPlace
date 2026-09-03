
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'confirmation_email_sent'
  ) THEN
    ALTER TABLE bookings ADD COLUMN confirmation_email_sent boolean DEFAULT false;
  END IF;
END $$;
