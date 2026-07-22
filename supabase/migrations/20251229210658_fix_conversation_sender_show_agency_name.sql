

CREATE OR REPLACE FUNCTION public.get_user_conversations()
RETURNS TABLE (
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
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH user_convos AS (
    SELECT c.id
    FROM public.conversations c
    JOIN public.message_participants mp ON c.id = mp.conversation_id
    WHERE mp.user_id = auth.uid() AND mp.is_active = true
    UNION
    SELECT c.id
    FROM public.conversations c
    WHERE c.created_by = auth.uid()
  ),
  last_messages AS (
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id,
      m.content,
      CASE 
        WHEN u.role = 'agency' THEN COALESCE(a.name, u.first_name || CASE WHEN u.last_name IS NOT NULL THEN ' ' || u.last_name ELSE '' END)
        ELSE u.first_name || CASE WHEN u.last_name IS NOT NULL THEN ' ' || u.last_name ELSE '' END
      END AS sender_name
    FROM public.messages m
    JOIN public.users u ON m.sender_id = u.id
    LEFT JOIN public.agencies a ON u.id = a.user_id AND u.role = 'agency'
    WHERE m.conversation_id IN (SELECT id FROM user_convos)
    ORDER BY m.conversation_id, m.created_at DESC
  ),
  unread_counts AS (
    SELECT 
      m.conversation_id,
      COUNT(*) AS count
    FROM public.messages m
    LEFT JOIN public.message_participants mp ON m.conversation_id = mp.conversation_id AND mp.user_id = auth.uid()
    WHERE m.conversation_id IN (SELECT id FROM user_convos)
      AND m.created_at > COALESCE(mp.last_read_at, '1970-01-01'::timestamptz)
      AND m.sender_id != auth.uid()
    GROUP BY m.conversation_id
  ),
  participant_counts AS (
    SELECT 
      mp.conversation_id,
      COUNT(DISTINCT mp.user_id) AS count
    FROM public.message_participants mp
    WHERE mp.conversation_id IN (SELECT id FROM user_convos)
      AND mp.is_active = true
    GROUP BY mp.conversation_id
  )
  
  SELECT 
    c.id AS conversation_id,
    c.title,
    c.type,
    c.status,
    c.booking_id,
    c.tour_id,
    c.last_message_at,
    COALESCE(uc.count, 0)::bigint AS unread_count,
    lm.content AS last_message_content,
    lm.sender_name AS last_message_sender,
    COALESCE(pc.count, 0)::bigint AS participant_count
  FROM public.conversations c
  LEFT JOIN last_messages lm ON c.id = lm.conversation_id
  LEFT JOIN unread_counts uc ON c.id = uc.conversation_id
  LEFT JOIN participant_counts pc ON c.id = pc.conversation_id
  WHERE c.id IN (SELECT id FROM user_convos)
  ORDER BY c.last_message_at DESC;
END;
$$;
