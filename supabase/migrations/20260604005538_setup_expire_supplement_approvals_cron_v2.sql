
DO $$
BEGIN
  -- Desregistrar si ya existe para evitar duplicados
  PERFORM cron.unschedule('expire-supplement-approvals-hourly')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'expire-supplement-approvals-hourly'
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'expire-supplement-approvals-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT value FROM app_config WHERE key = 'supabase_url') || '/functions/v1/expire-supplement-approvals',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM app_config WHERE key = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
