
-- Create a security definer function to check conversation membership
-- This breaks the recursion by bypassing RLS when checking participation
CREATE OR REPLACE FUNCTION public.is_conversation_participant(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM message_participants
    WHERE conversation_id = p_conversation_id
      AND user_id = auth.uid()
  );
$$;

-- Create a security definer function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users
    WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
  );
$$;

-- Drop the recursive policies
DROP POLICY IF EXISTS "Users can view participants in their conversations" ON message_participants;
DROP POLICY IF EXISTS "Users can add participants to their conversations" ON message_participants;

-- Recreate SELECT policy using the security definer function (no recursion)
CREATE POLICY "Users can view participants in their conversations"
  ON message_participants
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.is_conversation_participant(conversation_id)
    OR public.is_admin_user()
  );

-- Recreate INSERT policy: allow creating a conversation (first participant is self)
-- or adding to a conversation you're already in
CREATE POLICY "Users can add participants to their conversations"
  ON message_participants
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    OR public.is_conversation_participant(conversation_id)
    OR public.is_admin_user()
  );

-- Add admin SELECT policy for conversations if not exists
DROP POLICY IF EXISTS "Admins can view all conversations" ON conversations;
CREATE POLICY "Admins can view all conversations"
  ON conversations
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin_user()
    OR id IN (
      SELECT mp.conversation_id
      FROM message_participants mp
      WHERE mp.user_id = (SELECT auth.uid())
    )
  );

-- Drop the old non-admin conversations SELECT policy to avoid conflicts
DROP POLICY IF EXISTS "Users can view their conversations" ON conversations;

-- Add admin SELECT policy for message_participants
DROP POLICY IF EXISTS "Admins can view all message participants" ON message_participants;
CREATE POLICY "Admins can view all message participants"
  ON message_participants
  FOR SELECT
  TO authenticated
  USING (public.is_admin_user());
