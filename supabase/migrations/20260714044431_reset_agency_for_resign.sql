
-- Reset agency "RECORRAMOS MEXICO" to pending_signature so they can re-sign
-- and generate a corrected PDF after the contractPdf.ts fix.

-- 1. Mark the existing contract acceptance as failed (so a new one can be created)
UPDATE contract_acceptances
SET status = 'failed',
    otp_code_hash = NULL,
    otp_expires_at = NULL
WHERE agency_id = '1a0b099a-d3a1-4cf4-ab59-d8d3b5cc1a83'
  AND status = 'signed';

-- 2. Reset agency onboarding to pending_signature
UPDATE agencies
SET onboarding_status = 'pending_signature',
    signed_contract_url = NULL,
    is_approved = false,
    approved_at = NULL,
    approved_by = NULL
WHERE id = '1a0b099a-d3a1-4cf4-ab59-d8d3b5cc1a83';

-- 3. Mark existing contrato_agencia documents as superseded
UPDATE agency_documents
SET is_current = false,
    status = 'superseded'
WHERE agency_id = '1a0b099a-d3a1-4cf4-ab59-d8d3b5cc1a83'
  AND document_type_key = 'contrato_agencia'
  AND is_current = true;

-- 4. Remove the old PDF from storage
SELECT lo_unlink(oid) FROM pg_largeobject_metadata WHERE oid IN (
  SELECT storage_path::oid FROM agency_documents
  WHERE agency_id = '1a0b099a-d3a1-4cf4-ab59-d8d3b5cc1a83'
    AND document_type_key = 'contrato_agencia'
);
