-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260829012805
--   name:    C3_nature_stay_host_profiles_public_view.sql
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

-- ============================================================================
-- Migration: C3 — nature_stay host model (split: profiles, accounts, private)
-- ============================================================================

-- 1. Table: nature_stay.host_profiles (public-safe)
CREATE TABLE IF NOT EXISTS nature_stay.host_profiles (
  id                    uuid          NOT NULL DEFAULT gen_random_uuid(),
  display_name          text          NOT NULL,
  description           text,
  profile_image_path    text,
  cover_image_path      text,
  country_code          text          NOT NULL DEFAULT 'MX',
  city                  text,
  state                 text,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT host_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT host_profiles_display_name_nonempty CHECK (display_name <> ''),
  CONSTRAINT host_profiles_country_format CHECK (country_code ~ '^[A-Z]{2}$')
)
;



-- 2. Table: nature_stay.host_accounts (ownership + operational state)
CREATE TABLE IF NOT EXISTS nature_stay.host_accounts (
  host_id               uuid          NOT NULL,
  user_id               uuid          NOT NULL,
  host_type             text          NOT NULL DEFAULT 'individual',
  verification_status   text          NOT NULL DEFAULT 'unverified',
  onboarding_status     text          NOT NULL DEFAULT 'draft',
  is_active             boolean       NOT NULL DEFAULT true,
  archived_at           timestamptz,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT host_accounts_pkey PRIMARY KEY (host_id),
  CONSTRAINT host_accounts_user_unique UNIQUE (user_id),
  CONSTRAINT host_accounts_host_type_check CHECK (host_type IN ('individual','company')),
  CONSTRAINT host_accounts_verification_check CHECK (verification_status IN ('unverified','pending','verified','rejected')),
  CONSTRAINT host_accounts_onboarding_check CHECK (onboarding_status IN ('draft','pending_review','active','suspended','rejected','inactive'))
)
;



CREATE INDEX IF NOT EXISTS idx_host_accounts_verification_onboarding
  ON nature_stay.host_accounts (verification_status, onboarding_status)
;



-- 3. Table: nature_stay.host_private_details (fiscal/private data)
CREATE TABLE IF NOT EXISTS nature_stay.host_private_details (
  host_id               uuid                        NOT NULL,
  legal_name            text,
  phone                 text,
  contact_email         text,
  website               text,
  rfc                   text,
  razon_social          text,
  regimen_fiscal        text,
  address               text,
  postal_code           text,
  coordinates           extensions.geography(Point, 4326),
  metadata              jsonb                       NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz                 NOT NULL DEFAULT now(),
  updated_at            timestamptz                 NOT NULL DEFAULT now(),

  CONSTRAINT host_private_details_pkey PRIMARY KEY (host_id)
)
;



CREATE INDEX IF NOT EXISTS idx_host_private_details_coordinates
  ON nature_stay.host_private_details USING GIST (coordinates)
;



-- 4. Foreign keys
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'host_accounts_host_id_fkey'
      AND table_name = 'host_accounts'
      AND table_schema = 'nature_stay'
  ) THEN
    ALTER TABLE nature_stay.host_accounts
      ADD CONSTRAINT host_accounts_host_id_fkey
      FOREIGN KEY (host_id) REFERENCES nature_stay.host_profiles(id) ON DELETE CASCADE
;


  END IF
;



  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'host_accounts_user_id_fkey'
      AND table_name = 'host_accounts'
      AND table_schema = 'nature_stay'
  ) THEN
    ALTER TABLE nature_stay.host_accounts
      ADD CONSTRAINT host_accounts_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT
;


  END IF
;



  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'host_private_details_host_id_fkey'
      AND table_name = 'host_private_details'
      AND table_schema = 'nature_stay'
  ) THEN
    ALTER TABLE nature_stay.host_private_details
      ADD CONSTRAINT host_private_details_host_id_fkey
      FOREIGN KEY (host_id) REFERENCES nature_stay.host_profiles(id) ON DELETE CASCADE
