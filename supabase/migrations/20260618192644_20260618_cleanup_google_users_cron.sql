-- Schedule daily cleanup of incomplete Google OAuth onboarding users
SELECT cron.schedule(
  'cleanup-incomplete-google-users',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT value FROM public.platform_settings WHERE key = 'supabase_url' LIMIT 1) || '/functions/v1/cleanup-incomplete-google-users',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public.platform_settings WHERE key = 'supabase_anon_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
