
ALTER TABLE cfdi_invoices
  DROP CONSTRAINT cfdi_invoices_invoice_type_check;

ALTER TABLE cfdi_invoices
  ADD CONSTRAINT cfdi_invoices_invoice_type_check
  CHECK (invoice_type = ANY (ARRAY[
    'booking'::text,
    'commission'::text,
    'membership'::text,
    'manual'::text,
    'checkin_wallet'::text,
    'supplement'::text
  ]));
