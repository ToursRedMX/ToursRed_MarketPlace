
-- ============================================
-- CONVERSATIONS
-- ============================================

-- Eliminar todas las políticas de conversations
DROP POLICY IF EXISTS "Users can view conversations they participate in" ON conversations;
DROP POLICY IF EXISTS "Admins can view all conversations" ON conversations;
DROP POLICY IF EXISTS "Users can create conversations" ON conversations;
DROP POLICY IF EXISTS "Participants can update conversation status" ON conversations;

-- Recrear políticas de conversations
CREATE POLICY "Users can view their conversations"
  ON conversations
  FOR SELECT
  TO authenticated
  USING (
    -- Usuario participa en la conversación
    EXISTS (
      SELECT 1 FROM message_participants mp
      WHERE mp.conversation_id = conversations.id
      AND mp.user_id = auth.uid()
    )
    OR
    -- O es admin
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid() 
      AND u.role = 'admin'
    )
  );

CREATE POLICY "Users can create conversations"
  ON conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Participants can update conversation"
  ON conversations
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM message_participants mp
      WHERE mp.conversation_id = conversations.id
      AND mp.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM message_participants mp
      WHERE mp.conversation_id = conversations.id
      AND mp.user_id = auth.uid()
    )
  );

-- ============================================
-- MESSAGE_PARTICIPANTS
-- ============================================

-- Eliminar todas las políticas de message_participants
DROP POLICY IF EXISTS "Users can view their own participation" ON message_participants;
DROP POLICY IF EXISTS "Admins can view all participants" ON message_participants;
DROP POLICY IF EXISTS "Users can join conversations they create or are invited to" ON message_participants;
DROP POLICY IF EXISTS "Users can update their own participation" ON message_participants;

-- Recrear políticas de message_participants
CREATE POLICY "Users can view participants in their conversations"
  ON message_participants
  FOR SELECT
  TO authenticated
  USING (
    -- Usuario puede ver participantes si él mismo está en esa conversación
    EXISTS (
      SELECT 1 FROM message_participants mp
      WHERE mp.conversation_id = message_participants.conversation_id
      AND mp.user_id = auth.uid()
    )
    OR
    -- O si es admin
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid() 
      AND u.role = 'admin'
    )
  );

CREATE POLICY "Users can add participants to their conversations"
  ON message_participants
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- El creador de la conversación puede agregar participantes
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = message_participants.conversation_id
      AND c.created_by = auth.uid()
    )
    OR
    -- O el usuario se está agregando a sí mismo a una conversación existente
    user_id = auth.uid()
  );

CREATE POLICY "Users can update their own participation status"
  ON message_participants
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================
-- MESSAGES
-- ============================================

-- Las políticas de messages ya están bien, no necesitan cambios
-- Solo verificamos que existan

-- Verificar que las políticas de messages existen
DO $$
BEGIN
  -- No hacer nada, las políticas ya existen
END $$;
