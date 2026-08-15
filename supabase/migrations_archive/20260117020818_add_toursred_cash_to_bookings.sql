
-- Add toursred_cash_used column to bookings table
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'bookings'
    AND column_name = 'toursred_cash_used'
  ) THEN
    ALTER TABLE public.bookings 
    ADD COLUMN toursred_cash_used decimal(10,2) NOT NULL DEFAULT 0.00 CHECK (toursred_cash_used >= 0);
  END IF;
END $$;
