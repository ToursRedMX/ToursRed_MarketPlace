-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260827003538
--   name:    routesred_views_and_storage
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

/*
# RoutesRed — Public Views (security_invoker) + Storage Buckets

Creates two public views with security_invoker = true so they run with the
invoking user's permissions (not the view owner's), ensuring RLS is NOT bypassed.
Also creates storage buckets for public and private content.
*/

-- =============================================================
-- 1. Public view: transport_providers (only active + verified, public columns only)
-- =============================================================
CREATE OR REPLACE VIEW routesred.public_transport_providers
WITH (security_invoker = true) AS
SELECT
  id,
  provider_type,
  first_name,
  last_name,
  legal_name,
  trade_name,
  slug,
  description,
  logo_url,
  cover_image_url,
  phone,
  email,
  website,
  state,
  city,
  country_code,
  status,
  verification_status,
  rating_average,
  rating_count,
  completed_services_count,
  created_at
FROM routesred.transport_providers
WHERE status = 'active' AND verification_status = 'verified' AND active = true;

GRANT SELECT ON routesred.public_transport_providers TO anon, authenticated;

-- =============================================================
-- 2. Public view: vehicles (only from active+verified providers, public columns only)
-- =============================================================
CREATE OR REPLACE VIEW routesred.public_vehicles
WITH (security_invoker = true) AS
SELECT
  v.id,
  v.transport_provider_id,
  v.vehicle_type_id,
  v.internal_name,
  v.brand,
  v.model,
  v.year,
  v.capacity,
  v.luggage_capacity,
  v.description,
  v.primary_image_url,
  v.status,
  tp.slug AS provider_slug,
  tp.trade_name AS provider_name
FROM routesred.vehicles v
JOIN routesred.transport_providers tp ON tp.id = v.transport_provider_id
WHERE tp.status = 'active' AND tp.verification_status = 'verified' AND tp.active = true
  AND v.status = 'active';

GRANT SELECT ON routesred.public_vehicles TO anon, authenticated;

-- =============================================================
-- 3. Storage buckets
-- =============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'routesred-public',
  'routesred-public',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'routesred-private',
  'routesred-private',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================
-- 4. Storage policies: routesred-public
-- Path structure: providers/{provider_id}/...
-- Only provider members (owner/admin/operator_manager) can upload/modify.
-- Public read for anyone (bucket is public).
-- =============================================================

-- Public read
DROP POLICY IF EXISTS "rr_public_read" ON storage.objects;
CREATE POLICY "rr_public_read"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'routesred-public');

-- INSERT: must be member of the provider in the path
DROP POLICY IF EXISTS "rr_public_insert" ON storage.objects;
CREATE POLICY "rr_public_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'routesred-public'
    AND EXISTS (
      SELECT 1 FROM routesred.transport_provider_users tpu
      WHERE tpu.user_id = auth.uid() AND tpu.status = 'active'
      AND tpu.role IN ('owner', 'administrator', 'operator_manager')
      AND (storage.foldername(name))[1] = ('providers/' || tpu.transport_provider_id::text)
    )
  );

-- UPDATE: same membership check
DROP POLICY IF EXISTS "rr_public_update" ON storage.objects;
CREATE POLICY "rr_public_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'routesred-public'
    AND EXISTS (
      SELECT 1 FROM routesred.transport_provider_users tpu
      WHERE tpu.user_id = auth.uid() AND tpu.status = 'active'
      AND tpu.role IN ('owner', 'administrator', 'operator_manager')
      AND (storage.foldername(name))[1] = ('providers/' || tpu.transport_provider_id::text)
    )
  )
  WITH CHECK (
    bucket_id = 'routesred-public'
    AND EXISTS (
      SELECT 1 FROM routesred.transport_provider_users tpu
      WHERE tpu.user_id = auth.uid() AND tpu.status = 'active'
      AND tpu.role IN ('owner', 'administrator', 'operator_manager')
      AND (storage.foldername(name))[1] = ('providers/' || tpu.transport_provider_id::text)
    )
  );

-- DELETE: same membership check
DROP POLICY IF EXISTS "rr_public_delete" ON storage.objects;
CREATE POLICY "rr_public_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'routesred-public'
    AND EXISTS (
      SELECT 1 FROM routesred.transport_provider_users tpu
      WHERE tpu.user_id = auth.uid() AND tpu.status = 'active'
      AND tpu.role IN ('owner', 'administrator', 'operator_manager')
      AND (storage.foldername(name))[1] = ('providers/' || tpu.transport_provider_id::text)
    )
  );

-- =============================================================
-- 5. Storage policies: routesred-private
-- Path structure: providers/{provider_id}/documents/...
-- Only provider members can read/upload. No public access.
-- =============================================================

DROP POLICY IF EXISTS "rr_private_read" ON storage.objects;
CREATE POLICY "rr_private_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'routesred-private'
    AND EXISTS (
      SELECT 1 FROM routesred.transport_provider_users tpu
      WHERE tpu.user_id = auth.uid() AND tpu.status = 'active'
      AND (storage.foldername(name))[1] = ('providers/' || tpu.transport_provider_id::text)
    )
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "rr_private_insert" ON storage.objects;
CREATE POLICY "rr_private_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'routesred-private'
    AND EXISTS (
      SELECT 1 FROM routesred.transport_provider_users tpu
      WHERE tpu.user_id = auth.uid() AND tpu.status = 'active'
      AND (storage.foldername(name))[1] = ('providers/' || tpu.transport_provider_id::text)
    )
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "rr_private_update" ON storage.objects;
CREATE POLICY "rr_private_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'routesred-private'
    AND EXISTS (
      SELECT 1 FROM routesred.transport_provider_users tpu
      WHERE tpu.user_id = auth.uid() AND tpu.status = 'active'
      AND (storage.foldername(name))[1] = ('providers/' || tpu.transport_provider_id::text)
    )
    OR public.is_super_admin()
  )
  WITH CHECK (
    bucket_id = 'routesred-private'
    AND EXISTS (
      SELECT 1 FROM routesred.transport_provider_users tpu
      WHERE tpu.user_id = auth.uid() AND tpu.status = 'active'
      AND (storage.foldername(name))[1] = ('providers/' || tpu.transport_provider_id::text)
    )
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "rr_private_delete" ON storage.objects;
CREATE POLICY "rr_private_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'routesred-private'
    AND EXISTS (
      SELECT 1 FROM routesred.transport_provider_users tpu
      WHERE tpu.user_id = auth.uid() AND tpu.status = 'active'
      AND (storage.foldername(name))[1] = ('providers/' || tpu.transport_provider_id::text)
    )
    OR public.is_super_admin()
  );

;
