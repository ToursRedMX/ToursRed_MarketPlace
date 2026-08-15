
-- Allow travelers to view their own supplement CFDIs
DROP POLICY IF EXISTS "Users, agencies and admins can view cfdi invoices" ON cfdi_invoices;

CREATE POLICY "Users, agencies and admins can view cfdi invoices"
ON cfdi_invoices FOR SELECT
USING (
  ((invoice_type = 'booking') AND (EXISTS (
    SELECT 1 FROM bookings
    WHERE bookings.id = cfdi_invoices.booking_id
      AND bookings.user_id = (SELECT auth.uid())
  )))
  OR
  ((invoice_type = 'checkin_wallet') AND (EXISTS (
    SELECT 1 FROM bookings
    WHERE bookings.id = cfdi_invoices.booking_id
      AND bookings.user_id = (SELECT auth.uid())
  )))
  OR
  ((invoice_type = 'supplement') AND (EXISTS (
    SELECT 1 FROM booking_supplements bs
    JOIN bookings b ON b.id = bs.booking_id
    WHERE bs.id = cfdi_invoices.booking_supplement_id
      AND b.user_id = (SELECT auth.uid())
  )))
  OR
  (membership_id IN (
    SELECT id FROM memberships WHERE user_id = (SELECT auth.uid())
  ))
  OR
  (EXISTS (
    SELECT 1 FROM agencies
    WHERE agencies.id = cfdi_invoices.agency_id
      AND agencies.user_id = (SELECT auth.uid())
  ))
  OR
  (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (SELECT auth.uid())
      AND users.role = ANY (ARRAY['admin', 'super_admin'])
  ))
);
