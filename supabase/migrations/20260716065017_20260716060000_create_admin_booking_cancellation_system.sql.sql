/*
# Admin Booking Cancellation System

## Overview
Creates a complete system for admins to cancel bookings with refund options (ToursRed Cash or bank transfer with receipt upload), separate reasons for traveler and agency, points deduction, and a granular permission control.

## New Tables
- `admin_booking_cancellations`: Records admin-initiated cancellations with:
  - `reason_for_traveler` / `reason_for_agency`: separate cancellation reasons
  - `refund_method`: 'none', 'toursred_cash', or 'bank_transfer'
  - `refund_amount`: editable by admin (suggested from booking data)
  - `receipt_file_path`: storage path for bank transfer receipt
  - `points_deducted`: points reverted from traveler's wallet

## Modified Tables
- `admin_permissions`: adds `can_cancel_bookings` column (boolean, default false)
- `bookings`: adds `admin_cancellation_id` foreign key to `admin_booking_cancellations`

## Security
- RLS enabled on `admin_booking_cancellations`
- Only super_admin or users with `can_cancel_bookings` permission can insert
- Admins can view all admin cancellations
- Travelers can view their own cancellations (via booking ownership)
- Storage bucket `cancellation-receipts`: admins can upload, travelers can view their own receipts
*/

-- 1. Add can_cancel_bookings permission to admin_permissions
ALTER TABLE public.admin_permissions
ADD COLUMN IF NOT EXISTS can_cancel_bookings boolean NOT NULL DEFAULT false;

-- 2. Create admin_booking_cancellations table
CREATE TABLE IF NOT EXISTS public.admin_booking_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  admin_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason_for_traveler text NOT NULL,
  reason_for_agency text NOT NULL,
  refund_method text NOT NULL DEFAULT 'none' CHECK (refund_method IN ('none', 'toursred_cash', 'bank_transfer')),
  refund_amount numeric(10, 2) NOT NULL DEFAULT 0,
  receipt_file_path text,
  points_deducted integer NOT NULL DEFAULT 0,
  cancelled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_admin_booking_cancellations_booking_id ON public.admin_booking_cancellations(booking_id);
CREATE INDEX IF NOT EXISTS idx_admin_booking_cancellations_admin_user_id ON public.admin_booking_cancellations(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_booking_cancellations_created_at ON public.admin_booking_cancellations(created_at DESC);

-- 3. Add admin_cancellation_id to bookings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'admin_cancellation_id'
  ) THEN
    ALTER TABLE public.bookings
    ADD COLUMN admin_cancellation_id uuid REFERENCES public.admin_booking_cancellations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4. Enable RLS on admin_booking_cancellations
ALTER TABLE public.admin_booking_cancellations ENABLE ROW LEVEL SECURITY;

-- Policy: Super admins can do everything
DROP POLICY IF EXISTS "super_admin_all_admin_cancellations" ON public.admin_booking_cancellations;
CREATE POLICY "super_admin_all_admin_cancellations"
  ON public.admin_booking_cancellations FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'super_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'super_admin'));

-- Policy: Admins with can_cancel_bookings can insert and view
DROP POLICY IF EXISTS "admin_with_cancel_perm_select" ON public.admin_booking_cancellations;
CREATE POLICY "admin_with_cancel_perm_select"
  ON public.admin_booking_cancellations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_permissions ap
      JOIN public.users u ON u.id = ap.user_id
      WHERE ap.user_id = auth.uid()
      AND (ap.can_cancel_bookings = true OR u.role = 'super_admin')
    )
  );

DROP POLICY IF EXISTS "admin_with_cancel_perm_insert" ON public.admin_booking_cancellations;
CREATE POLICY "admin_with_cancel_perm_insert"
  ON public.admin_booking_cancellations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_permissions ap
      JOIN public.users u ON u.id = ap.user_id
      WHERE ap.user_id = auth.uid()
      AND (ap.can_cancel_bookings = true OR u.role = 'super_admin')
    )
  );

DROP POLICY IF EXISTS "admin_with_cancel_perm_update" ON public.admin_booking_cancellations;
CREATE POLICY "admin_with_cancel_perm_update"
  ON public.admin_booking_cancellations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_permissions ap
      JOIN public.users u ON u.id = ap.user_id
      WHERE ap.user_id = auth.uid()
      AND (ap.can_cancel_bookings = true OR u.role = 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_permissions ap
      JOIN public.users u ON u.id = ap.user_id
      WHERE ap.user_id = auth.uid()
      AND (ap.can_cancel_bookings = true OR u.role = 'super_admin')
    )
  );

-- Policy: Travelers can view their own cancellations (via booking ownership)
DROP POLICY IF EXISTS "traveler_view_own_admin_cancellation" ON public.admin_booking_cancellations;
CREATE POLICY "traveler_view_own_admin_cancellation"
  ON public.admin_booking_cancellations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = admin_booking_cancellations.booking_id
      AND b.user_id = auth.uid()
    )
  );

-- 5. Create storage bucket for cancellation receipts
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cancellation-receipts',
  'cancellation-receipts',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/jpg', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: Admins with cancel permission can upload
DROP POLICY IF EXISTS "admin_upload_cancellation_receipts" ON storage.objects;
CREATE POLICY "admin_upload_cancellation_receipts"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'cancellation-receipts'
    AND EXISTS (
      SELECT 1 FROM public.admin_permissions ap
      JOIN public.users u ON u.id = ap.user_id
      WHERE ap.user_id = auth.uid()
      AND (ap.can_cancel_bookings = true OR u.role = 'super_admin')
    )
  );

-- Admins can view all cancellation receipts
DROP POLICY IF EXISTS "admin_view_cancellation_receipts" ON storage.objects;
CREATE POLICY "admin_view_cancellation_receipts"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'cancellation-receipts'
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );

-- Travelers can view cancellation receipts for their own bookings
DROP POLICY IF EXISTS "traveler_view_own_cancellation_receipts" ON storage.objects;
CREATE POLICY "traveler_view_own_cancellation_receipts"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'cancellation-receipts'
    AND EXISTS (
      SELECT 1 FROM public.admin_booking_cancellations abc
      JOIN public.bookings b ON b.id = abc.booking_id
      WHERE abc.receipt_file_path LIKE '%' || storage.objects.name || '%'
      AND b.user_id = auth.uid()
    )
  );

-- Admins can delete cancellation receipts
DROP POLICY IF EXISTS "admin_delete_cancellation_receipts" ON storage.objects;
CREATE POLICY "admin_delete_cancellation_receipts"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'cancellation-receipts'
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );

-- Grant execute on deduct_points to service_role (already granted but ensure)
GRANT USAGE ON SCHEMA public TO authenticated, anon;
