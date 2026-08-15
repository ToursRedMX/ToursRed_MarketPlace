/*
# Add 'cancellation_processing' status to bookings

## Summary
Adds a new booking status 'cancellation_processing' to the existing CHECK constraint.
This intermediate status is used when an admin cancels a booking with
refund_method = 'original_payment_method': the booking moves to 'cancellation_processing'
while refund lines are processed, and only transitions to 'cancelled' once all
refunds have been initiated successfully.

## Why
Today admin-cancel-booking sets status='cancelled' unconditionally BEFORE the
frontend attempts real refunds via process-payment-refund. If that second step
fails, the traveler is left with a cancelled booking and no refund, with no trace
that money is owed. The new status blocks the booking from looking like a normal
active or fully-cancelled reservation during the refund window.

## Changes
- Modified table: `bookings`
  - Drops existing constraint `bookings_status_check` (IF EXISTS)
  - Recreates it with the same values plus 'cancellation_processing'

## Security
No RLS changes — only a constraint modification.

## Notes
1. The drop uses IF EXISTS so re-running won't fail if already applied.
2. All existing status values are preserved exactly.
3. Code that lists "active" bookings must exclude 'cancellation_processing'.
4. Code that lists "cancelled" bookings should include 'cancellation_processing'.
*/

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status = ANY (ARRAY['draft'::text, 'pending'::text,
  'confirmed'::text, 'cancelled'::text, 'completed'::text,
  'payment_not_received'::text, 'cancellation_processing'::text]));
