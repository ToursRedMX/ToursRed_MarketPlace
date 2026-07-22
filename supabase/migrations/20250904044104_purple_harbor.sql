
-- Function to get unread notifications count for current user
CREATE OR REPLACE FUNCTION public.get_unread_notifications_count()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    unread_count integer;
BEGIN
    -- Check if user is authenticated
    IF auth.uid() IS NULL THEN
        RETURN 0;
    END IF;
    
    SELECT COUNT(*)
    INTO unread_count
    FROM public.notifications
    WHERE user_id = auth.uid() 
      AND is_read = FALSE
      AND (expires_at IS NULL OR expires_at > NOW());
    
    RETURN COALESCE(unread_count, 0);
END;
$function$;

-- Function to get user notifications with pagination
CREATE OR REPLACE FUNCTION public.get_user_notifications(
    limit_count integer DEFAULT 10,
    offset_count integer DEFAULT 0,
    include_read boolean DEFAULT true
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
AS $function$
BEGIN
    -- Check if user is authenticated
    IF auth.uid() IS NULL THEN
        RETURN;
    END IF;
    
    RETURN QUERY
    SELECT 
        n.id,
        n.user_id,
        n.type,
        n.title,
        n.message,
        n.data,
        n.is_read,
        n.created_at,
        n.updated_at,
        n.expires_at,
        CASE 
            WHEN n.expires_at IS NOT NULL AND n.expires_at <= NOW() THEN true
            ELSE false
        END as is_expired
    FROM public.notifications n
    WHERE n.user_id = auth.uid()
      AND (include_read = true OR n.is_read = false)
      AND (n.expires_at IS NULL OR n.expires_at > NOW())
    ORDER BY n.created_at DESC
    LIMIT limit_count
    OFFSET offset_count;
END;
$function$;

-- Function to mark a specific notification as read
CREATE OR REPLACE FUNCTION public.mark_notification_as_read(notification_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    updated_count integer;
BEGIN
    -- Check if user is authenticated
    IF auth.uid() IS NULL THEN
        RETURN false;
    END IF;
    
    UPDATE public.notifications
    SET is_read = true, updated_at = NOW()
    WHERE id = notification_id 
      AND user_id = auth.uid()
      AND is_read = false;
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    
    RETURN updated_count > 0;
END;
$function$;

-- Function to mark all notifications as read for current user
CREATE OR REPLACE FUNCTION public.mark_all_notifications_as_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    updated_count integer;
BEGIN
    -- Check if user is authenticated
    IF auth.uid() IS NULL THEN
        RETURN 0;
    END IF;
    
    UPDATE public.notifications
    SET is_read = true, updated_at = NOW()
    WHERE user_id = auth.uid()
      AND is_read = false
      AND (expires_at IS NULL OR expires_at > NOW());
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    
    RETURN updated_count;
END;
$function$;
