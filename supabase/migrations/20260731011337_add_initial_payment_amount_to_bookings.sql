-- Add initial_payment_amount column to bookings table
-- This tracks the custom amount the user chose to pay at booking time
-- (when using payment plan mode with a custom initial payment)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS initial_payment_amount numeric;