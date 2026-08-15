/*
# Fix process_membership_renewal_reminders: read prices from platform_settings

## Problem
The function hardcodes renewal amounts as text literals ('$49 MXN' for monthly,
'$490 MXN' for annual). These are stale prices — the actual configured prices
live in platform_settings.membership_monthly_price ($89.00) and
platform_settings.membership_annual_price ($890.00). The reminder email shows
this amount in a legal notice about the upcoming automatic charge, so it must
match the real price exactly.

## Fix
Replace the hardcoded CASE with a SELECT from platform_settings to read the
real prices at runtime. Format the numeric value as integer (no decimals)
using trim(to_char(...)) to match the previous visual style ("$89 MXN" not
"$89.00 MXN").

Everything else in the function is preserved exactly: same SELECT of
memberships, same loop, same per-record error handling, same
renewal_reminder_sent update, same RAISE NOTICE/WARNING, same JSON return
format, same SECURITY DEFINER, same search_path = public, same Vault
credentials from Migración 6, same cron schedule.

## Security
- No schema changes, no RLS changes.
- Function remains SECURITY DEFINER, search_path = public.
- Grants unchanged: postgres, service_role.
*/

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
  v_monthly_price numeric;
  v_annual_price numeric;
BEGIN
  -- Calculate date range (5 days from now)
  five_days_from_now_start := (current_date + interval '5 days')::timestamptz;
  five_days_from_now_end := (current_date + interval '5 days' + interval '23 hours 59 minutes 59 seconds')::timestamptz;
  
  -- Get Supabase URL and service key from Vault
  supabase_url := 'https://huzsedewwzjywcpbkjkm.supabase.co';
  service_key := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key');
  
  -- Read current membership prices from platform_settings
  SELECT membership_monthly_price, membership_annual_price
  INTO v_monthly_price, v_annual_price
  FROM platform_settings
  LIMIT 1;
  
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
      -- Determine plan amount from configured prices
      plan_amount := CASE 
        WHEN membership_record.plan_type = 'monthly' THEN '$' || trim(to_char(v_monthly_price, '999999')) || ' MXN'
        ELSE '$' || trim(to_char(v_annual_price, '999999')) || ' MXN'
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

-- Re-grant execute permissions
GRANT EXECUTE ON FUNCTION public.process_membership_renewal_reminders() TO postgres, service_role;
