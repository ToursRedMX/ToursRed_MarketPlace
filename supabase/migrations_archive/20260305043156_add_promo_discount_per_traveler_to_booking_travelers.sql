
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_travelers' AND column_name = 'promo_discount_per_traveler'
  ) THEN
    ALTER TABLE booking_travelers ADD COLUMN promo_discount_per_traveler numeric NOT NULL DEFAULT 0;
  END IF;
END $$;
