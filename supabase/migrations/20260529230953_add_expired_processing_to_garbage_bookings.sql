-- Reemplazar funcion

DROP FUNCTION IF EXISTS get_garbage_bookings(integer);

CREATE FUNCTION get_garbage_bookings(threshold_days int DEFAULT 7)
RETURNS TABLE (
  id uuid,
  booking_code text,
  created_at timestamptz,
  status text,
  payment_status text,
  payment_method text,
  total_price numeric,
  travelers_count int,
  user_name text,
  user_email text,
  tour_name text,
  agency_name text,
  reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id,
    b.booking_code,
    b.created_at,
    b.status,
    b.payment_status,
    b.payment_method,
    b.total_price,
    b.travelers_count,
    COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), '—') AS user_name,
    COALESCE(u.email, '—') AS user_email,
    COALESCE(t.name, '—') AS tour_name,
    COALESCE(a.name, '—') AS agency_name,
    CASE
      WHEN b.payment_status = 'pending'
        THEN 'abandoned'
      WHEN b.payment_status = 'processing' AND b.payment_method = 'Transferencia Bancaria'
        THEN 'unconfirmed_transfer'
      WHEN b.payment_status = 'processing'
        THEN 'expired_processing'
      ELSE 'other'
    END AS reason
  FROM bookings b
  LEFT JOIN users u ON u.id = b.user_id
  LEFT JOIN tours t ON t.id = b.tour_id
  LEFT JOIN agencies a ON a.id = b.agency_id
  WHERE b.status IN ('pending', 'cancelled')
    AND (
      -- Nunca iniciaron el pago (umbral configurable)
      (
        b.payment_status = 'pending'
        AND b.created_at < NOW() - (threshold_days || ' days')::interval
      )
      OR
      -- Transferencia bancaria sin confirmar (umbral configurable)
      (
        b.payment_status = 'processing'
        AND b.payment_method = 'Transferencia Bancaria'
        AND b.created_at < NOW() - (threshold_days || ' days')::interval
      )
      OR
      -- Pago en proceso expirado (OXXO u otro método, umbral fijo 3 días)
      (
        b.payment_status = 'processing'
        AND b.payment_method != 'Transferencia Bancaria'
        AND b.created_at < NOW() - INTERVAL '3 days'
      )
    )
  ORDER BY b.created_at ASC;
$$;

REVOKE ALL ON FUNCTION get_garbage_bookings(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_garbage_bookings(int) TO authenticated;

-- Actualizar RLS policy DELETE

DROP POLICY IF EXISTS "Admins can delete unpaid bookings" ON bookings;

CREATE POLICY "Admins can delete unpaid bookings"
  ON bookings FOR DELETE
  TO authenticated
  USING (
    (SELECT current_user_has_role(ARRAY['admin']))
    AND (
      payment_status = 'pending'
      OR (payment_status = 'processing' AND payment_method = 'Transferencia Bancaria')
      OR (payment_status = 'processing' AND created_at < NOW() - INTERVAL '3 days')
    )
  );
