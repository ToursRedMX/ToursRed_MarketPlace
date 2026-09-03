
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'gift_cards' AND column_name = 'payment_status'
  ) THEN
    ALTER TABLE gift_cards ADD COLUMN payment_status text NOT NULL DEFAULT 'paid';
  END IF;
END $$;
