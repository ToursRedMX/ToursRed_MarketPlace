-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260827195915
--   name:    002_backfill_user_roles.sql
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
-- Migration: 002_backfill_user_roles
-- Purpose: Backfill user_roles from legacy public.users.role
-- Schema: public
-- Backwards-compatible: YES (only INSERTs into user_roles, no changes to users)
-- ToursRed impact: NONE (users.role is not modified)
-- ============================================================================
--
-- Copies the current role state from public.users.role into public.user_roles.
--
-- Backfill rules:
--   traveler          -> role=traveler,        platform=toursred,  is_active=true
--   agency            -> role=agency,          platform=toursred,  is_active=true
--   account_executive -> role=account_executive, platform=toursred, is_active=true
--   admin (super=false) -> role=admin,         platform=toursred,  is_active=true
--   admin (super=true)  -> role=admin,         platform=toursred,  is_active=true
--                         + role=super_admin,  platform=global,    is_active=true
--
-- Idempotency:
--   Uses WHERE NOT EXISTS checking for ANY historical record with the same
--   (user_id, role, platform), regardless of is_active. This prevents
--   re-creating a role that was previously migrated and then revoked.
--
-- Rollback:
--   DELETE FROM public.user_roles WHERE metadata->>'migration' = 'shared_foundation_002'
;


--
-- No triggers or sync mechanisms are created. users.role remains the
-- authorization source for ToursRed.
-- ============================================================================

INSERT INTO public.user_roles (user_id, role, platform, is_active, granted_at, metadata)
SELECT
  u.id,
  'traveler',
  'toursred',
  true,
  now(),
  jsonb_build_object(
    'source', 'legacy_users_role_backfill',
    'migration', 'shared_foundation_002'
  )
FROM public.users u
WHERE u.role = 'traveler'
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = u.id
      AND ur.role = 'traveler'
      AND ur.platform = 'toursred'
  )
;



INSERT INTO public.user_roles (user_id, role, platform, is_active, granted_at, metadata)
SELECT
  u.id,
  'agency',
  'toursred',
  true,
  now(),
  jsonb_build_object(
    'source', 'legacy_users_role_backfill',
    'migration', 'shared_foundation_002'
  )
FROM public.users u
WHERE u.role = 'agency'
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = u.id
      AND ur.role = 'agency'
      AND ur.platform = 'toursred'
  )
;



INSERT INTO public.user_roles (user_id, role, platform, is_active, granted_at, metadata)
SELECT
  u.id,
  'account_executive',
  'toursred',
  true,
  now(),
  jsonb_build_object(
    'source', 'legacy_users_role_backfill',
    'migration', 'shared_foundation_002'
  )
FROM public.users u
WHERE u.role = 'account_executive'
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = u.id
      AND ur.role = 'account_executive'
      AND ur.platform = 'toursred'
  )
;



-- Admins without super_admin flag: admin/toursred
INSERT INTO public.user_roles (user_id, role, platform, is_active, granted_at, metadata)
SELECT
  u.id,
  'admin',
  'toursred',
  true,
  now(),
  jsonb_build_object(
    'source', 'legacy_users_role_backfill',
    'migration', 'shared_foundation_002'
  )
FROM public.users u
WHERE u.role = 'admin'
  AND u.is_super_admin = false
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = u.id
      AND ur.role = 'admin'
      AND ur.platform = 'toursred'
  )
;



-- Admins WITH super_admin flag: admin/toursred + super_admin/global
INSERT INTO public.user_roles (user_id, role, platform, is_active, granted_at, metadata)
SELECT
  u.id,
  'admin',
  'toursred',
  true,
  now(),
  jsonb_build_object(
    'source', 'legacy_users_role_backfill',
    'migration', 'shared_foundation_002'
  )
FROM public.users u
WHERE u.role = 'admin'
  AND u.is_super_admin = true
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = u.id
      AND ur.role = 'admin'
      AND ur.platform = 'toursred'
  )
;



INSERT INTO public.user_roles (user_id, role, platform, is_active, granted_at, metadata)
SELECT
  u.id,
  'super_admin',
  'global',
  true,
  now(),
  jsonb_build_object(
    'source', 'legacy_users_role_backfill',
    'migration', 'shared_foundation_002'
  )
FROM public.users u
WHERE u.role = 'admin'
  AND u.is_super_admin = true
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = u.id
      AND ur.role = 'super_admin'
      AND ur.platform = 'global'
  )
;



;
