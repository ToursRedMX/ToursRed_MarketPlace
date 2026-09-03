-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260827220657
--   name:    009_ecosystem_schema.sql
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
-- Migration: 009_ecosystem_schema
-- Purpose: Create ecosystem schema for cross-platform shared functionality
-- Schema: ecosystem (new)
-- Backwards-compatible: YES (new schema, no modifications to existing objects)
-- ToursRed impact: NONE
-- ============================================================================
--
-- The ecosystem schema holds new cross-platform features shared across
-- verticals (ToursRed, Nature Stay, RoutesRed). No existing tables are
-- moved or modified.
--
-- Objects created:
--   - Schema: ecosystem
--   - Function: ecosystem.update_updated_at() — trigger helper for updated_at
--   - Function: ecosystem.validate_trip_timezone() — trigger helper for
--     timezone validation against pg_timezone_names
--
-- Hardening:
--   REVOKE ALL ON SCHEMA ecosystem FROM PUBLIC
--   GRANT USAGE ON SCHEMA ecosystem TO authenticated
--   GRANT USAGE ON SCHEMA ecosystem TO service_role
--
-- No access for anon. service_role gets explicit USAGE (not assumed).
-- Table-level grants for service_role are in migrations 010-012.
--
-- Function EXECUTE privileges:
--   REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA ecosystem FROM PUBLIC
--   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ecosystem TO authenticated, service_role
--
-- This prevents functions from becoming public RPC endpoints via PostgREST.
-- Triggers invoke functions with INVOKER privileges
;

since triggers fire on
-- tables where authenticated/service_role already have access, EXECUTE is
-- available to them. anon has no EXECUTE and no USAGE on the schema.
--
-- Operational requirement (not executed in this migration):
--   For a frontend to use supabase.schema('ecosystem'), the schema must be
--   added to Exposed schemas in Supabase Data API settings. Before doing so,
--   verify: all exposed tables have RLS, anon has no permissions,
--   authenticated has only the approved grants. The three tables in this
--   block (trips, trip_items, trip_toursred_bookings) meet that intent.
-- ============================================================================

-- ============================================================================
-- 1. Schema creation
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS ecosystem
;



-- ============================================================================
-- 2. Schema-level hardening
-- ============================================================================
REVOKE ALL ON SCHEMA ecosystem FROM PUBLIC
;


GRANT USAGE ON SCHEMA ecosystem TO authenticated
;


GRANT USAGE ON SCHEMA ecosystem TO service_role
;



-- ============================================================================
-- 3. Function: ecosystem.update_updated_at()
-- Purpose: Trigger helper that sets NEW.updated_at = now()
-- Security: SECURITY INVOKER, search_path = ecosystem, pg_temp
-- Reuses the same pattern as Block A's public.update_user_roles_updated_at()
-- ============================================================================

CREATE OR REPLACE FUNCTION ecosystem.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ecosystem, pg_temp
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



-- Revoke default PUBLIC EXECUTE and grant only to needed roles
REVOKE EXECUTE ON FUNCTION ecosystem.update_updated_at() FROM PUBLIC
;


GRANT EXECUTE ON FUNCTION ecosystem.update_updated_at() TO authenticated, service_role
;



-- ============================================================================
-- 4. Function: ecosystem.validate_trip_timezone()
-- Purpose: Trigger helper that validates NEW.timezone against pg_timezone_names
-- Security: SECURITY INVOKER, search_path = pg_catalog, pg_temp
-- No SQL dynamic. No SECURITY DEFINER.
--
-- This function is intended to be used in a BEFORE INSERT OR UPDATE OF timezone
-- trigger on ecosystem.trips. It queries pg_catalog.pg_timezone_names to
-- verify the timezone string is a valid IANA identifier known to PostgreSQL.
--
-- If the timezone does not exist, it raises an exception.
-- ============================================================================

CREATE OR REPLACE FUNCTION ecosystem.validate_trip_timezone()
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
      'Invalid timezone "%" for trip %. Must be a valid IANA timezone identifier known to PostgreSQL.',
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



-- Revoke default PUBLIC EXECUTE and grant only to needed roles
REVOKE EXECUTE ON FUNCTION ecosystem.validate_trip_timezone() FROM PUBLIC
;


GRANT EXECUTE ON FUNCTION ecosystem.validate_trip_timezone() TO authenticated, service_role
;
