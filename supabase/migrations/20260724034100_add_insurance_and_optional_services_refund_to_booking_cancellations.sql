/*
# Add insurance_refund_amount and optional_services_refund_amount to booking_cancellations

1. Modified Tables
- `booking_cancellations`: Added two new columns to enable proper refund breakdown in cancellation emails.
  - `insurance_refund_amount` (numeric, NOT NULL, DEFAULT 0): Portion of the refund that corresponds to travel insurance.
  - `optional_services_refund_amount` (numeric, NOT NULL, DEFAULT 0): Portion of the refund that corresponds to optional services (e.g. extra activities, upgrades).

2. Purpose
Previously, booking_cancellations only stored the total `refund_amount_to_traveler`. The email templates could not show how much of the refund was for insurance vs. optional services vs. principal. These two columns let the email functions display a complete, itemized refund breakdown to travelers, agencies, and admins.

3. Backfill
Existing rows are safe: the DEFAULT 0 applies to all existing records. The values for past cancellations cannot be retroactively calculated with certainty, so they remain 0.

4. Security
No RLS policy changes. Existing policies on booking_cancellations remain unchanged.
*/

ALTER TABLE booking_cancellations
  ADD COLUMN IF NOT EXISTS insurance_refund_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS optional_services_refund_amount numeric NOT NULL DEFAULT 0;
