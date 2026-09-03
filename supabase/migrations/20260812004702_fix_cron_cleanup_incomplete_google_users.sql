/*
# Fix cron "cleanup-incomplete-google-users"

## Problem
The cron job queried `platform_settings` as if it were a key-value table
(`SELECT value FROM platform_settings WHERE key = 'supabase_url'`), but
`platform_settings` is a single-row table with named columns — not key-value.
This caused every daily run to fail.

## Fix
1. Unschedule the broken job (wrapped in DO/EXCEPTION for idempotency).
2. Reschedule with the project URL hardcoded and the service_role_key read from
   the Supabase Vault secret named 'service_role_key'.
   The service_role_key is used intentionally: the edge function needs it to
   pass JWT verification, and internally uses its own SUPABASE_SERVICE_ROLE_KEY
   for auth.admin calls.

## Security
- No schema changes, no RLS changes.
- The service role key is read at runtime from vault.decrypted_secrets.
*/

DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-incomplete-google-users');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'cleanup-incomplete-google-users',
  '0 3 * * *',
  $$
    SELECT net.http_post(
      url := 'https://huzsedewwzjywcpbkjkm.supabase.co/functions/v1/cleanup-incomplete-google-users',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);
