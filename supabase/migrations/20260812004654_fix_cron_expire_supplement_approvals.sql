/*
# Fix cron "expire-supplement-approvals-hourly"

## Problem
The cron job referenced a non-existent `app_config` table to fetch the Supabase URL
and service role key, causing every hourly run to fail with a relation-not-found error.

## Fix
1. Unschedule the broken job (wrapped in DO/EXCEPTION for idempotency).
2. Reschedule with the project URL hardcoded and the service_role_key read from
   the Supabase Vault secret named 'service_role_key'.

## Security
- No schema changes, no RLS changes.
- The service role key is read at runtime from vault.decrypted_secrets — never
  hardcoded in the migration.
*/

DO $$
BEGIN
  PERFORM cron.unschedule('expire-supplement-approvals-hourly');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'expire-supplement-approvals-hourly',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://huzsedewwzjywcpbkjkm.supabase.co/functions/v1/expire-supplement-approvals',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);
