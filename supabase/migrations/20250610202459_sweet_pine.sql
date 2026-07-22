-- Drop existing problematic policies
DROP POLICY IF EXISTS "Users can view participants in their conversations" ON message_participants;
DROP POLICY IF EXISTS "Users can join conversations" ON message_participants;

-- Create simplified, non-recursive policies for message_participants
CREATE POLICY "Users can view participants in their conversations" 
  ON message_participants 
  FOR SELECT 
  TO authenticated 
  USING (
    user_id = auth.uid() 
    OR EXISTS (
      SELECT 1 
      FROM message_participants mp2 
      WHERE mp2.conversation_id = message_participants.conversation_id 
        AND mp2.user_id = auth.uid() 
        AND mp2.is_active = true
    )
    OR EXISTS (
      SELECT 1 
      FROM users u 
      WHERE u.id = auth.uid() 
        AND u.role = 'admin'
    )
  );

CREATE POLICY "Users can join conversations" 
  ON message_participants 
  FOR INSERT 
  TO authenticated 
  WITH CHECK (
    user_id = auth.uid() 
    OR EXISTS (
      SELECT 1 
      FROM conversations c 
      WHERE c.id = message_participants.conversation_id 
        AND c.created_by = auth.uid()
    )
  );

-- Drop and recreate the create_conversation_with_participants function with proper column qualifications
DROP FUNCTION IF EXISTS create_conversation_with_participants(text, text, uuid, uuid, uuid[]);

CREATE OR REPLACE FUNCTION create_conversation_with_participants(
  p_title text,
  p_type text DEFAULT 'general',
  p_booking_id uuid DEFAULT NULL,
  p_tour_id uuid DEFAULT NULL,
  p_participant_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_conversation_id uuid;
  v_participant_id uuid;
BEGIN
  -- Insert the conversation
  INSERT INTO conversations (title, type, booking_id, tour_id, created_by)
  VALUES (p_title, p_type, p_booking_id, p_tour_id, auth.uid())
  RETURNING id INTO v_conversation_id;
  
  -- Add the creator as a participant
  INSERT INTO message_participants (conversation_id, user_id, role)
  VALUES (v_conversation_id, auth.uid(), 'moderator');
  
  -- Add other participants if provided
  IF array_length(p_participant_ids, 1) > 0 THEN
    FOREACH v_participant_id IN ARRAY p_participant_ids
    LOOP
      -- Avoid adding the creator twice
      IF v_participant_id != auth.uid() THEN
        INSERT INTO message_participants (conversation_id, user_id, role)
        VALUES (v_conversation_id, v_participant_id, 'participant')
        ON CONFLICT (conversation_id, user_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;
  
  RETURN v_conversation_id;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION create_conversation_with_participants(text, text, uuid, uuid, uuid[]) TO authenticated;
