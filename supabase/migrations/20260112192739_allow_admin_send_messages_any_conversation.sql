
-- Actualizar función send_message
DROP FUNCTION IF EXISTS send_message(uuid, text, text);

CREATE OR REPLACE FUNCTION send_message(
  p_conversation_id uuid,
  p_content text,
  p_message_type text DEFAULT 'text'
)
RETURNS uuid
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_message_id uuid;
  v_is_admin boolean;
  v_is_participant boolean;
BEGIN
  -- Verificar si el usuario es admin
  SELECT (role = 'admin') INTO v_is_admin
  FROM users
  WHERE id = auth.uid();

  -- Verificar si el usuario es participante
  SELECT EXISTS (
    SELECT 1 FROM message_participants
    WHERE conversation_id = p_conversation_id
    AND user_id = auth.uid()
  ) INTO v_is_participant;

  -- Si no es admin ni participante, denegar acceso
  IF NOT v_is_admin AND NOT v_is_participant THEN
    RAISE EXCEPTION 'No tienes permiso para enviar mensajes a esta conversación';
  END IF;

  -- Insertar el mensaje
  INSERT INTO messages (conversation_id, sender_id, content, message_type)
  VALUES (p_conversation_id, auth.uid(), p_content, p_message_type)
  RETURNING id INTO v_message_id;

  -- Actualizar last_message_at en la conversación
  UPDATE conversations
  SET last_message_at = NOW()
  WHERE id = p_conversation_id;

  RETURN v_message_id;
END;
$$;

-- Agregar política para que admins puedan insertar mensajes en cualquier conversación
DROP POLICY IF EXISTS "Admins can send messages to any conversation" ON messages;

CREATE POLICY "Admins can send messages to any conversation"
  ON messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (sender_id = auth.uid()) AND
    (
      -- Es admin
      EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = auth.uid() 
        AND u.role = 'admin'
      )
      OR
      -- O es participante de la conversación
      EXISTS (
        SELECT 1 FROM message_participants mp
        WHERE mp.conversation_id = messages.conversation_id
        AND mp.user_id = auth.uid()
      )
    )
  );