;


  END IF
;


END $$
;



-- 5. RLS on host_profiles
ALTER TABLE nature_stay.host_profiles ENABLE ROW LEVEL SECURITY
;



DROP POLICY IF EXISTS "host_profiles_select_owner" ON nature_stay.host_profiles
;


CREATE POLICY "host_profiles_select_owner"
ON nature_stay.host_profiles FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM nature_stay.host_accounts ha
    WHERE ha.host_id = host_profiles.id
      AND ha.user_id = auth.uid()
  )
)
;



DROP POLICY IF EXISTS "host_profiles_select_super_admin" ON nature_stay.host_profiles
;


CREATE POLICY "host_profiles_select_super_admin"
ON nature_stay.host_profiles FOR SELECT
TO authenticated
USING (public.has_role('super_admin', 'global'))
;



DROP POLICY IF EXISTS "host_profiles_update_owner" ON nature_stay.host_profiles
;


CREATE POLICY "host_profiles_update_owner"
ON nature_stay.host_profiles FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM nature_stay.host_accounts ha
    WHERE ha.host_id = host_profiles.id
      AND ha.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM nature_stay.host_accounts ha
    WHERE ha.host_id = host_profiles.id
      AND ha.user_id = auth.uid()
  )
)
;



-- 6. RLS on host_accounts
ALTER TABLE nature_stay.host_accounts ENABLE ROW LEVEL SECURITY
;



DROP POLICY IF EXISTS "host_accounts_select_owner" ON nature_stay.host_accounts
;


CREATE POLICY "host_accounts_select_owner"
ON nature_stay.host_accounts FOR SELECT
TO authenticated
USING (user_id = auth.uid())
;



DROP POLICY IF EXISTS "host_accounts_select_super_admin" ON nature_stay.host_accounts
;


CREATE POLICY "host_accounts_select_super_admin"
ON nature_stay.host_accounts FOR SELECT
TO authenticated
USING (public.has_role('super_admin', 'global'))
;



-- 7. RLS on host_private_details
ALTER TABLE nature_stay.host_private_details ENABLE ROW LEVEL SECURITY
;



DROP POLICY IF EXISTS "host_private_details_select_owner" ON nature_stay.host_private_details
;


CREATE POLICY "host_private_details_select_owner"
ON nature_stay.host_private_details FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM nature_stay.host_accounts ha
    WHERE ha.host_id = host_private_details.host_id
      AND ha.user_id = auth.uid()
  )
)
;



DROP POLICY IF EXISTS "host_private_details_select_super_admin" ON nature_stay.host_private_details
;


CREATE POLICY "host_private_details_select_super_admin"
ON nature_stay.host_private_details FOR SELECT
TO authenticated
USING (public.has_role('super_admin', 'global'))
;



DROP POLICY IF EXISTS "host_private_details_insert_owner" ON nature_stay.host_private_details
;


CREATE POLICY "host_private_details_insert_owner"
ON nature_stay.host_private_details FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM nature_stay.host_accounts ha
    WHERE ha.host_id = host_private_details.host_id
      AND ha.user_id = auth.uid()
  )
)
;



DROP POLICY IF EXISTS "host_private_details_update_owner" ON nature_stay.host_private_details
;


CREATE POLICY "host_private_details_update_owner"
ON nature_stay.host_private_details FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM nature_stay.host_accounts ha
    WHERE ha.host_id = host_private_details.host_id
      AND ha.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM nature_stay.host_accounts ha
    WHERE ha.host_id = host_private_details.host_id
      AND ha.user_id = auth.uid()
  )
)
;



-- 8. Grants on host_profiles
GRANT SELECT ON nature_stay.host_profiles TO authenticated
;


GRANT UPDATE (
  display_name, description, profile_image_path, cover_image_path,
  country_code, city, state
) ON nature_stay.host_profiles TO authenticated
;


