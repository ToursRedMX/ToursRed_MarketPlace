
-- Agregar campos a la tabla bookings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'is_no_show'
  ) THEN
    ALTER TABLE public.bookings ADD COLUMN is_no_show boolean DEFAULT false NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'no_show_marked_at'
  ) THEN
    ALTER TABLE public.bookings ADD COLUMN no_show_marked_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'no_show_marked_by'
  ) THEN
    ALTER TABLE public.bookings ADD COLUMN no_show_marked_by uuid REFERENCES public.users(id);
  END IF;
END $$;

-- Agregar campo a la tabla users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'no_show_count'
  ) THEN
    ALTER TABLE public.users ADD COLUMN no_show_count integer DEFAULT 0 NOT NULL;
  END IF;
END $$;

-- Crear función para actualizar el contador de no shows
CREATE OR REPLACE FUNCTION public.update_user_no_show_count()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Si se marca como no show (cambió de false a true)
  IF NEW.is_no_show = true AND (OLD.is_no_show IS NULL OR OLD.is_no_show = false) THEN
    UPDATE public.users
    SET no_show_count = no_show_count + 1
    WHERE id = NEW.user_id;
  END IF;

  -- Si se desmarca como no show (cambió de true a false)
  IF NEW.is_no_show = false AND OLD.is_no_show = true THEN
    UPDATE public.users
    SET no_show_count = GREATEST(no_show_count - 1, 0)
    WHERE id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Crear trigger para actualizar automáticamente el contador
DROP TRIGGER IF EXISTS trigger_update_no_show_count ON public.bookings;

CREATE TRIGGER trigger_update_no_show_count
  AFTER UPDATE OF is_no_show ON public.bookings
  FOR EACH ROW
  WHEN (OLD.is_no_show IS DISTINCT FROM NEW.is_no_show)
  EXECUTE FUNCTION public.update_user_no_show_count();

-- Agregar índice para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_bookings_is_no_show 
  ON public.bookings(is_no_show) 
  WHERE is_no_show = true;

CREATE INDEX IF NOT EXISTS idx_users_no_show_count 
  ON public.users(no_show_count) 
  WHERE no_show_count > 0;

-- Crear función helper para verificar si un usuario es de alto riesgo
CREATE OR REPLACE FUNCTION public.is_high_risk_traveler(user_id_param uuid)
RETURNS boolean
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  no_shows integer;
BEGIN
  SELECT no_show_count INTO no_shows
  FROM public.users
  WHERE id = user_id_param;

  RETURN COALESCE(no_shows, 0) > 3;
END;
$$;

-- Comentarios en las columnas
COMMENT ON COLUMN public.bookings.is_no_show IS 'Indica si el viajero no se presentó al tour';
COMMENT ON COLUMN public.bookings.no_show_marked_at IS 'Fecha y hora en que se marcó como no show';
COMMENT ON COLUMN public.bookings.no_show_marked_by IS 'ID del usuario de la agencia que marcó como no show';
COMMENT ON COLUMN public.users.no_show_count IS 'Contador de no shows del viajero. Más de 3 = alto riesgo';
