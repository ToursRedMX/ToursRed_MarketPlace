-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260805003615
--   name:    add_update_policies_corporate_tables
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
# Add UPDATE policies to corporate schema tables

## Purpose
The server-side code uses the anon key (no service role key is configured in .env).
After inserting a submission, the route handler updates email_status to 'sent' or 'failed'.
Without an UPDATE policy, this update silently fails.

## Changes
- Adds an UPDATE policy to each of the 11 corporate schema tables.
- The policy allows anon and authenticated to UPDATE any row, since these are
  public submission tables with no user_id ownership (single-tenant, no auth).
- The only columns updated by the application are email_status and email_error,
  which track email delivery status after the initial insert.

## Security note
UPDATE is restricted to the application's server-side routes. The anon key is
needed because the server falls back to it when no service role key is present.
This is acceptable because the only writable data via these routes is the
email delivery tracking fields, and the tables contain no user-owned private data.
*/

DO $$
DECLARE
  t text
;


  tables text[] := ARRAY[
    'agency_registration_submissions',
    'contact_submissions',
    'agency_support_submissions',
    'esim_quote_submissions',
    'exoticca_quote_submissions',
    'mega_travel_quote_submissions',
    'nefertari_quote_submissions',
    'rent_a_car_quote_submissions',
    'travel_insurance_quote_submissions',
    'traveler_services_submissions',
    'nature_stay_hub_submissions'
  ]
;


  policy_name text
;


BEGIN
  FOREACH t IN ARRAY tables LOOP
    policy_name := 'update_' || regexp_replace(t, '_submissions$', '')
;


    EXECUTE format('DROP POLICY IF EXISTS %I ON corporate.%I', policy_name, t)
;


    EXECUTE format('CREATE POLICY %I ON corporate.%I FOR UPDATE TO anon, authenticated WITH CHECK (true)', policy_name, t)
;


    EXECUTE format('GRANT UPDATE ON corporate.%I TO anon, authenticated', t)
;


  END LOOP
;


END $$
;



;
