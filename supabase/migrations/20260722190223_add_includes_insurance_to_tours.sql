/*
# Add includes_insurance column to tours

1. Purpose
   Some tours (e.g. extreme adventure tours) already include travel insurance
   contracted by the agency as part of the package cost. In those cases, the
   platform should NOT offer the traveler the option to purchase the platform's
   additional travel insurance — neither at booking time nor as a post-booking extra.

2. Changes
   - Add boolean column `includes_insurance` to `tours` table, defaulting to `false`.
     When `true`, the platform's travel insurance offer is hidden from travelers
     for that tour (both in BookingForm and in the TravelerBookings extras modal).

3. Security
   - No new tables or RLS policies needed. The new column is managed by the
     agency through the existing tour CRUD policies already in place.
*/

ALTER TABLE tours
  ADD COLUMN IF NOT EXISTS includes_insurance boolean NOT NULL DEFAULT false;
