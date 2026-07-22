-- ============================================================
-- NUEVAS COLUMNAS EN commission_records PARA DESGLOSE FINANCIERO COMPLETO
-- ============================================================
DO $$
BEGIN
  -- Cargo por servicio bruto del booking principal (antes de exencion membresia)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'commission_records' AND column_name = 'gross_service_charge_amount') THEN
    ALTER TABLE commission_records ADD COLUMN gross_service_charge_amount numeric(12,2) NOT NULL DEFAULT 0;
  END IF;

  -- Exencion de membresia aplicada al cargo por servicio del booking principal
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'commission_records' AND column_name = 'membership_exemption_total') THEN
    ALTER TABLE commission_records ADD COLUMN membership_exemption_total numeric(12,2) NOT NULL DEFAULT 0;
  END IF;

  -- Cargos por servicio de abonos del plan de pagos
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'commission_records' AND column_name = 'payment_plan_service_charges') THEN
    ALTER TABLE commission_records ADD COLUMN payment_plan_service_charges numeric(12,2) NOT NULL DEFAULT 0;
  END IF;

  -- Exenciones de membresia aplicadas durante abonos del plan de pagos
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'commission_records' AND column_name = 'payment_plan_membership_exemptions') THEN
    ALTER TABLE commission_records ADD COLUMN payment_plan_membership_exemptions numeric(12,2) NOT NULL DEFAULT 0;
  END IF;

  -- Servicios opcionales: subtotal bruto
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'commission_records' AND column_name = 'optional_services_subtotal') THEN
    ALTER TABLE commission_records ADD COLUMN optional_services_subtotal numeric(12,2) NOT NULL DEFAULT 0;
  END IF;

  -- Servicios opcionales: comision de agencia (plataforma)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'commission_records' AND column_name = 'optional_services_commission') THEN
    ALTER TABLE commission_records ADD COLUMN optional_services_commission numeric(12,2) NOT NULL DEFAULT 0;
  END IF;

  -- Servicios opcionales: cargo por servicio cobrado al viajero
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'commission_records' AND column_name = 'optional_services_service_charge') THEN
    ALTER TABLE commission_records ADD COLUMN optional_services_service_charge numeric(12,2) NOT NULL DEFAULT 0;
  END IF;

  -- Servicios opcionales: neto para la agencia
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'commission_records' AND column_name = 'optional_services_agency_net') THEN
    ALTER TABLE commission_records ADD COLUMN optional_services_agency_net numeric(12,2) NOT NULL DEFAULT 0;
  END IF;

  -- Suplementos: subtotal bruto
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'commission_records' AND column_name = 'supplements_subtotal') THEN
    ALTER TABLE commission_records ADD COLUMN supplements_subtotal numeric(12,2) NOT NULL DEFAULT 0;
  END IF;

  -- Suplementos: comision de suplemento (plataforma, 10%)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'commission_records' AND column_name = 'supplements_commission') THEN
    ALTER TABLE commission_records ADD COLUMN supplements_commission numeric(12,2) NOT NULL DEFAULT 0;
  END IF;

  -- Suplementos: cargo por servicio cobrado al viajero
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'commission_records' AND column_name = 'supplements_service_charge') THEN
    ALTER TABLE commission_records ADD COLUMN supplements_service_charge numeric(12,2) NOT NULL DEFAULT 0;
  END IF;

  -- Suplementos: neto para la agencia
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'commission_records' AND column_name = 'supplements_agency_net') THEN
    ALTER TABLE commission_records ADD COLUMN supplements_agency_net numeric(12,2) NOT NULL DEFAULT 0;
  END IF;
END $$;

-- ============================================================
-- NUEVAS COLUMNAS EN booking_optional_services PARA TRAZABILIDAD
-- El edge function purchase-post-booking-extras ya calculaba estos valores
-- pero no los guardaba en la tabla. Ahora si.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_optional_services' AND column_name = 'service_charge') THEN
    ALTER TABLE booking_optional_services ADD COLUMN service_charge numeric(10,2) NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_optional_services' AND column_name = 'total_paid') THEN
    ALTER TABLE booking_optional_services ADD COLUMN total_paid numeric(10,2) NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_optional_services' AND column_name = 'agency_commission') THEN
    ALTER TABLE booking_optional_services ADD COLUMN agency_commission numeric(10,2) NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_optional_services' AND column_name = 'membership_exemption_used') THEN
    ALTER TABLE booking_optional_services ADD COLUMN membership_exemption_used numeric(10,2) NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_optional_services' AND column_name = 'payment_method') THEN
    ALTER TABLE booking_optional_services ADD COLUMN payment_method text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_optional_services' AND column_name = 'paid_at') THEN
    ALTER TABLE booking_optional_services ADD COLUMN paid_at timestamptz;
  END IF;
END $$;
