
-- Returns conflict info for email and/or RFC when registering a lead.
-- SECURITY DEFINER so the caller (any authenticated executive) can check
-- across ALL leads and agencies regardless of RLS.
CREATE OR REPLACE FUNCTION check_lead_duplicate(
  p_email    text,
  p_rfc      text    DEFAULT NULL,
  p_exclude_lead_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email_lead_agency  text;
  v_email_lead_exec    text;
  v_rfc_lead_agency    text;
  v_email_agency_name  text;
  v_rfc_agency_name    text;
  v_result             jsonb := '{}'::jsonb;
BEGIN
  -- ── Email: check other leads ─────────────────────────────────────────────
  IF p_email IS NOT NULL AND trim(p_email) <> '' THEN
    SELECT al.agency_name,
           coalesce(u.first_name || ' ' || u.last_name, 'otro ejecutivo')
      INTO v_email_lead_agency, v_email_lead_exec
      FROM agency_leads al
      LEFT JOIN account_executives ae ON ae.id = al.executive_id
      LEFT JOIN users u ON u.id = ae.user_id
     WHERE lower(al.contact_email) = lower(trim(p_email))
       AND (p_exclude_lead_id IS NULL OR al.id <> p_exclude_lead_id)
     LIMIT 1;

    IF v_email_lead_agency IS NOT NULL THEN
      v_result := v_result || jsonb_build_object('email_conflict', jsonb_build_object(
        'type',           'lead',
        'agency_name',    v_email_lead_agency,
        'executive_name', v_email_lead_exec
      ));
    ELSE
      -- ── Email: check registered agencies ─────────────────────────────────
      SELECT a.name
        INTO v_email_agency_name
        FROM users usr
        JOIN agencies a ON a.user_id = usr.id
       WHERE lower(usr.email) = lower(trim(p_email))
       LIMIT 1;

      IF v_email_agency_name IS NOT NULL THEN
        v_result := v_result || jsonb_build_object('email_conflict', jsonb_build_object(
          'type',        'agency',
          'agency_name', v_email_agency_name
        ));
      END IF;
    END IF;
  END IF;

  -- ── RFC: check other leads ────────────────────────────────────────────────
  IF p_rfc IS NOT NULL AND trim(p_rfc) <> '' THEN
    SELECT al.agency_name
      INTO v_rfc_lead_agency
      FROM agency_leads al
     WHERE upper(trim(al.rfc)) = upper(trim(p_rfc))
       AND (p_exclude_lead_id IS NULL OR al.id <> p_exclude_lead_id)
     LIMIT 1;

    IF v_rfc_lead_agency IS NOT NULL THEN
      v_result := v_result || jsonb_build_object('rfc_conflict', jsonb_build_object(
        'type',        'lead',
        'agency_name', v_rfc_lead_agency
      ));
    ELSE
      -- ── RFC: check registered agencies ───────────────────────────────────
      SELECT a.name
        INTO v_rfc_agency_name
        FROM agencies a
       WHERE upper(trim(a.rfc)) = upper(trim(p_rfc))
       LIMIT 1;

      IF v_rfc_agency_name IS NOT NULL THEN
        v_result := v_result || jsonb_build_object('rfc_conflict', jsonb_build_object(
          'type',        'agency',
          'agency_name', v_rfc_agency_name
        ));
      END IF;
    END IF;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION check_lead_duplicate(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION check_lead_duplicate(text, text, uuid) TO authenticated;
