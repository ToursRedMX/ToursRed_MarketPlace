-- Fix trigger that read non-existent column platform_commission_percentage.
-- The correct column in platform_settings is agency_commission_percentage.
CREATE OR REPLACE FUNCTION set_agency_commission_from_platform()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_platform_pct numeric;
BEGIN
  IF NEW.commission_rate IS NULL THEN
    SELECT agency_commission_percentage
      INTO v_platform_pct
      FROM platform_settings
      LIMIT 1;

    NEW.commission_rate := COALESCE(v_platform_pct, 15) / 100.0;
  END IF;

  RETURN NEW;
END;
$$;
