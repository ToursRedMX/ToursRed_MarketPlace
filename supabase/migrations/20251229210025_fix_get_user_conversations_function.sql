
CREATE OR REPLACE FUNCTION public.get_user_conversations()
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
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
       FROM public.messages m
       WHERE m.conversation_id = c.id
       AND m.created_at > mp.last_read_at), 0
    ) as unread_count,
    (SELECT m.content
     FROM public.messages m
     WHERE m.conversation_id = c.id
     ORDER BY m.created_at DESC
     LIMIT 1) as last_message_content,
    (SELECT CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))
     FROM public.messages m
     JOIN public.users u ON m.sender_id = u.id
     WHERE m.conversation_id = c.id
     ORDER BY m.created_at DESC
     LIMIT 1) as last_message_sender,
    (SELECT COUNT(*)
     FROM public.message_participants mp2
     WHERE mp2.conversation_id = c.id
     AND mp2.is_active = true) as participant_count
  FROM public.conversations c
  JOIN public.message_participants mp ON c.id = mp.conversation_id
  WHERE mp.user_id = auth.uid()
  AND mp.is_active = true
  ORDER BY c.last_message_at DESC;
END;
$$;
