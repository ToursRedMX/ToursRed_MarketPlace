/*
# Fix cron "process-incremental-payment-deadlines-hourly"

## Problem
The cron job used `current_setting('app.supabase_url')` and
`current_setting('app.service_role_key')` to build the edge function URL and
Authorization header. These custom GUC settings were never configured in the
database, so every hourly run failed.

## Fix
1. Unschedule the broken job (wrapped in DO/EXCEPTION for idempotency).
2. Reschedule with the project URL hardcoded and the service_role_key read from
   the Supabase Vault secret named 'service_role_key'.

## Security
- No schema changes, no RLS changes.
- The service role key is read at runtime from vault.decrypted_secrets.
*/

DO $$
BEGIN
  PERFORM cron.unschedule('process-incremental-payment-deadlines-hourly');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'process-incremental-payment-deadlines-hourly',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://huzsedewwzjywcpbkjkm.supabase.co/functions/v1/process-incremental-payment-deadlines',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);
