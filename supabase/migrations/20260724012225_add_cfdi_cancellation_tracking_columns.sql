/*
# CFDI Cancellation Tracking and Replacement Invoice System

## Purpose
This migration adds the infrastructure needed to:
1. Track CFDI cancellations that are in an asynchronous "pending" state with the SAT (Mexican tax authority)
2. Link cancelled CFDIs to the booking cancellation that triggered them
3. Record replacement "commission" CFDIs that ToursRed issues for the service charge it retains after a cancellation
4. Explicitly track how much of the service charge was refunded to the traveler in each cancellation

## Changes

### 1. cfdi_invoices table — new columns
- `cancellation_id` (uuid, nullable, FK to booking_cancellations.id) — links a cancelled CFDI to the booking cancellation that originated it, so the FacturAPI webhook knows which cancellation to process when the SAT confirms
- `replaces_cfdi_invoice_id` (uuid, nullable, FK to cfdi_invoices.id) — links a replacement commission CFDI to the original CFDI it replaces (self-referential FK)
- `cancellation_id` and `replaces_cfdi_invoice_id` indexes for lookup performance

### 2. cfdi_invoices.status constraint — new value
- Added 'cancellation_pending' to the allowed status values
- This status represents a CFDI whose cancellation request was sent to FacturAPI but the SAT has not yet confirmed (async cancellation flow)
- Existing values: pending, stamped, cancelled, error
- New value: cancellation_pending

### 3. cfdi_invoices.invoice_type constraint — new value
- Added 'cancellation_commission' to the allowed invoice types
- This type identifies the replacement CFDI that ToursRed issues for the service charge retained after a booking cancellation
- Existing values: booking, booking_installment, commission, membership, featured_slot, supplement, optional_service, post_booking_insurance, checkin_wallet, manual
- New value: cancellation_commission

### 4. booking_cancellations table — new column
- `service_charge_refunded_amount` (numeric, not null, default 0) — explicitly records how much of the service charge was refunded to the traveler in this cancellation. Each cancellation flow fills this at decision time:
  - Traveler cancels: always 0 (traveler never recovers service charge)
  - Agency cancels: always equals the full original_service_charge (agency always refunds everything)
  - Admin cancels: equals the service charge amount if admin checked the "refund service charge" option, or 0 if not

### 5. cfdi_cancellation_requests.status constraint — new value
- Added 'verifying' to the allowed status values
- This represents a cancellation request that FacturAPI reports as "verifying" (SAT is processing but not yet confirmed)
- Existing values: pending, accepted, rejected
- New value: verifying

### 6. admin_booking_cancellations table — new column
- `service_charge_refunded` (boolean, not null, default false) — records whether the admin chose to also refund the service charge to the traveler
- `service_charge_refunded_amount` (numeric, not null, default 0) — the actual amount of service charge the admin refunded, for audit and CFDI calculation

## Security
- No new tables, no RLS policy changes
- New foreign keys maintain referential integrity for cancellation tracking
*/

-- 1. Add columns to cfdi_invoices
ALTER TABLE cfdi_invoices 
  ADD COLUMN IF NOT EXISTS cancellation_id uuid REFERENCES booking_cancellations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replaces_cfdi_invoice_id uuid REFERENCES cfdi_invoices(id) ON DELETE SET NULL;

-- 2. Add 'cancellation_pending' to cfdi_invoices.status constraint
ALTER TABLE cfdi_invoices DROP CONSTRAINT IF EXISTS cfdi_invoices_status_check;
ALTER TABLE cfdi_invoices ADD CONSTRAINT cfdi_invoices_status_check 
  CHECK (status = ANY (ARRAY['pending'::text, 'stamped'::text, 'cancelled'::text, 'error'::text, 'cancellation_pending'::text]));

-- 3. Add 'cancellation_commission' to cfdi_invoices.invoice_type constraint
ALTER TABLE cfdi_invoices DROP CONSTRAINT IF EXISTS cfdi_invoices_invoice_type_check;
ALTER TABLE cfdi_invoices ADD CONSTRAINT cfdi_invoices_invoice_type_check 
  CHECK (invoice_type = ANY (ARRAY['booking'::text, 'booking_installment'::text, 'commission'::text, 'membership'::text, 'featured_slot'::text, 'supplement'::text, 'optional_service'::text, 'post_booking_insurance'::text, 'checkin_wallet'::text, 'manual'::text, 'cancellation_commission'::text]));

-- 4. Add service_charge_refunded_amount to booking_cancellations
ALTER TABLE booking_cancellations 
  ADD COLUMN IF NOT EXISTS service_charge_refunded_amount numeric NOT NULL DEFAULT 0;

-- 5. Add 'verifying' to cfdi_cancellation_requests.status constraint
ALTER TABLE cfdi_cancellation_requests DROP CONSTRAINT IF EXISTS cfdi_cancellation_requests_status_check;
ALTER TABLE cfdi_cancellation_requests ADD CONSTRAINT cfdi_cancellation_requests_status_check 
  CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'verifying'::text]));

-- 6. Add service charge refund tracking to admin_booking_cancellations
ALTER TABLE admin_booking_cancellations 
  ADD COLUMN IF NOT EXISTS service_charge_refunded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS service_charge_refunded_amount numeric NOT NULL DEFAULT 0;

-- 7. Indexes for lookup performance
CREATE INDEX IF NOT EXISTS idx_cfdi_invoices_cancellation_id ON cfdi_invoices(cancellation_id);
CREATE INDEX IF NOT EXISTS idx_cfdi_invoices_replaces_cfdi_invoice_id ON cfdi_invoices(replaces_cfdi_invoice_id);
CREATE INDEX IF NOT EXISTS idx_cfdi_invoices_status ON cfdi_invoices(status);
