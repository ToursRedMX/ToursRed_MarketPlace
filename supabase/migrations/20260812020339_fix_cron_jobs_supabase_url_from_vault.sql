/*
# Fix 3 cron jobs: read supabase_url from Vault instead of hardcoding

## Problem
Three cron jobs hardcode the production project URL
('https://huzsedewwzjywcpbkjkm.supabase.co') in their net.http_post call.
This breaks DRP: if restored to a different Supabase project, they would
keep calling the old project.

## Fix
Replace the hardcoded URL with a runtime read from Vault:
  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')

The Authorization header already reads service_role_key from Vault — that
stays unchanged.

Cron jobs updated:
  1. cleanup-incomplete-google-users         (schedule: 0 3 * * *)
  2. expire-supplement-approvals-hourly      (schedule: 0 * * * *)
  3. process-incremental-payment-deadlines-hourly (schedule: 0 * * * *)

## Security
- No schema changes, no RLS changes.
- Both supabase_url and service_role_key are read at runtime from Vault.
- No hardcoded URLs, project refs, or keys in the migration.
- Schedules, names, and active status preserved.
*/

-- ─────────────────────────────────────────────────────────
-- 1. cleanup-incomplete-google-users
-- ─────────────────────────────────────────────────────────
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
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/cleanup-incomplete-google-users',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);

-- ─────────────────────────────────────────────────────────
-- 2. expire-supplement-approvals-hourly
-- ─────────────────────────────────────────────────────────
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
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/expire-supplement-approvals',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);

-- ─────────────────────────────────────────────────────────
-- 3. process-incremental-payment-deadlines-hourly
-- ─────────────────────────────────────────────────────────
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
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/process-incremental-payment-deadlines',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);
