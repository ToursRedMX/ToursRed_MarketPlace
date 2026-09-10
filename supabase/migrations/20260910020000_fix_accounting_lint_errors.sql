-- Corrige dos errores de validacion que afectan al flujo de cobros y comisiones.

-- ROW_COUNT ya es booleano en esta funcion; compararlo contra un entero rompe
-- la compilacion de la funcion en PostgreSQL.
CREATE OR REPLACE FUNCTION public.update_booking_payment_status(
  p_booking_id uuid,
  p_status text,
  p_payment_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  success boolean;
BEGIN
  UPDATE public.bookings
  SET
    status = p_status,
    payment_status = p_payment_status,
    updated_at = now(),
    paid_at = CASE WHEN p_payment_status = 'succeeded' THEN now() ELSE paid_at END
  WHERE id = p_booking_id;

  GET DIAGNOSTICS success = ROW_COUNT;
  RETURN success;
END;
$$;

-- Las funciones de generacion de commission_records actualizan updated_at en
-- sus UPSERTs. La columna faltaba en instalaciones existentes, haciendo que
-- los procedimientos de comisiones fallaran aunque el asiento fuera valido.
ALTER TABLE public.commission_records
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.commission_records
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;

ALTER TABLE public.commission_records
  ALTER COLUMN updated_at SET DEFAULT now();

