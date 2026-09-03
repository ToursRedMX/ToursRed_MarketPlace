-- ============================================================
-- 1. is_admin_user()
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_user() TO authenticated;

-- ============================================================
-- 2. is_conversation_participant()
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_conversation_participant(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.message_participants
    WHERE conversation_id = p_conversation_id AND user_id = auth.uid()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_conversation_participant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_conversation_participant(uuid) TO authenticated;

-- ============================================================
-- 3. _get_user_conversations_internal() — función interna, DROP + RECREATE
-- ============================================================
DROP FUNCTION IF EXISTS public._get_user_conversations_internal(uuid);

CREATE FUNCTION public._get_user_conversations_internal(p_user_id uuid)
RETURNS TABLE(
  conversation_id uuid,
  title text,
  type text,
  status text,
  booking_id uuid,
  tour_id uuid,
  tour_title text,
  unread_count bigint,
  last_message_content text,
  last_message_at timestamptz,
  last_message_sender text,
  participant_count bigint,
  other_participant_id uuid,
  other_participant_name text,
  other_participant_email text,
  other_participant_role text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_role text;
  v_is_admin boolean;
BEGIN
  SELECT u.role, (u.role = 'admin')
  INTO v_user_role, v_is_admin
  FROM public.users u
  WHERE u.id = auth.uid();

  IF NOT v_is_admin AND p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'No tienes permiso para ver estas conversaciones';
  END IF;

  RETURN QUERY
  SELECT
    c.id as conversation_id,
    c.title,
    c.type,
    c.status,
    c.booking_id,
    c.tour_id,
    t.name as tour_title,
    COALESCE(
      COUNT(m.id) FILTER (
        WHERE m.sender_id != p_user_id
        AND m.created_at > COALESCE(mp_user.last_read_at, '1970-01-01'::timestamptz)
      ),
      0
    )::bigint as unread_count,
    latest.content as last_message_content,
    latest.created_at as last_message_at,
    CASE
      WHEN latest_sender.role = 'agency' THEN COALESCE(a.name, latest_sender.first_name || ' ' || latest_sender.last_name)
      ELSE latest_sender.first_name || ' ' || latest_sender.last_name
    END as last_message_sender,
    COUNT(DISTINCT mp_all.user_id)::bigint as participant_count,
    other_user.other_id as other_participant_id,
    other_user.other_first_name || ' ' || other_user.other_last_name as other_participant_name,
    other_user.other_email as other_participant_email,
    other_user.other_role as other_participant_role
  FROM public.conversations c
  LEFT JOIN public.message_participants mp_user
    ON c.id = mp_user.conversation_id AND mp_user.user_id = p_user_id
  LEFT JOIN public.messages m
    ON c.id = m.conversation_id
  LEFT JOIN public.tours t
    ON c.tour_id = t.id
  LEFT JOIN public.message_participants mp_all
    ON c.id = mp_all.conversation_id
  LEFT JOIN LATERAL (
    SELECT m2.content, m2.created_at, m2.sender_id
    FROM public.messages m2
    WHERE m2.conversation_id = c.id
    ORDER BY m2.created_at DESC
    LIMIT 1
  ) latest ON true
  LEFT JOIN public.users latest_sender
    ON latest.sender_id = latest_sender.id
  LEFT JOIN public.agencies a
    ON latest_sender.id = a.user_id AND latest_sender.role = 'agency'
  LEFT JOIN LATERAL (
    SELECT
      u.id as other_id,
      u.first_name as other_first_name,
      u.last_name as other_last_name,
      u.email as other_email,
      u.role as other_role
    FROM public.message_participants mp3
    JOIN public.users u ON mp3.user_id = u.id
    WHERE mp3.conversation_id = c.id AND mp3.user_id != p_user_id
    LIMIT 1
  ) other_user ON true
  WHERE v_is_admin OR mp_user.user_id IS NOT NULL
  GROUP BY
    c.id, c.title, c.type, c.status, c.booking_id, c.tour_id, t.name,
    mp_user.last_read_at, latest.content, latest.created_at,
    latest_sender.first_name, latest_sender.last_name, latest_sender.role,
    a.name, other_user.other_id, other_user.other_first_name,
    other_user.other_last_name, other_user.other_email, other_user.other_role
  ORDER BY COALESCE(latest.created_at, c.created_at) DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._get_user_conversations_internal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._get_user_conversations_internal(uuid) TO authenticated;

-- ============================================================
-- 4. get_user_conversations() — DROP + RECREATE con SECURITY DEFINER
-- ============================================================
DROP FUNCTION IF EXISTS public.get_user_conversations();

CREATE FUNCTION public.get_user_conversations()
RETURNS TABLE(
  conversation_id uuid,
  title text,
  type text,
  status text,
  booking_id uuid,
  tour_id uuid,
  tour_title text,
  unread_count bigint,
  last_message_content text,
  last_message_at timestamptz,
  last_message_sender text,
  participant_count bigint,
  other_participant_id uuid,
  other_participant_name text,
  other_participant_email text,
  other_participant_role text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY SELECT * FROM public._get_user_conversations_internal(auth.uid());
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_conversations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_conversations() TO authenticated;
