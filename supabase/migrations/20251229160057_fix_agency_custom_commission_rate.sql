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
    
    -- Obtener tasa de comisión específica de la agencia
    SELECT 
      COALESCE(a.commission_rate * 100, ps.agency_commission_percentage, 15),
      COALESCE(ps.service_charge_percentage, 5)
    INTO v_agency_commission_rate, v_service_charge_rate
    FROM public.agencies a
    CROSS JOIN public.platform_settings ps
    WHERE a.id = NEW.agency_id
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
      agency_commission_rate,
      agency_commission_amount,
      service_charge_rate,
      service_charge_amount,
      platform_total_revenue,
      agency_net_amount,
      status
    ) VALUES (
      NEW.id,
      NEW.agency_id,
      NEW.tour_id,
      NEW.total_price,
      v_agency_commission_rate / 100,
      v_agency_commission,
      v_service_charge_rate / 100,
      v_service_charge,
      v_platform_revenue,
      v_agency_net_amount,
      'processed'
    );
  END IF;
  
  RETURN NEW;
END;
$$;
