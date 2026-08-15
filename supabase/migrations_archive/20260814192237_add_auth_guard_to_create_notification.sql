/*
# Add defense-in-depth auth guard to create_notification

## Purpose
The create_notification function had no internal authorization check — it relied
solely on REVOKE FROM PUBLIC, authenticated to prevent unauthorized calls.
This adds a defense-in-depth guard: if the caller is an authenticated user
(not service_role/postgres which have auth.uid() = NULL), verify they are
either the recipient themselves or an admin.

## Changes
- Recreates create_notification with an auth guard at the top
- When auth.uid() IS NOT NULL (i.e. called via API as authenticated user):
  - Allows if p_user_id = auth.uid() (self-notification)
  - Allows if caller is an admin (role = 'admin')
  - Otherwise raises exception
- When auth.uid() IS NULL (service_role/postgres via triggers/crons): no restriction

## Security
- Maintains existing SECURITY DEFINER + search_path = ''
- Re-applies REVOKE from PUBLIC, authenticated after function recreation
- Grants EXECUTE to service_role and postgres only
*/

CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id uuid,
  p_type notification_type,
  p_title text,
  p_message text,
  p_data jsonb DEFAULT '{}'::jsonb,
  p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  notification_id uuid;
  v_caller_role text;
BEGIN
  -- Defense-in-depth: if called via API as authenticated user (not service_role),
  -- verify the caller has permission to notify this recipient
  IF auth.uid() IS NOT NULL THEN
    IF p_user_id = auth.uid() THEN
      -- Self-notification is allowed
      NULL;
    ELSE
      -- Check if caller is an admin
      SELECT role INTO v_caller_role FROM public.users WHERE id = auth.uid();
      IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Not authorized to create notification for this user';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, data, expires_at)
  VALUES (p_user_id, p_type, p_title, p_message, p_data, p_expires_at)
  RETURNING id INTO notification_id;

  RETURN notification_id;
END;
$function$;

-- Re-apply the REVOKE to maintain lockdown
REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, notification_type, text, text, jsonb, timestamptz)
  FROM PUBLIC, authenticated;

-- Grant only to service_role and postgres (for triggers and internal use)
GRANT EXECUTE ON FUNCTION public.create_notification(uuid, notification_type, text, text, jsonb, timestamptz)
  TO service_role, postgres;