-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260829012656
--   name:    C1_nature_stay_schema_settings_helpers.sql
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
-- Migration: C1 — nature_stay schema + settings + helpers
-- Purpose: Create nature_stay schema, singleton settings, trigger helpers
-- Schema: nature_stay (new)
-- Backwards-compatible: YES (new schema, no modifications to existing objects)
-- ToursRed impact: NONE
-- ============================================================================

-- 1. Schema creation
CREATE SCHEMA IF NOT EXISTS nature_stay
;



-- 2. Schema-level hardening
REVOKE ALL ON SCHEMA nature_stay FROM PUBLIC
;


GRANT USAGE ON SCHEMA nature_stay TO anon
;


GRANT USAGE ON SCHEMA nature_stay TO authenticated
;


GRANT USAGE ON SCHEMA nature_stay TO service_role
;



-- 3. Function: nature_stay.update_updated_at()
CREATE OR REPLACE FUNCTION nature_stay.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = nature_stay, pg_temp
AS $$
BEGIN
  NEW.updated_at = now()
;


  RETURN NEW
;


END
;


$$
;



REVOKE EXECUTE ON FUNCTION nature_stay.update_updated_at() FROM PUBLIC
;


GRANT EXECUTE ON FUNCTION nature_stay.update_updated_at() TO authenticated, service_role
;



-- 4. Function: nature_stay.validate_timezone()
CREATE OR REPLACE FUNCTION nature_stay.validate_timezone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_timezone_names
    WHERE name = NEW.timezone
  ) THEN
    RAISE EXCEPTION
      'Invalid timezone "%" for record %. Must be a valid IANA timezone identifier known to PostgreSQL.',
      NEW.timezone, NEW.id
;


  END IF
;



  RETURN NEW
;


END
;


$$
;



REVOKE EXECUTE ON FUNCTION nature_stay.validate_timezone() FROM PUBLIC
;


GRANT EXECUTE ON FUNCTION nature_stay.validate_timezone() TO authenticated, service_role
;



-- 5. Table: nature_stay.settings (singleton)
CREATE TABLE IF NOT EXISTS nature_stay.settings (
  id                              uuid            NOT NULL DEFAULT gen_random_uuid(),
  host_commission_percentage      numeric(5,2)    NOT NULL DEFAULT 15.00,
  guest_service_fee_percentage    numeric(5,2)    NOT NULL DEFAULT 5.00,
  booking_hold_minutes            integer         NOT NULL DEFAULT 15,
  minimum_booking_lead_hours      integer         NOT NULL DEFAULT 24,
  booking_request_expiration_hours integer        NOT NULL DEFAULT 48,
  max_images_per_property         integer         NOT NULL DEFAULT 20,
  max_images_per_unit             integer         NOT NULL DEFAULT 15,
  max_guests_per_booking          integer         NOT NULL DEFAULT 20,
  default_currency                text            NOT NULL DEFAULT 'MXN',
  instant_booking_enabled         boolean         NOT NULL DEFAULT true,
  request_booking_enabled         boolean         NOT NULL DEFAULT true,
  ical_sync_enabled               boolean         NOT NULL DEFAULT false,
  created_at                      timestamptz     NOT NULL DEFAULT now(),
  updated_at                      timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT settings_singleton CHECK (id = '00000000-0000-0000-0000-000000000001'),
  CONSTRAINT settings_commission_range CHECK (host_commission_percentage BETWEEN 0 AND 100),
  CONSTRAINT settings_fee_range CHECK (guest_service_fee_percentage BETWEEN 0 AND 100),
  CONSTRAINT settings_hold_minutes CHECK (booking_hold_minutes > 0),
  CONSTRAINT settings_lead_hours CHECK (minimum_booking_lead_hours >= 0),
  CONSTRAINT settings_expiration_hours CHECK (booking_request_expiration_hours > 0),
  CONSTRAINT settings_max_images_property CHECK (max_images_per_property > 0),
  CONSTRAINT settings_max_images_unit CHECK (max_images_per_unit > 0),
  CONSTRAINT settings_max_guests CHECK (max_guests_per_booking > 0),
  CONSTRAINT settings_currency_format CHECK (default_currency ~ '^[A-Z]{3}$'),

  PRIMARY KEY (id)
)
;



-- 6. Insert singleton row
INSERT INTO nature_stay.settings (id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING
;



-- 7. RLS on settings
ALTER TABLE nature_stay.settings ENABLE ROW LEVEL SECURITY
;



DROP POLICY IF EXISTS "settings_select_authenticated" ON nature_stay.settings
;


CREATE POLICY "settings_select_authenticated"
ON nature_stay.settings FOR SELECT
TO authenticated USING (true)
;



-- 8. Grants on settings
GRANT SELECT ON nature_stay.settings TO authenticated
;


GRANT SELECT, INSERT, UPDATE, DELETE ON nature_stay.settings TO service_role
;



-- 9. Trigger: settings updated_at
DROP TRIGGER IF EXISTS trg_settings_updated_at ON nature_stay.settings
;


CREATE TRIGGER trg_settings_updated_at
  BEFORE UPDATE ON nature_stay.settings
  FOR EACH ROW
  EXECUTE FUNCTION nature_stay.update_updated_at()
;
