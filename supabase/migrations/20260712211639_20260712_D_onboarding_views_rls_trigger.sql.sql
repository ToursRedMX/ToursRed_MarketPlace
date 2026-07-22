-- Migration D: admin view, helper function, and auto-status trigger

-- 1. Helper: get agency onboarding_status for current user (no RLS recursion)
CREATE OR REPLACE FUNCTION get_my_agency_onboarding_status()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT onboarding_status FROM agencies WHERE user_id = auth.uid() LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_my_agency_onboarding_status() TO authenticated;

-- 2. Admin view with current docs + contract acceptance
CREATE OR REPLACE VIEW admin_agency_onboarding_view
WITH (security_invoker = true)
AS
SELECT
  a.id,
  a.name,
  a.contact_email,
  a.rfc,
  a.razon_social,
  a.persona_type,
  a.representante_legal_nombre,
  a.onboarding_status,
  a.is_approved,
  a.rejection_category,
  a.rejection_reason,
  a.rejected_at,
  a.rejected_by,
  a.reversal_at,
  a.reversal_by,
  a.approved_at,
  a.approved_by,
  a.terms_accepted_at,
  a.documents_completed_at,
  a.signed_contract_url,
  a.user_id,
  a.created_at,
  (
    SELECT jsonb_agg(jsonb_build_object(
      'id',               d.id,
      'document_type_key',d.document_type_key,
      'file_name',        d.file_name,
      'storage_path',     d.storage_path,
      'status',           d.status,
      'rejection_reason', d.rejection_reason,
      'reviewed_at',      d.reviewed_at,
      'created_at',       d.created_at
    ) ORDER BY d.created_at DESC)
    FROM agency_documents d
    WHERE d.agency_id = a.id AND d.is_current = true
  ) AS current_documents,
  (
    SELECT jsonb_build_object(
      'id',               ca.id,
      'status',           ca.status,
      'contract_version', ca.contract_version,
      'signed_at',        ca.signed_at,
      'ip_address',       ca.ip_address
    )
    FROM contract_acceptances ca
    WHERE ca.agency_id = a.id
    ORDER BY ca.created_at DESC
    LIMIT 1
  ) AS contract_acceptance
FROM agencies a;

-- 3. Auto-advance trigger: pending_documents → pending_review when all required docs approved
CREATE OR REPLACE FUNCTION check_and_advance_onboarding_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agency_id        uuid;
  v_current_status   text;
  v_required_types   text[];
  v_approved_types   text[];
  v_missing          text[];
BEGIN
  v_agency_id := NEW.agency_id;

  SELECT onboarding_status INTO v_current_status
  FROM agencies WHERE id = v_agency_id;

  IF v_current_status <> 'pending_documents' THEN
    RETURN NEW;
  END IF;

  SELECT ARRAY_AGG(key) INTO v_required_types
  FROM document_types
  WHERE required = true AND key <> 'contrato_agencia';

  SELECT ARRAY_AGG(DISTINCT document_type_key) INTO v_approved_types
  FROM agency_documents
  WHERE agency_id = v_agency_id
    AND is_current = true
    AND status = 'approved'
    AND document_type_key <> 'contrato_agencia';

  IF v_required_types IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT ARRAY_AGG(t) INTO v_missing
  FROM UNNEST(v_required_types) t
  WHERE NOT (COALESCE(v_approved_types, ARRAY[]::text[]) @> ARRAY[t]);

  IF v_missing IS NULL OR ARRAY_LENGTH(v_missing, 1) IS NULL THEN
    UPDATE agencies
    SET onboarding_status       = 'pending_review',
        documents_completed_at  = now()
    WHERE id = v_agency_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_onboarding_advance ON agency_documents;
CREATE TRIGGER trg_check_onboarding_advance
  AFTER UPDATE ON agency_documents
  FOR EACH ROW
  WHEN (NEW.status = 'approved' AND NEW.is_current = true)
  EXECUTE FUNCTION check_and_advance_onboarding_status();
