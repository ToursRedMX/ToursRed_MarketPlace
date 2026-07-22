-- Tabla de conversaciones
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text,
  type text NOT NULL CHECK (type IN ('booking', 'general', 'support')) DEFAULT 'general',
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  tour_id uuid REFERENCES tours(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('active', 'closed', 'archived')) DEFAULT 'active',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_message_at timestamptz DEFAULT now()
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Tabla de participantes en conversaciones
CREATE TABLE IF NOT EXISTS message_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('participant', 'moderator')) DEFAULT 'participant',
  joined_at timestamptz DEFAULT now(),
  last_read_at timestamptz DEFAULT now(),
  is_active boolean DEFAULT true,
  UNIQUE(conversation_id, user_id)
);

ALTER TABLE message_participants ENABLE ROW LEVEL SECURITY;

-- Tabla de mensajes
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id),
  content text NOT NULL,
  message_type text NOT NULL CHECK (message_type IN ('text', 'system', 'attachment')) DEFAULT 'text',
  attachment_url text,
  attachment_name text,
  attachment_size integer,
  is_edited boolean DEFAULT false,
  edited_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Índices para mejor rendimiento
CREATE INDEX IF NOT EXISTS idx_conversations_booking_id ON conversations(booking_id);
CREATE INDEX IF NOT EXISTS idx_conversations_tour_id ON conversations(tour_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_by ON conversations(created_by);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON conversations(last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_participants_conversation_id ON message_participants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_message_participants_user_id ON message_participants(user_id);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);

-- Políticas RLS para conversations
CREATE POLICY "Users can view conversations they participate in"
  ON conversations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM message_participants
      WHERE message_participants.conversation_id = conversations.id
      AND message_participants.user_id = auth.uid()
      AND message_participants.is_active = true
    )
  );

CREATE POLICY "Admins can view all conversations"
  ON conversations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Users can create conversations"
  ON conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Participants can update conversation status"
  ON conversations
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM message_participants
      WHERE message_participants.conversation_id = conversations.id
      AND message_participants.user_id = auth.uid()
      AND message_participants.is_active = true
    )
  );

-- Políticas RLS para message_participants
CREATE POLICY "Users can view participants in their conversations"
  ON message_participants
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM message_participants mp2
      WHERE mp2.conversation_id = message_participants.conversation_id
      AND mp2.user_id = auth.uid()
      AND mp2.is_active = true
    ) OR
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Users can join conversations"
  ON message_participants
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = message_participants.conversation_id
      AND conversations.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can update their participation"
  ON message_participants
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

-- Políticas RLS para messages
CREATE POLICY "Users can view messages in their conversations"
  ON messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM message_participants
      WHERE message_participants.conversation_id = messages.conversation_id
      AND message_participants.user_id = auth.uid()
      AND message_participants.is_active = true
    ) OR
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Users can send messages in their conversations"
  ON messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1 FROM message_participants
      WHERE message_participants.conversation_id = messages.conversation_id
      AND message_participants.user_id = auth.uid()
      AND message_participants.is_active = true
    )
  );

CREATE POLICY "Users can edit their own messages"
  ON messages
  FOR UPDATE
  TO authenticated
  USING (sender_id = auth.uid());

-- Función para crear conversación con participantes (parámetros corregidos)
CREATE OR REPLACE FUNCTION create_conversation_with_participants(
  p_title text,
  p_type text,
  p_booking_id uuid,
  p_tour_id uuid,
  p_participant_ids uuid[]
)
RETURNS uuid AS $$
DECLARE
  conversation_id uuid;
  participant_id uuid;
BEGIN
  -- Crear la conversación
  INSERT INTO conversations (title, type, booking_id, tour_id, created_by)
  VALUES (p_title, COALESCE(p_type, 'general'), p_booking_id, p_tour_id, auth.uid())
  RETURNING id INTO conversation_id;
  
  -- Agregar el creador como participante
  INSERT INTO message_participants (conversation_id, user_id, role)
  VALUES (conversation_id, auth.uid(), 'moderator');
  
  -- Agregar otros participantes
  IF p_participant_ids IS NOT NULL THEN
    FOREACH participant_id IN ARRAY p_participant_ids
    LOOP
      INSERT INTO message_participants (conversation_id, user_id)
      VALUES (conversation_id, participant_id)
      ON CONFLICT (conversation_id, user_id) DO NOTHING;
    END LOOP;
  END IF;
  
  RETURN conversation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función sobrecargada para crear conversación simple
