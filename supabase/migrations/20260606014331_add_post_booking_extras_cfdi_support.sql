-- ── 1. Nuevo tipo de invoice ────────────────────────────────────────────────

ALTER TABLE public.cfdi_invoices DROP CONSTRAINT IF EXISTS cfdi_invoices_invoice_type_check;

ALTER TABLE public.cfdi_invoices ADD CONSTRAINT cfdi_invoices_invoice_type_check
  CHECK (invoice_type = ANY (ARRAY[
    'booking'::text,
    'commission'::text,
    'membership'::text,
    'manual'::text,
    'checkin_wallet'::text,
    'supplement'::text,
    'optional_service'::text,
    'post_booking_insurance'::text
  ]));

-- ── 2. Nueva columna booking_optional_service_id ────────────────────────────

ALTER TABLE public.cfdi_invoices
  ADD COLUMN IF NOT EXISTS booking_optional_service_id uuid
    REFERENCES public.booking_optional_services(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cfdi_invoices_booking_optional_service_id
  ON public.cfdi_invoices(booking_optional_service_id)
  WHERE booking_optional_service_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cfdi_optional_service
  ON public.cfdi_invoices(booking_optional_service_id)
  WHERE booking_optional_service_id IS NOT NULL
    AND status IN ('pending', 'stamped');

-- ── 3. RLS: viajero puede insertar en booking_optional_services post-reserva ─

DROP POLICY IF EXISTS "Travelers can insert own booking optional services" ON public.booking_optional_services;

CREATE POLICY "Travelers can insert own booking optional services"
  ON public.booking_optional_services FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = booking_id
        AND b.user_id = (SELECT auth.uid())
        AND b.status NOT IN ('cancelled', 'draft')
    )
  );

-- ── 4. RLS: viajero puede actualizar campos de seguro en su reserva ─────────

DROP POLICY IF EXISTS "Travelers can update insurance on own bookings" ON public.bookings;

CREATE POLICY "Travelers can update insurance on own bookings"
  ON public.bookings FOR UPDATE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND travel_insurance_included = false
    AND status NOT IN ('cancelled', 'draft')
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
  );

-- ── 5. SELECT policy: viajero puede ver cfdi_invoices de sus extras ─────────

DROP POLICY IF EXISTS "Travelers view own optional service cfdi" ON public.cfdi_invoices;

CREATE POLICY "Travelers view own optional service cfdi"
  ON public.cfdi_invoices FOR SELECT
  TO authenticated
  USING (
    invoice_type IN ('optional_service', 'post_booking_insurance')
    AND EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = booking_id
        AND b.user_id = (SELECT auth.uid())
    )
  );
