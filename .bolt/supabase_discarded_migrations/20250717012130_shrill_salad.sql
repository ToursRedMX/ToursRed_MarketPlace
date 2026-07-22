/*
  # Fix messaging policies - Remove duplicates and recreate correctly

  1. Security Changes
    - Drop existing policies safely with IF EXISTS
    - Recreate messaging policies with proper permissions
    - Ensure admin access to all messaging features
    - Fix policy conflicts and duplicates

  2. Tables Affected
    - message_participants (participation policies)
    - conversations (conversation access policies) 
    - messages (message access policies)
*/

-- Drop existing policies safely (using IF EXISTS to avoid errors)
DROP POLICY IF EXISTS "Users can view participants in their conversations" ON message_participants;
DROP POLICY IF EXISTS "Users can join conversations" ON message_participants;
DROP POLICY IF EXISTS "Users can update their participation" ON message_participants;
DROP POLICY IF EXISTS "Users can view their own participation" ON message_participants;
DROP POLICY IF EXISTS "Users can update their own participation" ON message_participants;
DROP POLICY IF EXISTS "Users can join conversations they create or are invited to" ON message_participants;
DROP POLICY IF EXISTS "Admins can view all participants" ON message_participants;

-- Drop existing conversation policies
DROP POLICY IF EXISTS "Users can view conversations they participate in" ON conversations;
DROP POLICY IF EXISTS "Participants can update conversation status" ON conversations;
DROP POLICY IF EXISTS "Users can create conversations" ON conversations;
DROP POLICY IF EXISTS "Admins can view all conversations" ON conversations;

-- Drop existing message policies
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON messages;
DROP POLICY IF EXISTS "Users can send messages in their conversations" ON messages;
DROP POLICY IF EXISTS "Users can edit their own messages" ON messages;
DROP POLICY IF EXISTS "Admins can view all messages" ON messages;

-- Create message_participants policies
CREATE POLICY "Users can view their own participation"
  ON message_participants
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can update their own participation"
  ON message_participants
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can join conversations they create or are invited to"
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

CREATE POLICY "Admins can view all participants"
  ON message_participants
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  );

-- Create conversations policies
CREATE POLICY "Users can view conversations they participate in"
  ON conversations
  FOR SELECT
  TO authenticated
  USING (
    created_by = auth.uid() OR
    id IN (
      SELECT conversation_id 
      FROM message_participants 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Users can create conversations"
  ON conversations
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Participants can update conversation status"
  ON conversations
  FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid() OR
    id IN (
      SELECT conversation_id 
      FROM message_participants 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Admins can view all conversations"
  ON conversations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  );

-- Create messages policies
CREATE POLICY "Users can view messages in their conversations"
  ON messages
  FOR SELECT
  TO authenticated
  USING (
    conversation_id IN (
      SELECT conversation_id 
      FROM message_participants 
      WHERE user_id = auth.uid() AND is_active = true
    ) OR
    conversation_id IN (
      SELECT id 
      FROM conversations 
      WHERE created_by = auth.uid()
    )
  );

CREATE POLICY "Users can send messages in their conversations"
  ON messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid() AND
    (
      conversation_id IN (
        SELECT conversation_id 
        FROM message_participants 
        WHERE user_id = auth.uid() AND is_active = true
      ) OR
      conversation_id IN (
        SELECT id 
        FROM conversations 
        WHERE created_by = auth.uid()
      )
    )
  );

CREATE POLICY "Users can edit their own messages"
  ON messages
  FOR UPDATE
  TO authenticated
  USING (sender_id = auth.uid());

CREATE POLICY "Admins can view all messages"
  ON messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  );