CREATE OR REPLACE FUNCTION create_conversation_with_participants(
  p_title text,
  p_participant_ids uuid[]
)
RETURNS uuid AS $$
BEGIN
  RETURN create_conversation_with_participants(p_title, 'general', NULL, NULL, p_participant_ids);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función para marcar mensajes como leídos
CREATE OR REPLACE FUNCTION mark_messages_as_read(
  p_conversation_id uuid
)
RETURNS void AS $$
BEGIN
  UPDATE message_participants
  SET last_read_at = now()
  WHERE conversation_id = p_conversation_id
  AND user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función para obtener conversaciones del usuario con información adicional
CREATE OR REPLACE FUNCTION get_user_conversations()
RETURNS TABLE(
  conversation_id uuid,
  title text,
  type text,
  status text,
  booking_id uuid,
  tour_id uuid,
  last_message_at timestamptz,
  unread_count bigint,
  last_message_content text,
  last_message_sender text,
  participant_count bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id as conversation_id,
    c.title,
    c.type,
    c.status,
    c.booking_id,
    c.tour_id,
    c.last_message_at,
    COALESCE(
      (SELECT COUNT(*)
       FROM messages m
       WHERE m.conversation_id = c.id
       AND m.created_at > mp.last_read_at), 0
    ) as unread_count,
    (SELECT m.content
     FROM messages m
     WHERE m.conversation_id = c.id
     ORDER BY m.created_at DESC
     LIMIT 1) as last_message_content,
    (SELECT CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))
     FROM messages m
     JOIN users u ON m.sender_id = u.id
     WHERE m.conversation_id = c.id
     ORDER BY m.created_at DESC
     LIMIT 1) as last_message_sender,
    (SELECT COUNT(*)
     FROM message_participants mp2
     WHERE mp2.conversation_id = c.id
     AND mp2.is_active = true) as participant_count
  FROM conversations c
  JOIN message_participants mp ON c.id = mp.conversation_id
  WHERE mp.user_id = auth.uid()
  AND mp.is_active = true
  ORDER BY c.last_message_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger para actualizar last_message_at en conversations
CREATE OR REPLACE FUNCTION update_conversation_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations
  SET 
    last_message_at = NEW.created_at,
    updated_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_conversation_last_message_trigger ON messages;
CREATE TRIGGER update_conversation_last_message_trigger
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_last_message();

-- Trigger para marcar mensajes como editados
CREATE OR REPLACE FUNCTION mark_message_edited()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.content != NEW.content THEN
    NEW.is_edited = true;
    NEW.edited_at = now();
    NEW.updated_at = now();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mark_message_edited_trigger ON messages;
CREATE TRIGGER mark_message_edited_trigger
  BEFORE UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION mark_message_edited();

-- Vista para administradores - todas las conversaciones
CREATE OR REPLACE VIEW admin_conversations AS
SELECT 
  c.id,
  c.title,
  c.type,
  c.status,
  c.booking_id,
  c.tour_id,
  c.created_at,
  c.last_message_at,
  CONCAT(COALESCE(creator.first_name, ''), ' ', COALESCE(creator.last_name, '')) as created_by_name,
  creator.email as created_by_email,
  creator.role as created_by_role,
  (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count,
  (SELECT COUNT(*) FROM message_participants WHERE conversation_id = c.id AND is_active = true) as participant_count,
  CASE 
    WHEN c.booking_id IS NOT NULL THEN 
      (SELECT tours.name FROM bookings JOIN tours ON bookings.tour_id = tours.id WHERE bookings.id = c.booking_id)
    WHEN c.tour_id IS NOT NULL THEN
      (SELECT name FROM tours WHERE id = c.tour_id)
    ELSE NULL
  END as related_tour_name
FROM conversations c
JOIN users creator ON c.created_by = creator.id
ORDER BY c.last_message_at DESC;

-- Comentarios para documentación
COMMENT ON TABLE conversations IS 'Conversaciones entre usuarios de la plataforma';
COMMENT ON TABLE message_participants IS 'Participantes en conversaciones';
COMMENT ON TABLE messages IS 'Mensajes individuales en conversaciones';

COMMENT ON COLUMN conversations.type IS 'Tipo de conversación: booking (relacionada con reserva), general, support';
COMMENT ON COLUMN conversations.status IS 'Estado: active, closed, archived';
COMMENT ON COLUMN messages.message_type IS 'Tipo de mensaje: text, system, attachment';
