-- Update all functions in the public schema to have immutable search paths
DO $$
DECLARE
  func_record RECORD;
BEGIN
  FOR func_record IN 
    SELECT 
      p.oid,
      p.proname,
      pg_get_function_identity_arguments(p.oid) as args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.prokind = 'f'  -- Only functions, not procedures or aggregates
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION %s SET search_path = ''''', func_record.oid::regprocedure);
      RAISE NOTICE 'Updated search_path for function: %', func_record.oid::regprocedure;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to update function %: %', func_record.oid::regprocedure, SQLERRM;
    END;
  END LOOP;
END $$;
