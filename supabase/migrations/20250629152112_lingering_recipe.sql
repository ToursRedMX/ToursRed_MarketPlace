-- Eliminar políticas existentes antes de recrearlas
DO $$ 
BEGIN
  -- Eliminar políticas si existen
  DROP POLICY IF EXISTS "Users can view their own notifications" ON notifications;
  DROP POLICY IF EXISTS "Users can update their own notifications" ON notifications;
  DROP POLICY IF EXISTS "System can create notifications" ON notifications;
  DROP POLICY IF EXISTS "Admins can view all notifications" ON notifications;
END $$;

-- Crear políticas nuevamente
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

-- Actualizar o crear funciones relacionadas con notificaciones
CREATE OR REPLACE FUNCTION get_user_notifications(
  limit_count integer DEFAULT 20,
  offset_count integer DEFAULT 0,
  include_read boolean DEFAULT false
)
RETURNS SETOF notifications
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM notifications
  WHERE user_id = auth.uid()
    AND (include_read OR is_read = false)
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY created_at DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$;

-- Función para marcar notificación como leída
CREATE OR REPLACE FUNCTION mark_notification_as_read(notification_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  success boolean;
BEGIN
  UPDATE notifications
  SET is_read = true, updated_at = now()
  WHERE id = notification_id AND user_id = auth.uid();
  
  GET DIAGNOSTICS success = ROW_COUNT;
  RETURN success > 0;
END;
$$;

-- Función para marcar todas las notificaciones como leídas
CREATE OR REPLACE FUNCTION mark_all_notifications_as_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE notifications
  SET is_read = true, updated_at = now()
  WHERE user_id = auth.uid() AND is_read = false;
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

-- Función para crear notificación
CREATE OR REPLACE FUNCTION create_user_notification(
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

-- Crear trigger para updated_at solo si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'notifications_updated_at' 
    AND tgrelid = 'notifications'::regclass
  ) THEN
    CREATE TRIGGER notifications_updated_at
      BEFORE UPDATE ON notifications
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- Actualizar vista de notificaciones
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

-- Función para contar notificaciones no leídas
CREATE OR REPLACE FUNCTION get_unread_notifications_count()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  unread_count integer;
BEGIN
  SELECT COUNT(*)::integer INTO unread_count
  FROM notifications
  WHERE user_id = auth.uid() 
    AND is_read = false
    AND (expires_at IS NULL OR expires_at > now());
    
  RETURN unread_count;
END;
$$;
