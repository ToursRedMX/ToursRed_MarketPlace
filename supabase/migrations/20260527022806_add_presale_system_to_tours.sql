-- Columnas de preventa en tours
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tours' AND column_name = 'preventa_activa') THEN
    ALTER TABLE tours ADD COLUMN preventa_activa boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tours' AND column_name = 'preventa_inicio') THEN
    ALTER TABLE tours ADD COLUMN preventa_inicio date;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tours' AND column_name = 'preventa_fin') THEN
    ALTER TABLE tours ADD COLUMN preventa_fin date;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tours' AND column_name = 'preventa_precio_especial') THEN
    ALTER TABLE tours ADD COLUMN preventa_precio_especial boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tours' AND column_name = 'preventa_tipo_descuento') THEN
    ALTER TABLE tours ADD COLUMN preventa_tipo_descuento text CHECK (preventa_tipo_descuento IN ('monto', 'porcentaje'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tours' AND column_name = 'preventa_descuento_valor') THEN
    ALTER TABLE tours ADD COLUMN preventa_descuento_valor decimal(10,2);
  END IF;
END $$;

-- Columnas de preventa en bookings
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'es_reserva_preventa') THEN
    ALTER TABLE bookings ADD COLUMN es_reserva_preventa boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'preventa_comision_descuento') THEN
    ALTER TABLE bookings ADD COLUMN preventa_comision_descuento decimal(10,2) DEFAULT 0;
  END IF;
END $$;

-- Columnas de preventa en commission_records
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'commission_records' AND column_name = 'preventa_comision_descuento') THEN
    ALTER TABLE commission_records ADD COLUMN preventa_comision_descuento decimal(10,2) DEFAULT 0;
  END IF;
END $$;

-- Índice para consultas de preventa activa
CREATE INDEX IF NOT EXISTS idx_tours_preventa_activa ON tours(preventa_activa) WHERE preventa_activa = true;
CREATE INDEX IF NOT EXISTS idx_bookings_es_reserva_preventa ON bookings(tour_id, es_reserva_preventa) WHERE es_reserva_preventa = true;

-- Función: cuenta reservas de preventa confirmadas/pagadas para un tour
CREATE OR REPLACE FUNCTION public.get_preventa_bookings_count(p_tour_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*)
  INTO v_count
  FROM bookings
  WHERE tour_id = p_tour_id
    AND es_reserva_preventa = true
    AND status NOT IN ('cancelled');
  RETURN COALESCE(v_count, 0);
END;
$$;

-- Función: calcula precio de preventa dado precio base y configuración del tour
CREATE OR REPLACE FUNCTION public.calculate_preventa_precio(p_tour_id uuid, p_precio_base decimal)
RETURNS decimal
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_precio_especial boolean;
  v_tipo_descuento text;
  v_descuento_valor decimal;
  v_precio_final decimal;
BEGIN
  SELECT preventa_precio_especial, preventa_tipo_descuento, preventa_descuento_valor
  INTO v_precio_especial, v_tipo_descuento, v_descuento_valor
  FROM tours
  WHERE id = p_tour_id;

  IF NOT v_precio_especial OR v_descuento_valor IS NULL OR v_descuento_valor <= 0 THEN
    RETURN p_precio_base;
  END IF;

  IF v_tipo_descuento = 'monto' THEN
    v_precio_final := GREATEST(0, p_precio_base - v_descuento_valor);
  ELSIF v_tipo_descuento = 'porcentaje' THEN
    v_precio_final := p_precio_base * (1 - (v_descuento_valor / 100));
  ELSE
    v_precio_final := p_precio_base;
  END IF;

  RETURN v_precio_final;
END;
$$;
