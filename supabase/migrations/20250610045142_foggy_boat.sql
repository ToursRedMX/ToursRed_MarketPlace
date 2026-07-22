-- Agregar campos de pago a la tabla bookings
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS service_charge decimal(10,2) DEFAULT 0 CHECK (service_charge >= 0),
ADD COLUMN IF NOT EXISTS user_payment decimal(10,2) DEFAULT 0 CHECK (user_payment >= 0),
ADD COLUMN IF NOT EXISTS platform_revenue decimal(10,2) DEFAULT 0 CHECK (platform_revenue >= 0),
ADD COLUMN IF NOT EXISTS payment_intent_id text,
ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'pending' CHECK (payment_status IN ('pending', 'processing', 'succeeded', 'failed', 'canceled')),
ADD COLUMN IF NOT EXISTS payment_method text,
ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- Tabla para transacciones de pago detalladas
CREATE TABLE IF NOT EXISTS payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  stripe_payment_intent_id text NOT NULL,
  amount decimal(10,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'mxn',
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'canceled')),
  payment_method_type text,
  stripe_fee decimal(10,2) DEFAULT 0,
  net_amount decimal(10,2) NOT NULL CHECK (net_amount >= 0),
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;

-- Tabla para registro de comisiones
CREATE TABLE IF NOT EXISTS commission_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  tour_id uuid NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  total_tour_price decimal(10,2) NOT NULL CHECK (total_tour_price >= 0),
  agency_commission_rate decimal(5,4) NOT NULL DEFAULT 0.10, -- 10%
  agency_commission_amount decimal(10,2) NOT NULL CHECK (agency_commission_amount >= 0),
  service_charge_rate decimal(5,4) NOT NULL DEFAULT 0.03, -- 3%
  service_charge_amount decimal(10,2) NOT NULL CHECK (service_charge_amount >= 0),
  platform_total_revenue decimal(10,2) NOT NULL CHECK (platform_total_revenue >= 0),
  agency_net_amount decimal(10,2) NOT NULL CHECK (agency_net_amount >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'paid_out', 'disputed')),
  processed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE commission_records ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para payment_transactions
CREATE POLICY "Users can read own payment transactions"
  ON payment_transactions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings
      WHERE bookings.id = payment_transactions.booking_id
      AND bookings.user_id = auth.uid()
    )
  );

CREATE POLICY "Agencies can read their payment transactions"
  ON payment_transactions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings
      INNER JOIN agencies ON bookings.agency_id = agencies.id
      WHERE bookings.id = payment_transactions.booking_id
      AND agencies.user_id = auth.uid()
    )
  );

-- Políticas RLS para commission_records
CREATE POLICY "Agencies can read own commission records"
  ON commission_records
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = commission_records.agency_id
      AND agencies.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can read commission records for their bookings"
  ON commission_records
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings
      WHERE bookings.id = commission_records.booking_id
      AND bookings.user_id = auth.uid()
    )
  );

-- Función para calcular comisiones automáticamente
CREATE OR REPLACE FUNCTION calculate_commission_breakdown(
  p_total_price decimal,
  p_agency_commission_rate decimal DEFAULT 0.10,
  p_service_charge_rate decimal DEFAULT 0.03
)
RETURNS TABLE(
  agency_commission decimal,
  service_charge decimal,
  platform_revenue decimal,
  agency_net_amount decimal
) AS $$
BEGIN
  agency_commission := p_total_price * p_agency_commission_rate;
  service_charge := p_total_price * p_service_charge_rate;
  platform_revenue := agency_commission + service_charge;
  agency_net_amount := p_total_price - agency_commission;
  
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- Trigger para crear registro de comisión automáticamente
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

-- Trigger en bookings para crear comisiones
DROP TRIGGER IF EXISTS create_commission_record_trigger ON bookings;
CREATE TRIGGER create_commission_record_trigger
  AFTER INSERT OR UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION create_commission_record();

-- Comentarios para documentación
COMMENT ON COLUMN bookings.service_charge IS 'Cargo por servicio (3% del precio total)';
COMMENT ON COLUMN bookings.user_payment IS 'Monto total que paga el usuario (depósito + cargo por servicio)';
COMMENT ON COLUMN bookings.platform_revenue IS 'Ganancia total de la plataforma (comisión agencia + cargo servicio)';
COMMENT ON COLUMN bookings.payment_intent_id IS 'ID del Payment Intent de Stripe';
COMMENT ON COLUMN bookings.payment_status IS 'Estado del pago en Stripe';

COMMENT ON TABLE payment_transactions IS 'Registro detallado de todas las transacciones de pago';
COMMENT ON TABLE commission_records IS 'Registro de comisiones y distribución de ingresos';

-- Función para obtener resumen financiero de una agencia
CREATE OR REPLACE FUNCTION get_agency_financial_summary(agency_uuid uuid)
RETURNS TABLE(
  total_bookings bigint,
  total_revenue decimal,
  total_commissions decimal,
  net_earnings decimal,
  pending_payouts decimal
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(cr.id) as total_bookings,
    SUM(cr.total_tour_price) as total_revenue,
    SUM(cr.agency_commission_amount) as total_commissions,
    SUM(cr.agency_net_amount) as net_earnings,
    SUM(CASE WHEN cr.status = 'processed' THEN cr.agency_net_amount ELSE 0 END) as pending_payouts
  FROM commission_records cr
  WHERE cr.agency_id = agency_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
