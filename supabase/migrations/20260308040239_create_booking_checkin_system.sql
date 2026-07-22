-- Tabla de tokens de check-in
CREATE TABLE IF NOT EXISTS public.booking_checkin_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_checkin_tokens_booking_id 
  ON public.booking_checkin_tokens(booking_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_checkin_tokens_token 
  ON public.booking_checkin_tokens(token);

ALTER TABLE public.booking_checkin_tokens ENABLE ROW LEVEL SECURITY;

-- El viajero dueño de la reserva puede leer su token
CREATE POLICY "Traveler can view own checkin token"
  ON public.booking_checkin_tokens FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = booking_checkin_tokens.booking_id
        AND b.user_id = (SELECT auth.uid())
    )
  );

-- La agencia puede leer tokens de sus propias reservas
CREATE POLICY "Agency can view checkin tokens for their bookings"
  ON public.booking_checkin_tokens FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.agencies a ON a.id = b.agency_id
      WHERE b.id = booking_checkin_tokens.booking_id
        AND a.user_id = (SELECT auth.uid())
    )
  );

-- La agencia puede actualizar el token (marcar como redimido)
CREATE POLICY "Agency can update checkin tokens for their bookings"
  ON public.booking_checkin_tokens FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.agencies a ON a.id = b.agency_id
      WHERE b.id = booking_checkin_tokens.booking_id
        AND a.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.agencies a ON a.id = b.agency_id
      WHERE b.id = booking_checkin_tokens.booking_id
        AND a.user_id = (SELECT auth.uid())
    )
  );

-- Admins pueden ver todos los tokens
CREATE POLICY "Admins can view all checkin tokens"
  ON public.booking_checkin_tokens FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role IN ('admin', 'super_admin')
    )
  );

-- Agregar columnas a bookings para el check-in
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'checkin_status'
  ) THEN
    ALTER TABLE public.bookings ADD COLUMN checkin_status text
      CHECK (checkin_status IN ('full', 'partial'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'checkin_at'
  ) THEN
    ALTER TABLE public.bookings ADD COLUMN checkin_at timestamptz;
  END IF;
END $$;

-- Agregar columna is_no_show a booking_travelers para marcar individualmente
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_travelers' AND column_name = 'is_no_show'
  ) THEN
    ALTER TABLE public.booking_travelers ADD COLUMN is_no_show boolean DEFAULT false NOT NULL;
  END IF;
END $$;

-- Índices para rendimiento
CREATE INDEX IF NOT EXISTS idx_bookings_checkin_status 
  ON public.bookings(checkin_status)
  WHERE checkin_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_travelers_is_no_show
  ON public.booking_travelers(is_no_show)
  WHERE is_no_show = true;

COMMENT ON TABLE public.booking_checkin_tokens IS 'Tokens únicos para check-in QR de cada reserva';
COMMENT ON COLUMN public.booking_checkin_tokens.token IS 'UUID único que se codifica en el código QR';
COMMENT ON COLUMN public.booking_checkin_tokens.expires_at IS '24 horas después del inicio del tour';
COMMENT ON COLUMN public.booking_checkin_tokens.redeemed_at IS 'Cuando la agencia confirmó el check-in';
COMMENT ON COLUMN public.bookings.checkin_status IS 'null = sin check-in, full = todos asistieron, partial = algunos no se presentaron';
COMMENT ON COLUMN public.bookings.checkin_at IS 'Timestamp cuando se realizó el check-in';
COMMENT ON COLUMN public.booking_travelers.is_no_show IS 'true si este viajero individual no se presentó (check-in parcial)';
