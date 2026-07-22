-- Add 'booking_installment' to cfdi_invoices invoice_type check constraint
ALTER TABLE public.cfdi_invoices DROP CONSTRAINT IF EXISTS cfdi_invoices_invoice_type_check;
ALTER TABLE public.cfdi_invoices ADD CONSTRAINT cfdi_invoices_invoice_type_check
  CHECK (invoice_type = ANY (ARRAY['booking', 'booking_installment', 'commission', 'membership', 'featured_slot', 'supplement', 'optional_service', 'post_booking_insurance', 'checkin_wallet', 'manual']));
