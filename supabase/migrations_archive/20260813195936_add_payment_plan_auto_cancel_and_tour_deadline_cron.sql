/*
# Add payment_plan_auto_cancel cancellation type + tour deadline cron job

## Purpose
This migration supports a new business rule: automatically cancel bookings with
incomplete payment plans when the tour departure date is approaching, regardless
of individual installment overdue status.

## Changes

### 1. Add 'payment_plan_auto_cancel' to booking_cancellations constraint
The booking_cancellations.cancellation_policy_type CHECK constraint currently
allows: 100_percent, 50_percent, no_refund, no_show, pending_approval,
admin_cancelled, unpaid_withdrawal. We add 'payment_plan_auto_cancel' for
cancellations triggered by the tour-deadline cron when the payment plan is not
completed 16 days before the tour date.

### 2. Schedule hourly cron job to call the new edge function
Schedules 'process-payment-plan-tour-deadline' to run every hour. It calls the
edge function via net.http_post with the service role key from vault, following
the same pattern as process-incremental-payment-deadlines-hourly.

## Security
- No new tables, no RLS changes.
- The service role key is read at runtime from vault.decrypted_secrets.
- The cron job is idempotent: the edge function checks booking status before
  acting, and process_cancellation_refund uses SELECT FOR UPDATE to prevent
  double-processing.
*/

-- ── 1. Add 'payment_plan_auto_cancel' to constraint ──────────────────────
ALTER TABLE booking_cancellations
  DROP CONSTRAINT IF EXISTS booking_cancellations_cancellation_policy_type_check;

ALTER TABLE booking_cancellations
  ADD CONSTRAINT booking_cancellations_cancellation_policy_type_check
  CHECK (cancellation_policy_type = ANY (ARRAY[
    '100_percent'::text, '50_percent'::text, 'no_refund'::text,
    'no_show'::text, 'pending_approval'::text, 'admin_cancelled'::text,
    'unpaid_withdrawal'::text, 'payment_plan_auto_cancel'::text
  ]));

-- ── 2. Schedule cron job ─────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('process-payment-plan-tour-deadline');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'process-payment-plan-tour-deadline',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://huzsedewwzjywcpbkjkm.supabase.co/functions/v1/process-payment-plan-tour-deadline',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
      ),
      body := '{}'::jsonb
    )
  $$
);
