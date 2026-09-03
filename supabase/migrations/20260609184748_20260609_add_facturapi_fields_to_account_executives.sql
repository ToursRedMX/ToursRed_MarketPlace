-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260609184748
--   name:    20260609_add_facturapi_fields_to_account_executives
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

-- Add FacturAPI and fiscal fields to account_executives
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'facturapi_api_key_encrypted') THEN
    ALTER TABLE account_executives ADD COLUMN facturapi_api_key_encrypted TEXT
;


  END IF
;


  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'facturapi_organization_id') THEN
    ALTER TABLE account_executives ADD COLUMN facturapi_organization_id TEXT
;


  END IF
;


  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'facturapi_configured_at') THEN
    ALTER TABLE account_executives ADD COLUMN facturapi_configured_at TIMESTAMPTZ
;


  END IF
;


  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'tax_regimen_fiscal') THEN
    ALTER TABLE account_executives ADD COLUMN tax_regimen_fiscal TEXT
;


  END IF
;


  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'tax_uso_cfdi') THEN
    ALTER TABLE account_executives ADD COLUMN tax_uso_cfdi TEXT DEFAULT 'G03'
;


  END IF
;


  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'tax_withhold_isr') THEN
    ALTER TABLE account_executives ADD COLUMN tax_withhold_isr BOOLEAN DEFAULT false
;


  END IF
;


  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'tax_name') THEN
    ALTER TABLE account_executives ADD COLUMN tax_name TEXT
;


  END IF
;


  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'tax_rfc') THEN
    ALTER TABLE account_executives ADD COLUMN tax_rfc TEXT
;


  END IF
;


  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'tax_address') THEN
    ALTER TABLE account_executives ADD COLUMN tax_address TEXT
;


  END IF
;


  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'tax_zip') THEN
    ALTER TABLE account_executives ADD COLUMN tax_zip TEXT
;


  END IF
;


  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'bank_beneficiary') THEN
    ALTER TABLE account_executives ADD COLUMN bank_beneficiary TEXT
;


  END IF
;


  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'bank_name') THEN
    ALTER TABLE account_executives ADD COLUMN bank_name TEXT
;


  END IF
;


  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'bank_account_number') THEN
    ALTER TABLE account_executives ADD COLUMN bank_account_number TEXT
;


  END IF
;


  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'bank_clabe') THEN
    ALTER TABLE account_executives ADD COLUMN bank_clabe TEXT
;


  END IF
;


  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'profile_photo_url') THEN
    ALTER TABLE account_executives ADD COLUMN profile_photo_url TEXT
;


  END IF
;


END $$
;



-- RLS policies for account_executives
-- Executives can read their own row BUT NOT facturapi_api_key_encrypted (use a security view)
-- The facturapi_api_key_encrypted column is only accessible via service_role (edge functions)

-- Create a security definer view that hides the api key from authenticated users
CREATE OR REPLACE VIEW account_executives_safe AS
  SELECT
    id, user_id, first_name, last_name, email, phone, is_active, notes,
    hired_at, terminated_at, created_by, created_at, updated_at,
    facturapi_organization_id, facturapi_configured_at,
    tax_regimen_fiscal, tax_uso_cfdi, tax_withhold_isr,
    tax_name, tax_rfc, tax_address, tax_zip,
    bank_beneficiary, bank_name, bank_account_number, bank_clabe,
    profile_photo_url,
    -- Expose a boolean flag instead of the actual key
    (facturapi_api_key_encrypted IS NOT NULL) AS facturapi_configured
  FROM account_executives
;



-- Grant select on the safe view to authenticated users
GRANT SELECT ON account_executives_safe TO authenticated
;



;
