-- This trigger is intentionally non-privileged; pinning the path still avoids
-- resolving names through a caller-controlled search_path.
CREATE OR REPLACE FUNCTION routesred.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = routesred, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
