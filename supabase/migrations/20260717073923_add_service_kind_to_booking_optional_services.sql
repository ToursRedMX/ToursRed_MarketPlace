/*
# Add service_kind and description to booking_optional_services, disable legacy trigger

## Summary
This migration prepares booking_optional_services to handle pickup and language extras
as first-class optional services, each with their own financial bucket (service_charge,
agency_commission, total_paid, membership_exemption_used). It also disables the old
trigger that bulk-marked all optionals as paid when a booking was paid, since the new
model marks each optional individually via its own payment flow.

## Changes

### 1. New columns on booking_optional_services
- `service_kind` (text, NOT NULL, default 'optional_service') — distinguishes traditional
  optional services from pickup ('pickup') and language ('language') extras.
- `description` (text) — human-readable label for the service, used when there is no
  tour_optional_service_id (e.g. pickup zone name, language name).

### 2. Relax tour_optional_service_id constraint
- The column `tour_optional_service_id` was NOT NULL. For pickup and language entries
  there is no corresponding tour_optional_services row, so the constraint is relaxed
  to allow NULL.

### 3. Disable legacy trigger
- Drops trigger `trg_mark_optional_services_paid` and its function
  `mark_optional_services_paid_on_booking_paid`. In the new model, each optional
  service is marked as paid individually by the payment webhook or approve-booking
  edge function, with its own apply_membership_service_fee_exemption call.
  The old trigger would bulk-set all optionals to paid_at + total_paid=subtotal
  in one shot, conflicting with the per-bucket approach.

### 4. Index
- Adds index on service_kind for filtering pickup/language entries efficiently.

## Security
No RLS policy changes — existing policies on booking_optional_services remain in effect.

## Notes
- Legacy columns on bookings (pickup_zone_extra_cost, language_extra_cost, pickup_cost_type)
  are NOT dropped. They remain for historical booking compatibility. New bookings will
  set them to 0/null and store pickup/language data in booking_optional_services instead.
- The service_charge, total_paid, agency_commission, membership_exemption_used,
  payment_method, and paid_at columns already exist (added in migration
  20260717014345). This migration only adds service_kind and description.
*/

-- 1. Add service_kind column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_optional_services' AND column_name = 'service_kind'
  ) THEN
    ALTER TABLE booking_optional_services ADD COLUMN service_kind text NOT NULL DEFAULT 'optional_service';
  END IF;
END $$;

-- 2. Add description column (nullable — traditional optionals join to tour_optional_services for the name)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_optional_services' AND column_name = 'description'
  ) THEN
    ALTER TABLE booking_optional_services ADD COLUMN description text;
  END IF;
END $$;

-- 3. Relax tour_optional_service_id to allow NULL (for pickup/language entries)
DO $$
BEGIN
  -- Drop the existing NOT NULL constraint if present
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_optional_services'
      AND column_name = 'tour_optional_service_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE booking_optional_services ALTER COLUMN tour_optional_service_id DROP NOT NULL;
  END IF;
END $$;

-- 4. Drop the legacy trigger and function
DROP TRIGGER IF EXISTS trg_mark_optional_services_paid ON public.bookings;
DROP FUNCTION IF EXISTS public.mark_optional_services_paid_on_booking_paid();

-- 5. Add index on service_kind
CREATE INDEX IF NOT EXISTS idx_booking_optional_services_service_kind
  ON booking_optional_services(service_kind);

-- 6. Add CHECK constraint for valid service_kind values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_optional_services_service_kind_check'
  ) THEN
    ALTER TABLE booking_optional_services
      ADD CONSTRAINT booking_optional_services_service_kind_check
      CHECK (service_kind IN ('optional_service', 'pickup', 'language'));
  END IF;
END $$;
