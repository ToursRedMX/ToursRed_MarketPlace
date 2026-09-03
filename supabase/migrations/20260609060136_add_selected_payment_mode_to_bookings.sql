ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS selected_payment_mode TEXT
    CHECK (selected_payment_mode IN ('full', 'plan', 'standard'));