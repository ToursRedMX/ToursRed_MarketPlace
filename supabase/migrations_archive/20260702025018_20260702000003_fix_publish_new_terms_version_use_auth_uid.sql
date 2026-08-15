-- Fix: publish_new_terms_version now uses auth.uid() instead of trusting p_admin_id from client
-- This closes a privilege escalation: any authenticated user could pass a real admin's UUID as p_admin_id

DROP FUNCTION IF EXISTS public.publish_new_terms_version(text, text, text, text, uuid);

CREATE OR REPLACE FUNCTION public.publish_new_terms_version(
  p_type text,
  p_title text,
  p_content text,
  p_change_summary text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_admin_id uuid;
  v_admin_role text;
  v_next_version integer;
  v_new_id uuid;
BEGIN
  v_admin_id := auth.uid();

  SELECT role INTO v_admin_role FROM users WHERE id = v_admin_id;

  IF v_admin_role NOT IN ('admin', 'super_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO v_next_version
  FROM terms_versions
  WHERE terms_type = p_type;

  UPDATE terms_versions
  SET is_active = false
  WHERE terms_type = p_type AND is_active = true;

  INSERT INTO terms_versions (
    terms_type,
    version_number,
    title,
    content,
    change_summary,
    is_active,
    published_at,
    published_by_user_id
  ) VALUES (
    p_type,
    v_next_version,
    p_title,
    p_content,
    p_change_summary,
    true,
    now(),
    v_admin_id
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_new_id,
    'version_number', v_next_version
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_new_terms_version(text, text, text, text) TO authenticated;
