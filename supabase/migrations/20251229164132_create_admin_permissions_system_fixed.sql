-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20251229164132
--   name:    create_admin_permissions_system_fixed
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
  # Create Admin Permissions System

  1. New Tables
    - `admin_permissions`
      - `user_id` (uuid, references users)
      - `can_manage_agencies` (boolean) - Ver y gestionar agencias
      - `can_manage_users` (boolean) - Ver y gestionar usuarios staff
      - `can_manage_destinations` (boolean) - Ver y gestionar destinos
      - `can_manage_reviews` (boolean) - Ver y gestionar reseñas
      - `can_manage_messages` (boolean) - Ver mensajes
      - `can_manage_settings` (boolean) - Ver y modificar configuración
      - `can_manage_memberships` (boolean) - Ver y gestionar membresías
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on admin_permissions table
    - Only super admins (tourredmx@gmail.com) can manage permissions
    - Admin users can read their own permissions

  3. Changes
    - Add is_super_admin flag to users table to identify the main admin
    - Set tourredmx@gmail.com as super admin with all permissions
*/

-- Add is_super_admin flag to users table if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin boolean DEFAULT false
;



-- Set tourredmx@gmail.com as super admin
UPDATE users 
SET is_super_admin = true 
WHERE email = 'tourredmx@gmail.com' AND role = 'admin'
;



-- Create admin_permissions table
CREATE TABLE IF NOT EXISTS admin_permissions (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  can_manage_agencies boolean DEFAULT false,
  can_manage_users boolean DEFAULT false,
  can_manage_destinations boolean DEFAULT false,
  can_manage_reviews boolean DEFAULT false,
  can_manage_messages boolean DEFAULT false,
  can_manage_settings boolean DEFAULT false,
  can_manage_memberships boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
)
;



-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_admin_permissions_user_id ON admin_permissions(user_id)
;



-- Enable RLS
ALTER TABLE admin_permissions ENABLE ROW LEVEL SECURITY
;



-- Super admins can do everything with permissions
CREATE POLICY "Super admins can manage all permissions"
  ON admin_permissions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.is_super_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.is_super_admin = true
    )
  )
;



-- Admin users can read their own permissions
CREATE POLICY "Admins can read own permissions"
  ON admin_permissions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid())
;



-- Insert full permissions for super admin
INSERT INTO admin_permissions (
  user_id,
  can_manage_agencies,
  can_manage_users,
  can_manage_destinations,
  can_manage_reviews,
  can_manage_messages,
  can_manage_settings,
  can_manage_memberships
)
SELECT 
  id,
  true,
  true,
  true,
  true,
  true,
  true,
  true
FROM users
WHERE email = 'tourredmx@gmail.com' AND role = 'admin'
ON CONFLICT (user_id) DO UPDATE SET
  can_manage_agencies = true,
  can_manage_users = true,
  can_manage_destinations = true,
  can_manage_reviews = true,
  can_manage_messages = true,
  can_manage_settings = true,
  can_manage_memberships = true
;



-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_admin_permissions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now()
;


  RETURN NEW
;


END
;


$$
;



-- Create trigger for updated_at
DROP TRIGGER IF EXISTS update_admin_permissions_updated_at ON admin_permissions
;


CREATE TRIGGER update_admin_permissions_updated_at
  BEFORE UPDATE ON admin_permissions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_admin_permissions_updated_at()
;



-- Create helper function to check if user has specific permission
CREATE OR REPLACE FUNCTION public.has_permission(permission_name text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT CASE
    -- Super admin always has all permissions
    WHEN EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid() AND is_super_admin = true
    ) THEN true
    -- Check specific permission
    ELSE COALESCE(
      (SELECT CASE permission_name
        WHEN 'agencies' THEN can_manage_agencies
        WHEN 'users' THEN can_manage_users
        WHEN 'destinations' THEN can_manage_destinations
        WHEN 'reviews' THEN can_manage_reviews
        WHEN 'messages' THEN can_manage_messages
        WHEN 'settings' THEN can_manage_settings
        WHEN 'memberships' THEN can_manage_memberships
        ELSE false
      END
      FROM admin_permissions
      WHERE user_id = auth.uid()),
      false
    )
  END
;


$$
;



;
