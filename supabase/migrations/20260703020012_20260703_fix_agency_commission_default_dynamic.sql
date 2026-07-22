
-- ============================================================
-- Fix agency commission_rate: drop hardcoded DEFAULT 0.10
-- and replace with a BEFORE INSERT trigger that reads
-- platform_settings.platform_commission_percentage when
-- commission_rate IS NULL (explicit values are left untouched).
-- ============================================================

-- 1. Drop the hardcoded default and allow NULL temporarily
--    (the trigger will always fill NULL values, so NOT NULL is
--    effectively preserved at the application level)
ALTER TABLE agencies ALTER COLUMN commission_rate DROP DEFAULT;
ALTER TABLE agencies ALTER COLUMN commission_rate DROP NOT NULL;

-- 2. Trigger function: only fills NULL commission_rate
CREATE OR REPLACE FUNCTION set_agency_commission_from_platform()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_platform_pct  numeric;
BEGIN
  -- Only act when caller did not supply an explicit value
  IF NEW.commission_rate IS NULL THEN
    SELECT platform_commission_percentage
      INTO v_platform_pct
      FROM platform_settings
      LIMIT 1;

    -- Fallback to 0.15 (15%) if no row or NULL
    NEW.commission_rate := COALESCE(v_platform_pct, 15) / 100.0;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Attach as BEFORE INSERT trigger
DROP TRIGGER IF EXISTS trg_agency_commission_default ON agencies;
CREATE TRIGGER trg_agency_commission_default
  BEFORE INSERT ON agencies
  FOR EACH ROW EXECUTE FUNCTION set_agency_commission_from_platform();
