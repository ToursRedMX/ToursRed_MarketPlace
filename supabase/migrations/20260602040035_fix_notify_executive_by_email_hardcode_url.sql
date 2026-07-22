
CREATE OR REPLACE FUNCTION notify_executive_by_email(p_payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- URL y anon key son públicos (no son secretos)
  v_supabase_url TEXT := 'https://huzsedewwzjywcpbkjkm.supabase.co';
  v_anon_key     TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1enNlZGV3d3pqeXdjcGJramttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcwODY3ODksImV4cCI6MjA2MjY2Mjc4OX0.Jrfg9m4qwtIRHKhJ15hV_bqqWCDOYYeX-y1Kt34DGQk';
BEGIN
  PERFORM net.http_post(
    url     := v_supabase_url || '/functions/v1/send-executive-notification',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_anon_key
    ),
    body    := p_payload,
    timeout_milliseconds := 10000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_executive_by_email error: %', SQLERRM;
END;
$$;
