
CREATE POLICY "Users can view other participants in their conversations"
  ON users FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM message_participants mp1
      JOIN message_participants mp2 ON mp1.conversation_id = mp2.conversation_id
      WHERE mp1.user_id = auth.uid()
      AND mp2.user_id = users.id
    )
  );
