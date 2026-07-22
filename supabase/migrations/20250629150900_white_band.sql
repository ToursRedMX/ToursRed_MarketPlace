-- Crear enum para tipo de aprobación de reservas
CREATE TYPE booking_approval_type AS ENUM ('automatic', 'manual');

-- Crear enum para estado de aprobación
CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected');

-- Crear enum para tipos de notificación
CREATE TYPE notification_type AS ENUM (
  'booking_pending_approval',
  'booking_approved',
  'booking_rejected',
  'booking_confirmed',
  'booking_cancelled',
  'message_received',
  'tour_updated',
  'system_announcement'
);

-- Agregar columnas a la tabla tours
ALTER TABLE tours 
ADD COLUMN IF NOT EXISTS booking_approval_type booking_approval_type DEFAULT 'automatic',
ADD COLUMN IF NOT EXISTS approval_required boolean DEFAULT false;

-- Agregar columnas a la tabla bookings
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS approval_status approval_status DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS approval_notes text,
ADD COLUMN IF NOT EXISTS approved_at timestamptz,
ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id);

-- Crear tabla de notificaciones
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  data jsonb DEFAULT '{}',
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  expires_at timestamptz
);

-- Índices para la tabla notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

-- Habilitar RLS en notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Políticas para notifications
CREATE POLICY "Users can view their own notifications"
  ON notifications
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can update their own notifications"
  ON notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "System can create notifications"
  ON notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can view all notifications"
  ON notifications
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  );

-- Función para crear notificaciones
CREATE OR REPLACE FUNCTION create_notification(
  p_user_id uuid,
  p_type notification_type,
  p_title text,
  p_message text,
  p_data jsonb DEFAULT '{}',
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  notification_id uuid;
BEGIN
  INSERT INTO notifications (
    user_id,
    type,
    title,
    message,
    data,
    expires_at
  ) VALUES (
    p_user_id,
    p_type,
    p_title,
    p_message,
    p_data,
    p_expires_at
  ) RETURNING id INTO notification_id;
  
  RETURN notification_id;
END;
$$;

-- Función para obtener el usuario propietario de una agencia
CREATE OR REPLACE FUNCTION get_agency_owner_id(p_agency_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  owner_id uuid;
BEGIN
  SELECT user_id INTO owner_id
  FROM agencies
  WHERE id = p_agency_id;
  
  RETURN owner_id;
END;
$$;

-- Función para manejar reservas pendientes de aprobación
CREATE OR REPLACE FUNCTION handle_booking_approval_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  agency_owner_id uuid;
  tour_name text;
  user_name text;
BEGIN
  -- Solo procesar si es una nueva reserva o cambio de estado
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.approval_status != NEW.approval_status) THEN
    
    -- Obtener información necesaria
    SELECT t.name INTO tour_name
    FROM tours t
    WHERE t.id = NEW.tour_id;
    
    SELECT COALESCE(u.first_name || ' ' || u.last_name, u.email) INTO user_name
    FROM users u
    WHERE u.id = NEW.user_id;
    
    -- Obtener el propietario de la agencia
    agency_owner_id := get_agency_owner_id(NEW.agency_id);
    
    IF agency_owner_id IS NOT NULL THEN
      -- Crear notificación según el estado
      IF NEW.approval_status = 'pending' AND TG_OP = 'INSERT' THEN
        -- Nueva reserva pendiente de aprobación
        PERFORM create_notification(
          agency_owner_id,
          'booking_pending_approval',
          'Nueva reserva pendiente de aprobación',
          user_name || ' ha solicitado una reserva para "' || tour_name || '" que requiere tu aprobación.',
          jsonb_build_object(
            'booking_id', NEW.id,
            'tour_id', NEW.tour_id,
            'user_id', NEW.user_id,
            'tour_name', tour_name,
            'user_name', user_name,
            'travelers_count', NEW.travelers_count,
            'booking_date', NEW.booking_date
          )
        );
        
      ELSIF NEW.approval_status = 'approved' AND OLD.approval_status = 'pending' THEN
        -- Reserva aprobada - notificar al usuario
        PERFORM create_notification(
          NEW.user_id,
          'booking_approved',
          'Reserva aprobada',
          'Tu reserva para "' || tour_name || '" ha sido aprobada. Ahora puedes proceder con el pago.',
          jsonb_build_object(
            'booking_id', NEW.id,
            'tour_id', NEW.tour_id,
            'tour_name', tour_name
          )
        );
        
      ELSIF NEW.approval_status = 'rejected' AND OLD.approval_status = 'pending' THEN
        -- Reserva rechazada - notificar al usuario
        PERFORM create_notification(
          NEW.user_id,
          'booking_rejected',
          'Reserva rechazada',
          'Tu reserva para "' || tour_name || '" ha sido rechazada.' || 
          CASE WHEN NEW.approval_notes IS NOT NULL THEN ' Motivo: ' || NEW.approval_notes ELSE '' END,
          jsonb_build_object(
            'booking_id', NEW.id,
            'tour_id', NEW.tour_id,
            'tour_name', tour_name,
            'rejection_reason', NEW.approval_notes
          )
        );
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Crear trigger para notificaciones de reservas
DROP TRIGGER IF EXISTS booking_approval_notification_trigger ON bookings;
CREATE TRIGGER booking_approval_notification_trigger
  AFTER INSERT OR UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION handle_booking_approval_notification();

-- Función para marcar notificaciones como leídas
CREATE OR REPLACE FUNCTION mark_notifications_as_read(notification_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE notifications 
  SET is_read = true, updated_at = now()
  WHERE id = ANY(notification_ids) 
    AND user_id = auth.uid();
END;
$$;

-- Función para obtener notificaciones no leídas de un usuario
CREATE OR REPLACE FUNCTION get_unread_notifications_count(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  unread_count integer;
BEGIN
  SELECT COUNT(*)::integer INTO unread_count
  FROM notifications
  WHERE user_id = p_user_id 
    AND is_read = false
    AND (expires_at IS NULL OR expires_at > now());
    
  RETURN unread_count;
END;
$$;

-- Vista para notificaciones con información adicional
CREATE OR REPLACE VIEW user_notifications AS
SELECT 
  n.*,
  CASE 
    WHEN n.expires_at IS NOT NULL AND n.expires_at <= now() THEN true
    ELSE false
  END as is_expired
FROM notifications n
WHERE n.user_id = auth.uid()
  AND (n.expires_at IS NULL OR n.expires_at > now())
ORDER BY n.created_at DESC;

-- Actualizar trigger de updated_at para notifications
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notifications_updated_at ON notifications;
CREATE TRIGGER notifications_updated_at
  BEFORE UPDATE ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Función para limpiar notificaciones expiradas (ejecutar periódicamente)
CREATE OR REPLACE FUNCTION cleanup_expired_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM notifications
  WHERE expires_at IS NOT NULL 
    AND expires_at < now() - INTERVAL '30 days';
END;
$$;
