
-- Habilitar la extensión pg_cron si no está habilitada
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Programar la tarea para ejecutarse cada día a las 00:00 UTC
DO $$
BEGIN
  -- Intentar programar el job
  PERFORM cron.schedule(
    'reset-monthly-membership-exemptions',
    '0 0 * * *',
    'SELECT reset_monthly_service_fee_exemption()'
  );
  RAISE NOTICE 'Successfully scheduled daily reset of membership exemptions';
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'Cron job already exists, skipping creation';
  WHEN undefined_table THEN
    RAISE NOTICE 'pg_cron extension is not available. The reset function will be called manually from the application.';
  WHEN undefined_function THEN
    RAISE NOTICE 'cron.schedule is not available. The reset function will be called manually from the application.';
END
$$;
