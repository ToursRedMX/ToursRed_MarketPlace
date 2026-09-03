-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20251212003943
--   name:    update_admin_email
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
  # Update Admin Email Address

  1. Changes
    - Update admin email from tourredmx@gmail.com to admin@toursred.com
    - Update both users table and auth.users table
    
  2. Notes
    - This migration updates the admin email address in both tables to maintain consistency
*/

-- Update email in users table
UPDATE users 
SET email = 'admin@toursred.com' 
WHERE email = 'tourredmx@gmail.com' AND role = 'admin'
;



-- Update email in auth.users table
UPDATE auth.users 
SET 
  email = 'admin@toursred.com',
  raw_user_meta_data = jsonb_set(
    COALESCE(raw_user_meta_data, '{}'::jsonb), 
    '{email}', 
    '"admin@toursred.com"'
  )
WHERE email = 'tourredmx@gmail.com'
;



;
