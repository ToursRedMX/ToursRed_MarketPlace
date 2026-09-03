-- ─────────────────────────────────────────────────────────────────────────────
-- Agregar tipo de notificación para comisiones
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'commission_earned'
      AND enumtypid = 'notification_type'::regtype
  ) THEN
    ALTER TYPE notification_type ADD VALUE 'commission_earned';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER: notify_executive_by_email
-- Llama a send-executive-notification via pg_net de forma asíncrona
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION notify_executive_by_email(p_payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supabase_url TEXT;
  v_anon_key TEXT;
  v_edge_url TEXT;
BEGIN
  -- Obtener URL y anon key desde email_settings
  SELECT
    COALESCE(supabase_project_url, ''),
    COALESCE(supabase_anon_key, '')
  INTO v_supabase_url, v_anon_key
  FROM email_settings
  LIMIT 1;

  IF v_supabase_url = '' THEN
    RAISE WARNING 'notify_executive_by_email: supabase_project_url no configurado en email_settings';
    RETURN;
  END IF;

  v_edge_url := v_supabase_url || '/functions/v1/send-executive-notification';

  PERFORM net.http_post(
    url     := v_edge_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key
    ),
    body    := p_payload
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_executive_by_email error: %', SQLERRM;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: handle_agency_approved (reemplaza el anterior)
-- Genera comisión approval + email + notificación en app
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_agency_approved()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings executive_commission_settings%ROWTYPE;
  v_exec     account_executives%ROWTYPE;
BEGIN
  IF (NEW.is_approved = true AND (OLD.is_approved IS DISTINCT FROM true)) THEN
    IF NEW.registered_by_executive = true AND NEW.account_executive_id IS NOT NULL THEN

      IF NEW.approval_period_start IS NULL THEN
        NEW.approval_period_start := now();
      END IF;

      SELECT * INTO v_settings
      FROM executive_commission_settings
      WHERE is_current = true
      LIMIT 1;

      IF v_settings.id IS NOT NULL THEN
        INSERT INTO executive_commissions (
          executive_id, agency_id, commission_type, amount, status, commission_settings_snapshot
        ) VALUES (
          NEW.account_executive_id,
          NEW.id,
          'approval',
          v_settings.amount_per_approval,
          'pending',
          jsonb_build_object(
            'amount_per_approval',          v_settings.amount_per_approval,
            'amount_per_first_booking',     v_settings.amount_per_first_booking,
            'platform_revenue_percentage',  v_settings.platform_revenue_percentage,
            'commission_period_months',     v_settings.commission_period_months,
            'settings_id',                  v_settings.id
          )
        );

        -- Cargar datos del ejecutivo
        SELECT * INTO v_exec FROM account_executives WHERE id = NEW.account_executive_id LIMIT 1;

        IF v_exec.id IS NOT NULL THEN
          -- Email asíncrono via pg_net
          PERFORM notify_executive_by_email(jsonb_build_object(
            'type',               'agency_approved',
            'executiveEmail',     v_exec.email,
            'executiveFirstName', v_exec.first_name,
            'executiveLastName',  v_exec.last_name,
            'agencyName',         NEW.name,
            'commissionAmount',   v_settings.amount_per_approval
          ));

          -- Notificación en app
          INSERT INTO notifications (user_id, type, title, message, data)
          VALUES (
            v_exec.user_id,
            'commission_earned',
            '¡Comisión de aprobación generada!',
            'Ganaste ' || TO_CHAR(v_settings.amount_per_approval, 'FM$999,990.00') || ' MXN por aprobar a ' || NEW.name || '.',
            jsonb_build_object(
              'commission_type', 'approval',
              'agency_id',       NEW.id,
              'agency_name',     NEW.name,
              'amount',          v_settings.amount_per_approval
            )
          );
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agency_approved ON agencies;
CREATE TRIGGER trg_agency_approved
  BEFORE UPDATE ON agencies
  FOR EACH ROW
  EXECUTE FUNCTION handle_agency_approved();

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: handle_tour_published (reemplaza el anterior)
-- Actualiza first_tour_published_at + email + notificación en app
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_tour_published()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agency agencies%ROWTYPE;
  v_exec   account_executives%ROWTYPE;
  v_was_null BOOLEAN := false;
BEGIN
  SELECT * INTO v_agency FROM agencies WHERE id = NEW.agency_id LIMIT 1;

  IF v_agency.first_tour_published_at IS NULL THEN
    v_was_null := true;
    UPDATE agencies
    SET first_tour_published_at = now()
    WHERE id = NEW.agency_id;
  END IF;

  -- Solo notificar la primera vez y si la agencia tiene ejecutivo asignado
  IF v_was_null AND v_agency.registered_by_executive = true AND v_agency.account_executive_id IS NOT NULL THEN
    SELECT * INTO v_exec FROM account_executives WHERE id = v_agency.account_executive_id LIMIT 1;

    IF v_exec.id IS NOT NULL THEN
      PERFORM notify_executive_by_email(jsonb_build_object(
        'type',               'first_tour_published',
        'executiveEmail',     v_exec.email,
        'executiveFirstName', v_exec.first_name,
        'executiveLastName',  v_exec.last_name,
        'agencyName',         v_agency.name
      ));

      INSERT INTO notifications (user_id, type, title, message, data)
      VALUES (
        v_exec.user_id,
        'commission_earned',
        v_agency.name || ' publicó su primer tour',
        'La agencia ' || v_agency.name || ' acaba de publicar su primer tour en el catálogo de ToursRed.',
        jsonb_build_object(
          'event',       'first_tour_published',
          'agency_id',   v_agency.id,
          'agency_name', v_agency.name
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tour_published ON tours;
CREATE TRIGGER trg_tour_published
  AFTER INSERT ON tours
  FOR EACH ROW
  EXECUTE FUNCTION handle_tour_published();

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: handle_booking_paid (reemplaza el anterior)
-- Genera comisión first_tour_and_booking + email + notificación en app
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_booking_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agency           agencies%ROWTYPE;
  v_settings         executive_commission_settings%ROWTYPE;
  v_exec             account_executives%ROWTYPE;
  v_already_generated BOOLEAN;
BEGIN
  IF (NEW.payment_status = 'paid' AND (OLD.payment_status IS DISTINCT FROM 'paid')) THEN

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
$$;

DROP TRIGGER IF EXISTS trg_booking_paid ON bookings;
CREATE TRIGGER trg_booking_paid
  AFTER UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION handle_booking_paid();
