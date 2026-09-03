-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260714042149
--   name:    reset_test_agency_to_pending_signature
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================


-- Reset completo de la agencia de prueba a estado previo a firma
UPDATE agencies
SET
  onboarding_status     = 'pending_signature',
  is_approved           = false,
  approved_at           = NULL,
  signed_contract_url   = NULL
WHERE id = '1a0b099a-d3a1-4cf4-ab59-d8d3b5cc1a83';

-- Reset del contract_acceptance a pending
UPDATE contract_acceptances
SET
  status                            = 'pending',
  signed_at                         = NULL,
  ip_address                        = NULL,
  user_agent                        = NULL,
  accepted_email                    = NULL,
  commission_percentage_at_signing  = NULL,
  otp_code_hash                     = NULL,
  otp_expires_at                    = NULL,
  otp_attempts                      = 0,
  signer_user_id                    = NULL
WHERE agency_id = '1a0b099a-d3a1-4cf4-ab59-d8d3b5cc1a83';

-- Eliminar documento de contrato previo para evitar conflictos de upsert en storage
DELETE FROM agency_documents
WHERE agency_id = '1a0b099a-d3a1-4cf4-ab59-d8d3b5cc1a83'
  AND document_type_key = 'contrato_agencia';

;
