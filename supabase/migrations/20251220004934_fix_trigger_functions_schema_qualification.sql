-- ============================================================================
-- Fix create_commission_record function
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_commission_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_agency_commission_rate numeric;
  v_service_charge_rate numeric;
  v_agency_commission numeric;
  v_service_charge numeric;
  v_platform_revenue numeric;
  v_agency_net_amount numeric;
BEGIN
  -- Solo crear registro si el pago fue exitoso
  IF NEW.payment_status = 'succeeded' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'succeeded') THEN
    
    -- Obtener tasas de comisión de platform_settings
    SELECT 
      COALESCE(agency_commission_percentage, 15),
      COALESCE(service_charge_percentage, 5)
    INTO v_agency_commission_rate, v_service_charge_rate
    FROM public.platform_settings
    LIMIT 1;
    
    -- Calcular comisiones
    v_agency_commission := NEW.total_price * (v_agency_commission_rate / 100);
    v_service_charge := NEW.total_price * (v_service_charge_rate / 100);
    v_platform_revenue := v_agency_commission + v_service_charge;
    v_agency_net_amount := NEW.deposit_amount - v_agency_commission;
    
    -- Insertar registro de comisión
    INSERT INTO public.commission_records (
      booking_id,
      agency_id,
      tour_id,
      total_tour_price,
      agency_commission_amount,
      service_charge_amount,
      platform_total_revenue,
      agency_net_amount,
      status
    ) VALUES (
      NEW.id,
      NEW.agency_id,
      NEW.tour_id,
      NEW.total_price,
      v_agency_commission,
      v_service_charge,
      v_platform_revenue,
      v_agency_net_amount,
      'processed'
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- ============================================================================
-- Fix handle_booking_approval_notification function
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_booking_approval_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  tour_name text;
  agency_name text;
  traveler_id uuid;
  agency_user_id uuid;
BEGIN
  -- Get tour name
  SELECT t.name INTO tour_name
  FROM public.tours t
  WHERE t.id = NEW.tour_id;
  
  -- Get agency name and user_id
  SELECT a.name, a.user_id INTO agency_name, agency_user_id
  FROM public.agencies a
  WHERE a.id = NEW.agency_id;
  
  -- Get traveler id
  SELECT user_id INTO traveler_id
  FROM public.bookings
  WHERE id = NEW.id;

  -- Handle approval status changes
  IF TG_OP = 'INSERT' THEN
    -- New booking with pending approval
    IF NEW.approval_status = 'pending' THEN
      -- Notify agency about pending approval
      PERFORM public.create_user_notification(
        agency_user_id,
        'booking_pending_approval'::public.notification_type,
        'Nueva solicitud de reserva',
        'Tienes una nueva solicitud de reserva para ' || tour_name || ' que requiere tu aprobación.',
        jsonb_build_object(
          'booking_id', NEW.id,
          'tour_id', NEW.tour_id,
          'tour_name', tour_name
        )
      );
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Approval status changed
    IF NEW.approval_status != OLD.approval_status THEN
      IF NEW.approval_status = 'approved' THEN
        -- Notify traveler about approval
        PERFORM public.create_user_notification(
          traveler_id,
          'booking_approved'::public.notification_type,
          'Reserva aprobada',
          'Tu solicitud de reserva para ' || tour_name || ' ha sido aprobada por ' || agency_name || '. Ahora puedes proceder con el pago.',
          jsonb_build_object(
            'booking_id', NEW.id,
            'tour_id', NEW.tour_id,
            'tour_name', tour_name,
            'agency_name', agency_name
          )
        );
      ELSIF NEW.approval_status = 'rejected' THEN
        -- Notify traveler about rejection
        PERFORM public.create_user_notification(
          traveler_id,
          'booking_rejected'::public.notification_type,
          'Reserva rechazada',
          'Lo sentimos, tu solicitud de reserva para ' || tour_name || ' ha sido rechazada por ' || agency_name || '.' || 
          CASE WHEN NEW.approval_notes IS NOT NULL THEN ' Motivo: ' || NEW.approval_notes ELSE '' END,
          jsonb_build_object(
            'booking_id', NEW.id,
            'tour_id', NEW.tour_id,
            'tour_name', tour_name,
            'agency_name', agency_name,
            'notes', NEW.approval_notes
          )
        );
      END IF;
    END IF;
    
    -- Payment status changed to succeeded
    IF NEW.payment_status = 'succeeded' AND OLD.payment_status != 'succeeded' THEN
      -- Notify agency about payment
      PERFORM public.create_user_notification(
        agency_user_id,
        'booking_confirmed'::public.notification_type,
        'Pago recibido para reserva',
        'Se ha recibido el pago para la reserva de ' || tour_name || '. El depósito ha sido procesado correctamente.',
        jsonb_build_object(
          'booking_id', NEW.id,
          'tour_id', NEW.tour_id,
          'tour_name', tour_name,
          'amount', NEW.deposit_amount
        )
      );
      
      -- Notify traveler about payment confirmation
      PERFORM public.create_user_notification(
        traveler_id,
        'booking_confirmed'::public.notification_type,
        'Pago confirmado',
        'Tu pago para ' || tour_name || ' ha sido procesado correctamente. La reserva está confirmada.',
        jsonb_build_object(
          'booking_id', NEW.id,
          'tour_id', NEW.tour_id,
          'tour_name', tour_name,
          'amount', NEW.user_payment
        )
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;
