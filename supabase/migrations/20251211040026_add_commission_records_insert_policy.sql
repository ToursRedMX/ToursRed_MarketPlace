
-- Make the trigger function SECURITY DEFINER so it can bypass RLS
CREATE OR REPLACE FUNCTION create_commission_record()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  commission_breakdown RECORD;
BEGIN
  -- Solo crear registro si el pago fue exitoso
  IF NEW.payment_status = 'succeeded' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'succeeded') THEN
    
    -- Calcular breakdown de comisiones
    SELECT * INTO commission_breakdown 
    FROM calculate_commission_breakdown(NEW.total_price);
    
    -- Insertar registro de comisión
    INSERT INTO commission_records (
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
      commission_breakdown.agency_commission,
      commission_breakdown.service_charge,
      commission_breakdown.platform_revenue,
      commission_breakdown.agency_net_amount,
      'processed'
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
