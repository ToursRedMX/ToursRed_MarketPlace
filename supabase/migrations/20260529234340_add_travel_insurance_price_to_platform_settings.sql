
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'travel_insurance_price_per_day_per_traveler'
  ) THEN
    ALTER TABLE platform_settings
      ADD COLUMN travel_insurance_price_per_day_per_traveler decimal(10,2) DEFAULT 79.00;
  END IF;
END $$;
