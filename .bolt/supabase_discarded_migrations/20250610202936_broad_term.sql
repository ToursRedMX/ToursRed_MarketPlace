/*
  # Fix RLS Policies for Message System

  1. Security Changes
    - Remove circular dependencies in message_participants policies
    - Simplify policies to prevent infinite recursion
    - Ensure proper access control without complex joins

  2. Policy Updates
    - Simplify message_participants policies
    - Fix conversations and messages policies
    - Remove recursive references
*/

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Users can view participants in their conversations" ON message_participants;
DROP POLICY IF EXISTS "Users can join conversations" ON message_participants;
DROP POLICY IF EXISTS "Users can update their participation" ON message_participants;

-- Drop and recreate conversations policies to ensure they're correct
DROP POLICY IF EXISTS "Users can view conversations they participate in" ON conversations;
DROP POLICY IF EXISTS "Participants can update conversation status" ON conversations;

-- Drop and recreate messages policies to ensure they're correct
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON messages;
DROP POLICY IF EXISTS "Users can send messages in their conversations" ON messages;

-- Create simplified message_participants policies
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

-- Create simplified conversations policies
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

-- Create simplified messages policies
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

-- Keep admin policies separate and simple
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