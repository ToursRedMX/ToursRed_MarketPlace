/*
# MFA AAL2 Helper Functions and Platform Toggles

## Summary
Adds three reusable SQL helper functions for AAL2 (MFA) enforcement and three toggle columns to platform_settings.
This is the foundation for requiring MFA/TOTP for admin and accountant users before they can write to sensitive tables.

## New Functions

1. `public.is_accountant_user()` -- SECURITY INVOKER, STABLE, LANGUAGE sql
   Returns true if the current authenticated user has role = 'accountant'.
   Follows the exact same pattern as the existing `is_admin_user()` function.
   Used by `requires_aal2_check()` to determine if the accountant toggle applies.

2. `public.has_aal2()` -- SECURITY INVOKER, STABLE, LANGUAGE sql
   Returns true if the current JWT has `aal` = `'aal2'` (user has completed MFA).
   Reads only the JWT, does NOT touch any table -- no recursion risk.
   This replaces repeating `auth.jwt()->>'aal' = 'aal2'` in every policy.

3. `public.requires_aal2_check()` -- SECURITY DEFINER, STABLE, LANGUAGE plpgsql
   Returns true if the current user is an admin/super_admin (and mfa_required_for_admins is true)
   OR an accountant (and mfa_required_for_accountant is true).
   SECURITY DEFINER is mandatory because this function reads platform_settings,
   and platform_settings itself is one of the protected tables -- SECURITY INVOKER would recurse.
   The function is safe: it only reads a boolean toggle, does not expose sensitive data.

## New Columns on platform_settings

- `mfa_required_for_admins` (boolean, default false) -- when true, admin/super_admin users must have AAL2 to write to protected tables
- `mfa_required_for_accountant` (boolean, default false) -- when true, accountant users must have AAL2 to write to protected tables
- `passkeys_enabled` (boolean, default false) -- toggles passkey login/registration UI in the frontend

## Grants
- EXECUTE on all three functions granted to `authenticated` role.

## EMERGENCY RECOVERY (document this -- do NOT remove this comment)

If an admin loses access to their MFA factor and cannot reach AAL2, they CANNOT use the app's
toggle to disable MFA (because writing to platform_settings itself requires AAL2 when the toggle is on).
The ONLY way to recover is directly at the database level, bypassing RLS:

### Option A: Disable the MFA toggles (run via Supabase SQL Editor or MCP -- service_role bypasses RLS)
    UPDATE public.platform_settings
    SET mfa_required_for_admins = false,
        mfa_required_for_accountant = false;

### Option B: Delete the MFA factor for a specific user (run via Supabase SQL Editor)
    -- First find the user's UUID:
    SELECT id, email FROM auth.users WHERE email = 'admin@example.com';
    -- Then delete their MFA factors:
    DELETE FROM auth.mfa_factors WHERE user_id = 'UUID-FROM-ABOVE';

These commands bypass RLS because the service_role is not subject to row-level security.
Keep these commands documented and accessible BEFORE activating the toggles in production.

## Important Notes
1. All three toggles default to FALSE -- no behavior change until explicitly turned on.
2. The functions are idempotent (CREATE OR REPLACE).
3. `requires_aal2_check()` is SECURITY DEFINER to avoid RLS recursion on platform_settings.
4. `has_aal2()` and `is_accountant_user()` are SECURITY INVOKER (same as is_admin_user/is_super_admin).
*/

-- ============================================================================
-- 1. Add toggle columns to platform_settings
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'mfa_required_for_admins'
  ) THEN
    ALTER TABLE public.platform_settings ADD COLUMN mfa_required_for_admins boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'mfa_required_for_accountant'
  ) THEN
    ALTER TABLE public.platform_settings ADD COLUMN mfa_required_for_accountant boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'passkeys_enabled'
  ) THEN
    ALTER TABLE public.platform_settings ADD COLUMN passkeys_enabled boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- ============================================================================
-- 2. Create is_accountant_user() -- follows the exact pattern of is_admin_user()
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_accountant_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
      AND role = 'accountant'
  );
$$;

-- ============================================================================
-- 3. Create has_aal2() -- reads JWT only, no table access, no recursion risk
-- ============================================================================
CREATE OR REPLACE FUNCTION public.has_aal2()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT coalesce(auth.jwt()->>'aal', '') = 'aal2';
$$;

-- ============================================================================
-- 4. Create requires_aal2_check() -- SECURITY DEFINER to avoid recursion on platform_settings
-- ============================================================================
CREATE OR REPLACE FUNCTION public.requires_aal2_check()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_toggle boolean := false;
  v_accountant_toggle boolean := false;
BEGIN
  -- Read the toggles directly (SECURITY DEFINER bypasses RLS, avoiding recursion)
  SELECT
    COALESCE(mfa_required_for_admins, false),
    COALESCE(mfa_required_for_accountant, false)
  INTO v_admin_toggle, v_accountant_toggle
  FROM public.platform_settings
  LIMIT 1;

  -- If neither toggle is on, AAL2 is not required for anyone
  IF NOT v_admin_toggle AND NOT v_accountant_toggle THEN
    RETURN false;
  END IF;

  -- Check if the current user is an admin (includes super_admin) and the admin toggle is on
  IF v_admin_toggle AND public.is_admin_user() THEN
    RETURN true;
  END IF;

  -- Check if the current user is an accountant and the accountant toggle is on
  IF v_accountant_toggle AND public.is_accountant_user() THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- ============================================================================
-- 5. Grant EXECUTE to authenticated role
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.is_accountant_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_aal2() TO authenticated;
GRANT EXECUTE ON FUNCTION public.requires_aal2_check() TO authenticated;