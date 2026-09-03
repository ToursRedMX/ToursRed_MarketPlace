-- 1. Agregar columna travel_insurance_amount a commission_records
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'commission_records' AND column_name = 'travel_insurance_amount'
  ) THEN
    ALTER TABLE commission_records
      ADD COLUMN travel_insurance_amount decimal(10,2) NOT NULL DEFAULT 0
      CHECK (travel_insurance_amount >= 0);
  END IF;
END $$;

-- 2. Insertar cuenta 405 en el catalogo contable (si no existe)
INSERT INTO chart_of_accounts (code, sat_group_code, name, account_type, nature, level, parent_code, is_system, is_active, description)
VALUES (
  '405',
  '405-01',
  'Ingresos por Seguros de Viaje',
  'ingreso',
  'acreedora',
  3,
  '40',
  false,
  true,
  'Primas de seguros de viaje facturadas al viajero por intermediacion con aseguradora (Assist Card / Universal Assistance). Ingreso propio de ToursRed como intermediario.'
)
ON CONFLICT (code) DO NOTHING;

-- 3. Actualizar el trigger create_commission_record para incluir travel_insurance_amount
CREATE OR REPLACE FUNCTION create_commission_record()
RETURNS TRIGGER AS $$
DECLARE
  commission_breakdown RECORD;
BEGIN
  -- Solo crear registro si el pago fue exitoso
  IF NEW.payment_status = 'succeeded' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'succeeded') THEN

    -- Calcular breakdown de comisiones
    SELECT * INTO commission_breakdown
    FROM calculate_commission_breakdown(NEW.total_price);

    -- Insertar registro de comision con travel_insurance_amount aislado
    INSERT INTO commission_records (
      booking_id,
      agency_id,
      tour_id,
      total_tour_price,
      agency_commission_amount,
      service_charge_amount,
      platform_total_revenue,
      agency_net_amount,
      travel_insurance_amount,
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
      COALESCE(NEW.travel_insurance_cost, 0),
      'pending'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;
