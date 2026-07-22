-- 1. Indice en notifications.user_id (critico para Realtime y RLS)
CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON public.notifications (user_id);

-- 2. Indice compuesto para consultas tipicas de notificaciones por usuario ordenadas por fecha
CREATE INDEX IF NOT EXISTS idx_notifications_user_id_created_at
  ON public.notifications (user_id, created_at DESC);

-- 3. Eliminar la politica SELECT con USING (true) que es redundante y degrada performance
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'slot_seat_status'
  ) THEN
    DROP POLICY IF EXISTS "Authenticated users can view seat status for booking"
      ON public.slot_seat_status;
  END IF;
END $$;
