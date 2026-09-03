
-- Función para crear conversación
CREATE OR REPLACE FUNCTION create_conversation(
  p_title text,
  p_type text,
  p_participant_ids uuid[],
  p_tour_id uuid DEFAULT NULL,
  p_booking_id uuid DEFAULT NULL
)
RETURNS uuid
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_conversation_id uuid;
  v_participant_id uuid;
BEGIN
  -- Crear la conversación
  INSERT INTO conversations (title, type, status, tour_id, booking_id, created_by)
  VALUES (p_title, p_type, 'active', p_tour_id, p_booking_id, auth.uid())
  RETURNING id INTO v_conversation_id;

  -- Agregar al creador como participante
  INSERT INTO message_participants (conversation_id, user_id, role)
  VALUES (v_conversation_id, auth.uid(), 
    (SELECT role FROM users WHERE id = auth.uid())
  );

  -- Agregar otros participantes
  FOREACH v_participant_id IN ARRAY p_participant_ids
  LOOP
    IF v_participant_id != auth.uid() THEN
      INSERT INTO message_participants (conversation_id, user_id, role)
      VALUES (v_conversation_id, v_participant_id,
        (SELECT role FROM users WHERE id = v_participant_id)
      );
    END IF;
  END LOOP;

  RETURN v_conversation_id;
END;
$$;

-- Función para enviar mensaje
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
BEGIN
  -- Verificar que el usuario sea participante de la conversación
  IF NOT EXISTS (
    SELECT 1 FROM message_participants
    WHERE conversation_id = p_conversation_id
    AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'No eres participante de esta conversación';
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

-- Función para marcar mensajes como leídos
CREATE OR REPLACE FUNCTION mark_conversation_read(
  p_conversation_id uuid
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Actualizar last_read_at del participante
  UPDATE message_participants
  SET last_read_at = NOW()
  WHERE conversation_id = p_conversation_id
  AND user_id = auth.uid();
END;
$$;
