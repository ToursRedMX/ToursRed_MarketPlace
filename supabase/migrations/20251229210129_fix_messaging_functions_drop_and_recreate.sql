
-- Eliminar funciones existentes
DROP FUNCTION IF EXISTS public.mark_messages_as_read(uuid);
DROP FUNCTION IF EXISTS public.create_conversation_with_participants(text, text, uuid, uuid, uuid[]);
DROP FUNCTION IF EXISTS public.get_user_conversations();

-- Recrear get_user_conversations con search_path
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
      u.first_name || CASE WHEN u.last_name IS NOT NULL THEN ' ' || u.last_name ELSE '' END AS sender_name
    FROM public.messages m
    JOIN public.users u ON m.sender_id = u.id
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

-- Recrear create_conversation_with_participants con search_path
CREATE OR REPLACE FUNCTION public.create_conversation_with_participants(
  p_title text,
  p_type text,
  p_booking_id uuid DEFAULT NULL,
  p_tour_id uuid DEFAULT NULL,
  p_participant_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
  v_participant_id uuid;
BEGIN
  INSERT INTO public.conversations (
    title,
    type,
    booking_id,
    tour_id,
    status,
    created_by
  ) VALUES (
    p_title,
    p_type,
    p_booking_id,
    p_tour_id,
    'active',
    auth.uid()
  ) RETURNING id INTO v_conversation_id;

  INSERT INTO public.message_participants (
    conversation_id,
    user_id,
    role,
    is_active
  ) VALUES (
    v_conversation_id,
    auth.uid(),
    'moderator',
    true
  );

  IF p_participant_ids IS NOT NULL AND array_length(p_participant_ids, 1) > 0 THEN
    FOREACH v_participant_id IN ARRAY p_participant_ids
    LOOP
      IF v_participant_id != auth.uid() THEN
        INSERT INTO public.message_participants (
          conversation_id,
          user_id,
          role,
          is_active
        ) VALUES (
          v_conversation_id,
          v_participant_id,
          'participant',
          true
        );
      END IF;
    END LOOP;
  END IF;

  RETURN v_conversation_id;
END;
$$;

-- Recrear mark_messages_as_read con search_path
CREATE OR REPLACE FUNCTION public.mark_messages_as_read(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.message_participants
  SET last_read_at = now()
  WHERE conversation_id = p_conversation_id
    AND user_id = auth.uid();
END;
$$;
