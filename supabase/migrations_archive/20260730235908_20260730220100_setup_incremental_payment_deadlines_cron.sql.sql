/*
# Set up hourly cron for process-incremental-payment-deadlines
# Same pattern as expire-supplement-approvals cron
*/

-- Grant pg_cron access to schedule the edge function call
SELECT cron.schedule(
  'process-incremental-payment-deadlines-hourly',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/process-incremental-payment-deadlines',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);
