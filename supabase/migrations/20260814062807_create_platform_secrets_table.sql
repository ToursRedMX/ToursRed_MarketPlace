-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260814062807
--   name:    create_platform_secrets_table
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

/*
# Create platform_secrets table and move sensitive credentials

## Purpose
Move 6 sensitive credential columns (paypal_client_secret, mercadopago_access_token,
pac_api_key_encrypted, odoo_api_key_encrypted, zoho_client_secret, geo_api_key) from
the publicly-readable platform_settings table into a new table that is only accessible
by the service_role. This prevents anyone with the anon key from reading payment
processor credentials.

## New Tables
- `platform_secrets` — single-row table holding the 6 credential columns.
  Columns: id (uuid PK), paypal_client_secret (text), mercadopago_access_token (text),
  pac_api_key_encrypted (text), odoo_api_key_encrypted (text), zoho_client_secret (text),
  geo_api_key (text), created_at, updated_at.

## Security
- RLS enabled on platform_secrets with NO policies for anon or authenticated.
  Only service_role (which bypasses RLS) can read/write this table.

## New Functions (SECURITY DEFINER)
- `get_platform_secrets()` — returns the 5 admin-managed credential columns.
  Checks that the caller (auth.uid()) has role = 'admin' in the users table.
- `update_platform_secrets(...)` — updates the 5 admin-managed credential columns.
  Same admin check. Uses SET search_path = public.

## Data Migration
- Copies existing values from platform_settings into platform_secrets.

## Important Notes
1. The geo_api_key column is moved but NOT exposed in the admin RPC functions
   because it is not currently managed from the admin UI. It is only read by
   the geo-lookup edge function (which uses service_role).
2. platform_settings remains fully readable by the public — only the 6 credential
   columns will be dropped in a subsequent migration AFTER all edge functions
   and the admin panel are updated to read from platform_secrets.
3. This migration is idempotent — safe to re-run.
*/

-- 1. Create the platform_secrets table
CREATE TABLE IF NOT EXISTS platform_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paypal_client_secret text,
  mercadopago_access_token text,
  pac_api_key_encrypted text,
  odoo_api_key_encrypted text,
  zoho_client_secret text,
  geo_api_key text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
)
;



-- 2. Enable RLS — no policies means only service_role can access
ALTER TABLE platform_secrets ENABLE ROW LEVEL SECURITY
;



-- 3. Migrate existing data from platform_settings (only if platform_secrets is empty)
INSERT INTO platform_secrets (paypal_client_secret, mercadopago_access_token, pac_api_key_encrypted, odoo_api_key_encrypted, zoho_client_secret, geo_api_key)
SELECT
  ps.paypal_client_secret,
  ps.mercadopago_access_token,
  ps.pac_api_key_encrypted,
  ps.odoo_api_key_encrypted,
  ps.zoho_client_secret,
  ps.geo_api_key
FROM platform_settings ps
WHERE NOT EXISTS (SELECT 1 FROM platform_secrets)
;



-- 4. Create get_platform_secrets() — admin-only read function
CREATE OR REPLACE FUNCTION get_platform_secrets()
RETURNS TABLE (
  paypal_client_secret text,
  mercadopago_access_token text,
  pac_api_key_encrypted text,
  odoo_api_key_encrypted text,
  zoho_client_secret text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid() AND users.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Not authorized'
;


  END IF
;



  RETURN QUERY
  SELECT
    ps.paypal_client_secret,
    ps.mercadopago_access_token,
    ps.pac_api_key_encrypted,
    ps.odoo_api_key_encrypted,
    ps.zoho_client_secret
  FROM platform_secrets ps
  LIMIT 1
;


END
;


$$
;



REVOKE EXECUTE ON FUNCTION get_platform_secrets() FROM anon
;


GRANT EXECUTE ON FUNCTION get_platform_secrets() TO authenticated
;



-- 5. Create update_platform_secrets() — admin-only write function
CREATE OR REPLACE FUNCTION update_platform_secrets(
  p_paypal_client_secret text DEFAULT NULL,
  p_mercadopago_access_token text DEFAULT NULL,
  p_pac_api_key_encrypted text DEFAULT NULL,
  p_odoo_api_key_encrypted text DEFAULT NULL,
  p_zoho_client_secret text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid() AND users.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Not authorized'
;


  END IF
;



  -- Ensure a row exists
  INSERT INTO platform_secrets (id)
  SELECT gen_random_uuid()
  WHERE NOT EXISTS (SELECT 1 FROM platform_secrets)
;



  UPDATE platform_secrets SET
    paypal_client_secret = COALESCE(p_paypal_client_secret, paypal_client_secret),
    mercadopago_access_token = COALESCE(p_mercadopago_access_token, mercadopago_access_token),
    pac_api_key_encrypted = COALESCE(p_pac_api_key_encrypted, pac_api_key_encrypted),
    odoo_api_key_encrypted = COALESCE(p_odoo_api_key_encrypted, odoo_api_key_encrypted),
    zoho_client_secret = COALESCE(p_zoho_client_secret, zoho_client_secret),
    updated_at = now()
;


END
;


$$
;



REVOKE EXECUTE ON FUNCTION update_platform_secrets(text, text, text, text, text) FROM anon
;


GRANT EXECUTE ON FUNCTION update_platform_secrets(text, text, text, text, text) TO authenticated
;
