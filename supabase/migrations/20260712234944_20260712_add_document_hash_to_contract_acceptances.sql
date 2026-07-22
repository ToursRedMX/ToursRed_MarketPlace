
-- Add document_hash and folio_contrato to contract_acceptances
-- document_hash: SHA-256 hex of the signed PDF bytes (proof of document integrity)
-- folio_contrato: human-readable contract reference stored alongside the acceptance record

ALTER TABLE contract_acceptances
  ADD COLUMN IF NOT EXISTS document_hash  text,
  ADD COLUMN IF NOT EXISTS folio_contrato text;
