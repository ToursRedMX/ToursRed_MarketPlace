
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id uuid,
  p_type notification_type,
  p_title text,
  p_message text,
  p_data jsonb DEFAULT '{}'::jsonb,
  p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  notification_id uuid;
BEGIN
  INSERT INTO public.notifications (
    user_id,
    type,
    title,
    message,
    data,
    expires_at
  ) VALUES (
    p_user_id,
    p_type,
    p_title,
    p_message,
    p_data,
    p_expires_at
  ) RETURNING id INTO notification_id;

  RETURN notification_id;
END;
$function$;
