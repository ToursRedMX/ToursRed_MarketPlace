
-- The handle_booking_paid function was checking payment_status = 'paid'
-- but the stripe-webhook sets payment_status = 'succeeded'.
-- This mismatch caused the executive first_tour_and_booking commission
-- to never fire. Fix: change the condition to 'succeeded'.

CREATE OR REPLACE FUNCTION public.handle_booking_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_agency           agencies%ROWTYPE;
  v_settings         executive_commission_settings%ROWTYPE;
  v_exec             account_executives%ROWTYPE;
  v_already_generated BOOLEAN;
BEGIN
  -- Changed from 'paid' to 'succeeded' to match what the stripe-webhook actually stores
  IF (NEW.payment_status = 'succeeded' AND (OLD.payment_status IS DISTINCT FROM 'succeeded')) THEN

    SELECT * INTO v_agency FROM agencies WHERE id = NEW.agency_id LIMIT 1;

    IF v_agency.first_paid_booking_at IS NULL THEN
      UPDATE agencies SET first_paid_booking_at = now() WHERE id = NEW.agency_id;
      SELECT * INTO v_agency FROM agencies WHERE id = NEW.agency_id LIMIT 1;
    END IF;

    IF v_agency.registered_by_executive = true
      AND v_agency.account_executive_id IS NOT NULL
      AND v_agency.first_tour_published_at IS NOT NULL
    THEN
      SELECT EXISTS (
        SELECT 1 FROM executive_commissions
        WHERE agency_id = NEW.agency_id AND commission_type = 'first_tour_and_booking'
      ) INTO v_already_generated;

      IF NOT v_already_generated THEN
        SELECT * INTO v_settings
        FROM executive_commission_settings
        WHERE is_current = true
        LIMIT 1;

        IF v_settings.id IS NOT NULL THEN
          INSERT INTO executive_commissions (
            executive_id, agency_id, commission_type, amount, status, commission_settings_snapshot
          ) VALUES (
            v_agency.account_executive_id,
            NEW.agency_id,
            'first_tour_and_booking',
            v_settings.amount_per_first_booking,
            'pending',
            jsonb_build_object(
              'amount_per_approval',         v_settings.amount_per_approval,
              'amount_per_first_booking',    v_settings.amount_per_first_booking,
              'platform_revenue_percentage', v_settings.platform_revenue_percentage,
              'commission_period_months',    v_settings.commission_period_months,
              'settings_id',                 v_settings.id
            )
          );

          SELECT * INTO v_exec FROM account_executives WHERE id = v_agency.account_executive_id LIMIT 1;

          IF v_exec.id IS NOT NULL THEN
            PERFORM notify_executive_by_email(jsonb_build_object(
              'type',               'first_booking',
              'executiveEmail',     v_exec.email,
              'executiveFirstName', v_exec.first_name,
              'executiveLastName',  v_exec.last_name,
              'agencyName',         v_agency.name,
              'commissionAmount',   v_settings.amount_per_first_booking
            ));

            INSERT INTO notifications (user_id, type, title, message, data)
            VALUES (
              v_exec.user_id,
              'commission_earned',
              '¡Primera venta de ' || v_agency.name || '!',
              'Ganaste ' || TO_CHAR(v_settings.amount_per_first_booking, 'FM$999,990.00') || ' MXN por la primera reserva pagada de ' || v_agency.name || '.',
              jsonb_build_object(
                'commission_type', 'first_tour_and_booking',
                'agency_id',       v_agency.id,
                'agency_name',     v_agency.name,
                'amount',          v_settings.amount_per_first_booking
              )
            );
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
