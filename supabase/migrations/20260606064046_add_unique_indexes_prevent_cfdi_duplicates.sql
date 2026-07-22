
-- Cancel the duplicate booking CFDI (keep the newer one F-18, cancel F-17)
UPDATE cfdi_invoices
SET status = 'cancelled',
    error_message = 'Duplicado cancelado automaticamente - race condition en generacion'
WHERE id = 'e681b419-b324-4234-963a-0e1c0c0deacf'
  AND invoice_type = 'booking'
  AND status = 'stamped';

-- Add unique indexes to prevent future duplicates

-- Booking type: one active CFDI per booking
CREATE UNIQUE INDEX IF NOT EXISTS uq_cfdi_booking
  ON cfdi_invoices (booking_id)
  WHERE invoice_type = 'booking'
    AND status IN ('pending', 'stamped');

-- Post-booking insurance: one active CFDI per booking
CREATE UNIQUE INDEX IF NOT EXISTS uq_cfdi_post_booking_insurance
  ON cfdi_invoices (booking_id)
  WHERE invoice_type = 'post_booking_insurance'
    AND status IN ('pending', 'stamped');

-- Checkin wallet: one active CFDI per checkin charge
CREATE UNIQUE INDEX IF NOT EXISTS uq_cfdi_checkin_wallet
  ON cfdi_invoices (checkin_charge_id)
  WHERE invoice_type = 'checkin_wallet'
    AND checkin_charge_id IS NOT NULL
    AND status IN ('pending', 'stamped');
