
-- Drop the old function if exists
DROP FUNCTION IF EXISTS public.trigger_renewal_reminders();

-- Create improved function that processes reminders directly
CREATE OR REPLACE FUNCTION public.process_membership_renewal_reminders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  membership_record record;
  supabase_url text;
  service_key text;
  request_id bigint;
  success_count int := 0;
  error_count int := 0;
  five_days_from_now_start timestamptz;
  five_days_from_now_end timestamptz;
  plan_amount text;
BEGIN
  -- Calculate date range (5 days from now)
  five_days_from_now_start := (current_date + interval '5 days')::timestamptz;
  five_days_from_now_end := (current_date + interval '5 days' + interval '23 hours 59 minutes 59 seconds')::timestamptz;
  
  -- Get Supabase URL from environment
  supabase_url := current_setting('app.settings.supabase_url', true);
  service_key := current_setting('app.settings.service_role_key', true);
  
  -- Log start
  RAISE NOTICE 'Starting renewal reminders check at %', now();
  RAISE NOTICE 'Looking for memberships expiring between % and %', five_days_from_now_start, five_days_from_now_end;
  
  -- Find memberships that need renewal reminders
  FOR membership_record IN
    SELECT 
      m.id,
      m.user_id,
      m.plan_type,
      m.current_period_end,
      u.email,
      u.first_name
    FROM public.memberships m
    INNER JOIN public.users u ON m.user_id = u.id
    WHERE m.status = 'active'
      AND m.renewal_reminder_sent = false
      AND m.current_period_end >= five_days_from_now_start
      AND m.current_period_end <= five_days_from_now_end
  LOOP
    BEGIN
      -- Determine plan amount
      plan_amount := CASE 
        WHEN membership_record.plan_type = 'monthly' THEN '$49 MXN'
        ELSE '$490 MXN'
      END;
      
      -- Make HTTP request to send reminder email
      SELECT INTO request_id net.http_post(
        url := supabase_url || '/functions/v1/send-membership-renewal-reminder',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || service_key
        ),
        body := jsonb_build_object(
          'email', membership_record.email,
          'firstName', COALESCE(membership_record.first_name, 'Viajero'),
          'planType', membership_record.plan_type,
          'renewalDate', membership_record.current_period_end,
          'amount', plan_amount
        ),
        timeout_milliseconds := 30000
      );
      
      -- Update membership to mark reminder as sent
      UPDATE public.memberships
      SET 
        renewal_reminder_sent = true,
        renewal_reminder_sent_at = now()
      WHERE id = membership_record.id;
      
      success_count := success_count + 1;
      
      RAISE NOTICE 'Sent renewal reminder for membership % (user: %)', membership_record.id, membership_record.email;
      
    EXCEPTION
      WHEN OTHERS THEN
        error_count := error_count + 1;
        RAISE WARNING 'Error processing membership %: %', membership_record.id, SQLERRM;
    END;
  END LOOP;
  
  -- Log completion
  RAISE NOTICE 'Renewal reminders completed: % successful, % errors', success_count, error_count;
  
  -- Return summary
  RETURN jsonb_build_object(
    'success', true,
    'processed', success_count + error_count,
    'successful', success_count,
    'failed', error_count,
    'timestamp', now()
  );
END;
$$;

-- Update the cron job to use the new function
SELECT cron.unschedule('send-membership-renewal-reminders') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'send-membership-renewal-reminders'
);

SELECT cron.schedule(
  'send-membership-renewal-reminders',
  '0 15 * * *',
  'SELECT public.process_membership_renewal_reminders();'
);

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.process_membership_renewal_reminders() TO postgres, service_role;