GRANT SELECT, INSERT, UPDATE, DELETE ON nature_stay.host_profiles TO service_role
;



-- 9. Grants on host_accounts
GRANT SELECT ON nature_stay.host_accounts TO authenticated
;


GRANT SELECT, INSERT, UPDATE, DELETE ON nature_stay.host_accounts TO service_role
;



-- 10. Grants on host_private_details
GRANT SELECT, INSERT, UPDATE ON nature_stay.host_private_details TO authenticated
;


GRANT SELECT, INSERT, UPDATE, DELETE ON nature_stay.host_private_details TO service_role
;



-- 11. View: nature_stay.host_public_info (security_barrier)
CREATE OR REPLACE VIEW nature_stay.host_public_info
WITH (security_barrier = true) AS
SELECT
  hp.id,
  hp.display_name,
  hp.description,
  hp.profile_image_path,
  hp.cover_image_path,
  hp.country_code,
  hp.city,
  hp.state,
  hp.created_at
FROM nature_stay.host_profiles hp
WHERE EXISTS (
  SELECT 1 FROM nature_stay.host_accounts ha
  WHERE ha.host_id = hp.id
    AND ha.is_active = true
    AND ha.onboarding_status = 'active'
    AND ha.archived_at IS NULL
)
;



REVOKE ALL ON nature_stay.host_public_info FROM PUBLIC
;


GRANT SELECT ON nature_stay.host_public_info TO anon, authenticated
;



-- 12. View: nature_stay.host_profile_owner_view (security_invoker)
CREATE OR REPLACE VIEW nature_stay.host_profile_owner_view
WITH (security_invoker = true) AS
SELECT
  hp.id,
  hp.display_name,
  hp.description,
  hp.profile_image_path,
  hp.cover_image_path,
  hp.country_code,
  hp.city,
  hp.state,
  hp.created_at,
  hp.updated_at,
  ha.host_type,
  ha.verification_status,
  ha.onboarding_status,
  ha.is_active,
  ha.archived_at,
  hpd.legal_name,
  hpd.phone,
  hpd.contact_email,
  hpd.website,
  hpd.rfc,
  hpd.razon_social,
  hpd.regimen_fiscal,
  hpd.address,
  hpd.postal_code,
  hpd.coordinates,
  hpd.metadata
FROM nature_stay.host_profiles hp
JOIN nature_stay.host_accounts ha ON ha.host_id = hp.id
LEFT JOIN nature_stay.host_private_details hpd ON hpd.host_id = hp.id
WHERE ha.user_id = auth.uid()
;



REVOKE ALL ON nature_stay.host_profile_owner_view FROM PUBLIC
;


GRANT SELECT ON nature_stay.host_profile_owner_view TO authenticated
;



-- 13. Triggers
DROP TRIGGER IF EXISTS trg_host_profiles_updated_at ON nature_stay.host_profiles
;


CREATE TRIGGER trg_host_profiles_updated_at
  BEFORE INSERT OR UPDATE ON nature_stay.host_profiles
  FOR EACH ROW
  EXECUTE FUNCTION nature_stay.update_updated_at()
;



DROP TRIGGER IF EXISTS trg_host_accounts_updated_at ON nature_stay.host_accounts
;


CREATE TRIGGER trg_host_accounts_updated_at
  BEFORE INSERT OR UPDATE ON nature_stay.host_accounts
  FOR EACH ROW
  EXECUTE FUNCTION nature_stay.update_updated_at()
;



DROP TRIGGER IF EXISTS trg_host_private_details_updated_at ON nature_stay.host_private_details
;


CREATE TRIGGER trg_host_private_details_updated_at
  BEFORE INSERT OR UPDATE ON nature_stay.host_private_details
  FOR EACH ROW
  EXECUTE FUNCTION nature_stay.update_updated_at()
;
