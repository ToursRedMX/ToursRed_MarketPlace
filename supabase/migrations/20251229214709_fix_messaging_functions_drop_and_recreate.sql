
-- Eliminar todas las versiones posibles de la función
DROP FUNCTION IF EXISTS get_user_conversations();
DROP FUNCTION IF EXISTS get_user_conversations(uuid);
DROP FUNCTION IF EXISTS get_user_conversations(p_user_id uuid);

-- Crear la función con una sola firma que soporte ambos casos
CREATE OR REPLACE FUNCTION get_user_conversations(p_user_id uuid DEFAULT NULL)
RETURNS TABLE (
  conversation_id uuid,
  topic text,
  status text,
  tour_id uuid,
  tour_title text,
  unread_count bigint,
  last_message_content text,
  last_message_at timestamptz,
  last_sender_name text,
  participant_count bigint,
  other_participant_id uuid,
  other_participant_name text,
  other_participant_email text,
  other_participant_role text
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_user_role text;
  v_target_user_id uuid;
  v_is_admin boolean;
BEGIN
  -- Determinar el usuario objetivo
  v_target_user_id := COALESCE(p_user_id, auth.uid());

  -- Obtener el rol del usuario actual
  SELECT u.role, (u.role = 'admin') 
  INTO v_user_role, v_is_admin
  FROM users u
  WHERE u.id = auth.uid();

  -- Si no es admin, solo puede ver sus propias conversaciones
  IF NOT v_is_admin AND v_target_user_id != auth.uid() THEN
    RAISE EXCEPTION 'No tienes permiso para ver estas conversaciones';
  END IF;

  -- Retornar conversaciones
  RETURN QUERY
  SELECT 
    c.id as conversation_id,
    c.topic,
    c.status,
    c.tour_id,
    t.title as tour_title,
    COALESCE(
      COUNT(m.id) FILTER (
        WHERE m.sender_id != v_target_user_id 
        AND m.created_at > COALESCE(mp_user.last_read_at, '1970-01-01'::timestamptz)
      ), 
      0
    )::bigint as unread_count,
    latest.content as last_message_content,
    latest.created_at as last_message_at,
    latest_sender.first_name || ' ' || latest_sender.last_name as last_sender_name,
    COUNT(DISTINCT mp_all.user_id)::bigint as participant_count,
    other_user.other_id as other_participant_id,
    other_user.other_first_name || ' ' || other_user.other_last_name as other_participant_name,
    other_user.other_email as other_participant_email,
    other_user.other_role as other_participant_role
  FROM conversations c
  LEFT JOIN message_participants mp_user 
    ON c.id = mp_user.conversation_id AND mp_user.user_id = v_target_user_id
  LEFT JOIN messages m 
    ON c.id = m.conversation_id
  LEFT JOIN tours t 
    ON c.tour_id = t.id
  LEFT JOIN message_participants mp_all 
    ON c.id = mp_all.conversation_id
  LEFT JOIN LATERAL (
    SELECT m2.content, m2.created_at, m2.sender_id
    FROM messages m2
    WHERE m2.conversation_id = c.id
    ORDER BY m2.created_at DESC
    LIMIT 1
  ) latest ON true
  LEFT JOIN users latest_sender 
    ON latest.sender_id = latest_sender.id
  LEFT JOIN LATERAL (
    SELECT 
      u.id as other_id, 
      u.first_name as other_first_name, 
      u.last_name as other_last_name, 
      u.email as other_email, 
      u.role as other_role
    FROM message_participants mp3
    JOIN users u ON mp3.user_id = u.id
    WHERE mp3.conversation_id = c.id AND mp3.user_id != v_target_user_id
    LIMIT 1
  ) other_user ON true
  WHERE v_is_admin OR mp_user.user_id IS NOT NULL
  GROUP BY 
    c.id, 
    c.topic, 
    c.status, 
    c.tour_id,
    t.title,
    mp_user.last_read_at,
    latest.content,
    latest.created_at,
    latest_sender.first_name,
    latest_sender.last_name,
    other_user.other_id,
    other_user.other_first_name,
    other_user.other_last_name,
    other_user.other_email,
    other_user.other_role
  ORDER BY COALESCE(latest.created_at, c.created_at) DESC;
END;
$$;
