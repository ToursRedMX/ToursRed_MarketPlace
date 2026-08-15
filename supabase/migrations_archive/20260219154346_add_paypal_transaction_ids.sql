
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'paypal_order_id'
  ) THEN
    ALTER TABLE bookings ADD COLUMN paypal_order_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'paypal_transaction_id'
  ) THEN
    ALTER TABLE bookings ADD COLUMN paypal_transaction_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'gift_cards' AND column_name = 'paypal_order_id'
  ) THEN
    ALTER TABLE gift_cards ADD COLUMN paypal_order_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'gift_cards' AND column_name = 'paypal_transaction_id'
  ) THEN
    ALTER TABLE gift_cards ADD COLUMN paypal_transaction_id text;
  END IF;
END $$;
