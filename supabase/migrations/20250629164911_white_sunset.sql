-- Drop the existing functions first to change their signatures
DROP FUNCTION IF EXISTS get_user_notifications(integer, integer, boolean);
DROP FUNCTION IF EXISTS create_conversation_with_participants(text, text, uuid, uuid, uuid[]);

-- Fix the get_user_notifications function
CREATE OR REPLACE FUNCTION get_user_notifications(
  limit_count integer DEFAULT 20,
  offset_count integer DEFAULT 0,
  include_read boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  type notification_type,
  title text,
  message text,
  data jsonb,
  is_read boolean,
  created_at timestamptz,
  updated_at timestamptz,
  expires_at timestamptz,
  is_expired boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    n.*,
    CASE 
      WHEN n.expires_at IS NOT NULL AND n.expires_at <= now() THEN true
      ELSE false
    END as is_expired
  FROM notifications n
  WHERE n.user_id = auth.uid()
    AND (include_read OR n.is_read = false)
    AND (n.expires_at IS NULL OR n.expires_at > now())
  ORDER BY n.created_at DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$;

-- Create function to handle booking approval notifications
CREATE OR REPLACE FUNCTION handle_booking_approval_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  tour_name text;
  agency_name text;
  traveler_id uuid;
  agency_user_id uuid;
BEGIN
  -- Get tour name
  SELECT t.name INTO tour_name
  FROM tours t
  WHERE t.id = NEW.tour_id;
  
  -- Get agency name and user_id
  SELECT a.name, a.user_id INTO agency_name, agency_user_id
  FROM agencies a
  WHERE a.id = NEW.agency_id;
  
  -- Get traveler id
  SELECT user_id INTO traveler_id
  FROM bookings
  WHERE id = NEW.id;

  -- Handle approval status changes
  IF TG_OP = 'INSERT' THEN
    -- New booking with pending approval
    IF NEW.approval_status = 'pending' THEN
      -- Notify agency about pending approval
      PERFORM create_user_notification(
        agency_user_id,
        'booking_pending_approval'::notification_type,
        'Nueva solicitud de reserva',
        'Tienes una nueva solicitud de reserva para ' || tour_name || ' que requiere tu aprobación.',
        jsonb_build_object(
          'booking_id', NEW.id,
          'tour_id', NEW.tour_id,
          'tour_name', tour_name
        )
      );
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Approval status changed
    IF NEW.approval_status != OLD.approval_status THEN
      IF NEW.approval_status = 'approved' THEN
        -- Notify traveler about approval
        PERFORM create_user_notification(
          traveler_id,
          'booking_approved'::notification_type,
          'Reserva aprobada',
          'Tu solicitud de reserva para ' || tour_name || ' ha sido aprobada por ' || agency_name || '. Ahora puedes proceder con el pago.',
          jsonb_build_object(
            'booking_id', NEW.id,
            'tour_id', NEW.tour_id,
            'tour_name', tour_name,
            'agency_name', agency_name
          )
        );
      ELSIF NEW.approval_status = 'rejected' THEN
        -- Notify traveler about rejection
        PERFORM create_user_notification(
          traveler_id,
          'booking_rejected'::notification_type,
          'Reserva rechazada',
          'Lo sentimos, tu solicitud de reserva para ' || tour_name || ' ha sido rechazada por ' || agency_name || '.' || 
          CASE WHEN NEW.approval_notes IS NOT NULL THEN ' Motivo: ' || NEW.approval_notes ELSE '' END,
          jsonb_build_object(
            'booking_id', NEW.id,
            'tour_id', NEW.tour_id,
            'tour_name', tour_name,
            'agency_name', agency_name,
            'notes', NEW.approval_notes
          )
        );
      END IF;
    END IF;
    
    -- Payment status changed to succeeded
    IF NEW.payment_status = 'succeeded' AND OLD.payment_status != 'succeeded' THEN
      -- Notify agency about payment
      PERFORM create_user_notification(
        agency_user_id,
        'booking_confirmed'::notification_type,
        'Pago recibido para reserva',
        'Se ha recibido el pago para la reserva de ' || tour_name || '. El depósito ha sido procesado correctamente.',
        jsonb_build_object(
          'booking_id', NEW.id,
          'tour_id', NEW.tour_id,
          'tour_name', tour_name,
          'amount', NEW.deposit_amount
        )
      );
      
      -- Notify traveler about payment confirmation
      PERFORM create_user_notification(
        traveler_id,
        'booking_confirmed'::notification_type,
        'Pago confirmado',
        'Tu pago para ' || tour_name || ' ha sido procesado correctamente. La reserva está confirmada.',
        jsonb_build_object(
          'booking_id', NEW.id,
          'tour_id', NEW.tour_id,
          'tour_name', tour_name,
          'amount', NEW.user_payment
        )
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create function to get user conversations
CREATE OR REPLACE FUNCTION get_user_conversations()
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
AS $$
BEGIN
  RETURN QUERY
  WITH user_convos AS (
    -- Get conversations where user is a participant
    SELECT c.id
    FROM conversations c
    JOIN message_participants mp ON c.id = mp.conversation_id
    WHERE mp.user_id = auth.uid() AND mp.is_active = true
    UNION
    -- Get conversations created by the user
    SELECT c.id
    FROM conversations c
    WHERE c.created_by = auth.uid()
  ),
  last_messages AS (
    -- Get the last message for each conversation
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id,
      m.content,
      u.first_name || CASE WHEN u.last_name IS NOT NULL THEN ' ' || u.last_name ELSE '' END AS sender_name
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.conversation_id IN (SELECT id FROM user_convos)
    ORDER BY m.conversation_id, m.created_at DESC
  ),
  unread_counts AS (
    -- Count unread messages for each conversation
    SELECT 
      m.conversation_id,
      COUNT(*) AS count
    FROM messages m
    LEFT JOIN message_participants mp ON m.conversation_id = mp.conversation_id AND mp.user_id = auth.uid()
    WHERE m.conversation_id IN (SELECT id FROM user_convos)
      AND m.created_at > COALESCE(mp.last_read_at, '1970-01-01'::timestamptz)
      AND m.sender_id != auth.uid()
    GROUP BY m.conversation_id
  ),
  participant_counts AS (
    -- Count participants in each conversation
    SELECT 
      mp.conversation_id,
      COUNT(DISTINCT mp.user_id) AS count
    FROM message_participants mp
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
  FROM conversations c
  LEFT JOIN last_messages lm ON c.id = lm.conversation_id
  LEFT JOIN unread_counts uc ON c.id = uc.conversation_id
  LEFT JOIN participant_counts pc ON c.id = pc.conversation_id
  WHERE c.id IN (SELECT id FROM user_convos)
  ORDER BY c.last_message_at DESC;
END;
$$;

-- Create function to create a conversation with participants
CREATE OR REPLACE FUNCTION create_conversation_with_participants(
  p_title text,
  p_type text,
  p_booking_id uuid DEFAULT NULL,
  p_tour_id uuid DEFAULT NULL,
  p_participant_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_conversation_id uuid;
  v_participant_id uuid;
BEGIN
  -- Create the conversation
  INSERT INTO conversations (
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
  
  -- Add the creator as a participant
  INSERT INTO message_participants (
    conversation_id,
    user_id,
    role,
    is_active
  ) VALUES (
    v_conversation_id,
    auth.uid(),
    'participant',
    true
  );
  
  -- Add other participants
  FOREACH v_participant_id IN ARRAY p_participant_ids
  LOOP
    -- Skip if participant is the creator
    IF v_participant_id != auth.uid() THEN
      INSERT INTO message_participants (
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
  
  RETURN v_conversation_id;
END;
$$;

-- Create function to mark messages as read
CREATE OR REPLACE FUNCTION mark_messages_as_read(
  p_conversation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  success boolean;
BEGIN
  -- Update the last_read_at timestamp for the user in this conversation
  UPDATE message_participants
  SET last_read_at = now()
  WHERE conversation_id = p_conversation_id
    AND user_id = auth.uid();
  
  GET DIAGNOSTICS success = ROW_COUNT;
  RETURN success > 0;
END;
$$;

-- Create function to update conversation last message
CREATE OR REPLACE FUNCTION update_conversation_last_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Update the conversation's last_message_at timestamp
  UPDATE conversations
  SET last_message_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  
  RETURN NEW;
END;
$$;

-- Create function to mark message as edited
CREATE OR REPLACE FUNCTION mark_message_edited()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only set is_edited and edited_at if content is changed
  IF NEW.content != OLD.content THEN
    NEW.is_edited = true;
    NEW.edited_at = now();
  END IF;
  
  RETURN NEW;
END;
$$;
