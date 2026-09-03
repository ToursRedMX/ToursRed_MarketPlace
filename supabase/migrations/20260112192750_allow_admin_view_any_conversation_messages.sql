
DROP FUNCTION IF EXISTS get_conversation_messages(uuid);

CREATE OR REPLACE FUNCTION get_conversation_messages(p_conversation_id uuid)
RETURNS TABLE (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  content text,
  created_at timestamptz,
  sender_first_name text,
  sender_last_name text,
  sender_email text,
  sender_role text,
  sender_profile_picture text,
  agency_name text
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_user_role text;
  v_is_admin boolean;
  v_is_participant boolean;
BEGIN
  -- Obtener el rol del usuario actual
  SELECT u.role, (u.role = 'admin') INTO v_user_role, v_is_admin
  FROM users u
  WHERE u.id = auth.uid();

  -- Verificar si es participante
  SELECT EXISTS (
    SELECT 1
    FROM message_participants mp
    WHERE mp.conversation_id = p_conversation_id
    AND mp.user_id = auth.uid()
  ) INTO v_is_participant;

  -- Si no es admin ni participante, denegar acceso
  IF NOT v_is_admin AND NOT v_is_participant THEN
    RAISE EXCEPTION 'No tienes acceso a esta conversación';
  END IF;

  RETURN QUERY
  SELECT 
    m.id,
    m.conversation_id,
    m.sender_id,
    m.content,
    m.created_at,
    u.first_name as sender_first_name,
    u.last_name as sender_last_name,
    u.email as sender_email,
    u.role as sender_role,
    u.profile_picture_url as sender_profile_picture,
    a.name as agency_name
  FROM messages m
  JOIN users u ON m.sender_id = u.id
  LEFT JOIN agencies a ON u.id = a.user_id AND u.role = 'agency'
  WHERE m.conversation_id = p_conversation_id
  ORDER BY m.created_at ASC;
END;
$$;
