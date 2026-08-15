-- Función para actualizar el estado de pago de una reserva
CREATE OR REPLACE FUNCTION update_booking_payment_status(
  p_booking_id uuid,
  p_status text,
  p_payment_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_booking_user_id uuid;
  v_agency_user_id uuid;
  v_user_role text;
BEGIN
  -- Obtener el ID del usuario actual
  v_user_id := auth.uid();
  
  -- Obtener el rol del usuario
  SELECT role INTO v_user_role
  FROM users
  WHERE id = v_user_id;
  
  -- Obtener el usuario propietario de la reserva
  SELECT user_id INTO v_booking_user_id
  FROM bookings
  WHERE id = p_booking_id;
  
  -- Obtener el usuario propietario de la agencia
  SELECT agencies.user_id INTO v_agency_user_id
  FROM bookings
  JOIN agencies ON bookings.agency_id = agencies.id
  WHERE bookings.id = p_booking_id;
  
  -- Verificar permisos: solo el propietario de la reserva, la agencia o un admin pueden actualizar
  IF v_user_id != v_booking_user_id AND v_user_id != v_agency_user_id AND v_user_role != 'admin' THEN
    RAISE EXCEPTION 'No tienes permiso para actualizar esta reserva';
  END IF;
  
  -- Actualizar la reserva
  UPDATE bookings
  SET 
    status = p_status,
    payment_status = p_payment_status,
    paid_at = CASE WHEN p_payment_status = 'succeeded' THEN now() ELSE paid_at END,
    updated_at = now()
  WHERE id = p_booking_id;
  
  RETURN FOUND;
END;
$$;

-- Función para obtener detalles de pago de una reserva
CREATE OR REPLACE FUNCTION get_booking_payment_details(
  p_booking_id uuid
)
RETURNS TABLE(
  booking_id uuid,
  total_price numeric,
  deposit_amount numeric,
  service_charge numeric,
  user_payment numeric,
  payment_status text,
  payment_method text,
  paid_at timestamptz,
  agency_commission numeric,
  agency_net_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_booking_user_id uuid;
  v_agency_user_id uuid;
  v_user_role text;
BEGIN
  -- Obtener el ID del usuario actual
  v_user_id := auth.uid();
  
  -- Obtener el rol del usuario
  SELECT role INTO v_user_role
  FROM users
  WHERE id = v_user_id;
  
  -- Obtener el usuario propietario de la reserva
  SELECT user_id INTO v_booking_user_id
  FROM bookings
  WHERE id = p_booking_id;
  
  -- Obtener el usuario propietario de la agencia
  SELECT agencies.user_id INTO v_agency_user_id
  FROM bookings
  JOIN agencies ON bookings.agency_id = agencies.id
  WHERE bookings.id = p_booking_id;
  
  -- Verificar permisos: solo el propietario de la reserva, la agencia o un admin pueden ver detalles
  IF v_user_id != v_booking_user_id AND v_user_id != v_agency_user_id AND v_user_role != 'admin' THEN
    RAISE EXCEPTION 'No tienes permiso para ver los detalles de esta reserva';
  END IF;
  
  -- Devolver los detalles de pago
  RETURN QUERY
  SELECT 
    b.id as booking_id,
    b.total_price,
    b.deposit_amount,
    b.service_charge,
    b.user_payment,
    b.payment_status,
    b.payment_method,
    b.paid_at,
    b.commission_amount as agency_commission,
    COALESCE(cr.agency_net_amount, b.deposit_amount - b.commission_amount) as agency_net_amount
  FROM bookings b
  LEFT JOIN commission_records cr ON b.id = cr.booking_id
  WHERE b.id = p_booking_id;
END;
$$;

-- Función para calcular el desglose de pagos para un tour
CREATE OR REPLACE FUNCTION calculate_payment_breakdown(
  p_price numeric,
  p_deposit_percentage integer,
  p_travelers_count integer DEFAULT 1
)
RETURNS TABLE(
  total_price numeric,
  deposit_amount numeric,
  agency_commission numeric,
  service_charge numeric,
  user_payment numeric,
  platform_revenue numeric,
  agency_receives numeric,
  balance_due numeric
)
LANGUAGE plpgsql
AS $$
BEGIN
  -- Calcular el precio total
  total_price := p_price * p_travelers_count;
  
  -- Calcular el depósito
  deposit_amount := total_price * (p_deposit_percentage / 100.0);
  
  -- Calcular comisiones
  agency_commission := total_price * 0.10; -- 10% del precio total
  service_charge := total_price * 0.03; -- 3% del precio total
  
  -- Lo que paga el usuario
  user_payment := deposit_amount + service_charge;
  
  -- Lo que recibe la plataforma
  platform_revenue := agency_commission + service_charge;
  
  -- Lo que recibe la agencia
  agency_receives := deposit_amount - agency_commission;
  
  -- Saldo pendiente
  balance_due := total_price - deposit_amount;
  
  RETURN NEXT;
END;
$$;

-- Conceder permisos para ejecutar las funciones
GRANT EXECUTE ON FUNCTION update_booking_payment_status TO authenticated;
GRANT EXECUTE ON FUNCTION get_booking_payment_details TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_payment_breakdown TO public;

-- Comentarios para documentación
COMMENT ON FUNCTION update_booking_payment_status IS 'Actualiza el estado de pago de una reserva. Solo el propietario, la agencia o un admin pueden actualizar.';
COMMENT ON FUNCTION get_booking_payment_details IS 'Obtiene los detalles de pago de una reserva. Solo el propietario, la agencia o un admin pueden ver.';
COMMENT ON FUNCTION calculate_payment_breakdown IS 'Calcula el desglose de pagos para un tour basado en el precio, porcentaje de depósito y número de viajeros.';
