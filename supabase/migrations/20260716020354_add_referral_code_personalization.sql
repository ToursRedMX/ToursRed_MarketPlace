/*
# Allow travelers to personalize their referral code (one-time)

## Context
Currently referral codes are auto-generated on signup. Travelers want to
personalize their code for easier sharing. This migration adds:
1. A `code_changed_at` column to track whether the one-time change was used
2. An RPC function `update_referral_code` that validates uniqueness, format,
   and the one-time-change rule before updating

## Changes

### 1. New column on `referral_codes`
- `code_changed_at timestamptz DEFAULT NULL` — NULL means the user has not
  yet personalized their code; a timestamp means they have (no further
  changes allowed).

### 2. RPC function `update_referral_code(p_new_code text)`
- SECURITY DEFINER, search_path = public
- Validates:
  a. Caller is authenticated (auth.uid() not null)
  b. Caller owns the referral_codes row
  c. `code_changed_at` is NULL (one-time change only)
  d. New code is 4-20 chars, alphanumeric + underscores only
  e. New code is not already taken by another user (case-insensitive)
- On success: updates `code`, sets `code_changed_at = now()`, returns the row
- On failure: raises exception with descriptive message

### 3. RLS update
- Add UPDATE policy on `referral_codes` so users can update their own row
  (needed for the RPC to work under SECURITY DEFINER with auth context)

## Security
- The RPC function uses SECURITY DEFINER but checks `auth.uid()` internally
- Existing SELECT/INSERT policies remain unchanged
- New UPDATE policy scoped to owner via `auth.uid() = user_id`
*/
-- 1. Add code_changed_at column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'referral_codes' AND column_name = 'code_changed_at'
  ) THEN
    ALTER TABLE referral_codes ADD COLUMN code_changed_at timestamptz DEFAULT NULL;
  END IF;
END $$;

-- 2. Add UPDATE policy for referral_codes (owner can update own row)
DROP POLICY IF EXISTS "update_own_referral_code" ON referral_codes;
CREATE POLICY "update_own_referral_code"
ON referral_codes FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 3. RPC function to personalize referral code (one-time only)
CREATE OR REPLACE FUNCTION public.update_referral_code(p_new_code text)
RETURNS referral_codes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing referral_codes%ROWTYPE;
  v_code_taken boolean;
  v_clean_code text;
BEGIN
  -- 1. Must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para cambiar tu código';
  END IF;

  -- 2. Load the caller's referral_codes row
  SELECT * INTO v_existing
  FROM public.referral_codes
  WHERE user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró tu código de referido';
  END IF;

  -- 3. Check one-time change rule
  IF v_existing.code_changed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ya has personalizado tu código anteriormente. Solo puedes cambiarlo una vez.';
  END IF;

  -- 4. Validate and normalize the new code
  v_clean_code := trim(lower(p_new_code));

  -- Length: 4-20 characters
  IF length(v_clean_code) < 4 OR length(v_clean_code) > 20 THEN
    RAISE EXCEPTION 'El código debe tener entre 4 y 20 caracteres';
  END IF;

  -- Format: only letters, numbers, and underscores
  IF v_clean_code !~ '^[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'El código solo puede contener letras minúsculas, números y guiones bajos';
  END IF;

  -- 5. Check uniqueness (case-insensitive, exclude own row)
  SELECT EXISTS(
    SELECT 1 FROM public.referral_codes
    WHERE lower(code) = v_clean_code
      AND user_id != auth.uid()
  ) INTO v_code_taken;

  IF v_code_taken THEN
    RAISE EXCEPTION 'Este código ya está en uso. Elige otro diferente.';
  END IF;

  -- 6. Update the code and mark as changed
  UPDATE public.referral_codes
  SET
    code = v_clean_code,
    code_changed_at = now(),
    updated_at = now()
  WHERE user_id = auth.uid()
    AND code_changed_at IS NULL;

  -- 7. Return the updated row
  SELECT * INTO v_existing
  FROM public.referral_codes
  WHERE user_id = auth.uid();

  RETURN v_existing;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.update_referral_code(text) TO authenticated;
