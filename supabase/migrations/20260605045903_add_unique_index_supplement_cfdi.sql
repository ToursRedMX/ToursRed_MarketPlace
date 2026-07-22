
-- Prevent duplicate CFDIs for the same supplement (race condition guard)
CREATE UNIQUE INDEX IF NOT EXISTS idx_cfdi_invoices_supplement_unique
  ON cfdi_invoices (booking_supplement_id)
  WHERE invoice_type = 'supplement' AND status IN ('pending', 'stamped');
