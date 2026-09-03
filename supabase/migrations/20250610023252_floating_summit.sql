-- Agregar campo email a la tabla users
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS email text;

-- Función para sincronizar email desde auth.users
CREATE OR REPLACE FUNCTION sync_user_email()
RETURNS TRIGGER AS $$
BEGIN
  -- Al insertar o actualizar, sincronizar email desde auth.users
  SELECT email INTO NEW.email 
  FROM auth.users 
  WHERE id = NEW.id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger para sincronizar email automáticamente
DROP TRIGGER IF EXISTS sync_user_email_trigger ON public.users;
CREATE TRIGGER sync_user_email_trigger
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION sync_user_email();

-- Sincronizar emails existentes (corregir sintaxis del JOIN)
UPDATE public.users 
SET email = auth.users.email
FROM auth.users
WHERE public.users.id = auth.users.id
AND public.users.email IS NULL;

-- Función para promover usuario a administrador
CREATE OR REPLACE FUNCTION promote_to_admin(user_email text)
RETURNS TABLE(
  success boolean,
  message text,
  user_id uuid
) AS $$
DECLARE
  target_user_id uuid;
  current_role text;
BEGIN
  -- Buscar el usuario por email en auth.users
  SELECT au.id INTO target_user_id
  FROM auth.users au
  WHERE au.email = user_email;
  
  IF target_user_id IS NULL THEN
    RETURN QUERY SELECT false, 'Usuario no encontrado en auth.users', null::uuid;
    RETURN;
  END IF;
  
  -- Verificar si ya existe en public.users
  SELECT role INTO current_role
  FROM public.users
  WHERE id = target_user_id;
  
  IF current_role IS NULL THEN
    -- Crear perfil si no existe
    INSERT INTO public.users (id, role, first_name, last_name)
    VALUES (target_user_id, 'admin', 'Super', 'Admin');
    
    RETURN QUERY SELECT true, 'Usuario promovido a administrador (perfil creado)', target_user_id;
  ELSIF current_role = 'admin' THEN
    RETURN QUERY SELECT true, 'Usuario ya es administrador', target_user_id;
  ELSE
    -- Actualizar rol existente
    UPDATE public.users 
    SET role = 'admin', updated_at = now()
    WHERE id = target_user_id;
    
    RETURN QUERY SELECT true, 'Usuario promovido a administrador', target_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Eliminar función existente antes de recrearla
DROP FUNCTION IF EXISTS check_admin_status();

-- Función de verificación mejorada
CREATE OR REPLACE FUNCTION check_admin_status()
RETURNS TABLE(
  has_admin boolean,
  admin_count bigint,
  admin_emails text[],
  instructions text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    EXISTS(SELECT 1 FROM public.users WHERE role = 'admin') as has_admin,
    COUNT(*) FILTER (WHERE role = 'admin') as admin_count,
    ARRAY_AGG(email) FILTER (WHERE role = 'admin') as admin_emails,
    CASE 
      WHEN EXISTS(SELECT 1 FROM public.users WHERE role = 'admin') 
      THEN 'Administrador(es) configurado(s)'
      ELSE 'Usar: SELECT * FROM promote_to_admin(''tu-email@ejemplo.com'');'
    END as instructions
  FROM public.users;
END;
$$ LANGUAGE plpgsql;

-- Actualizar vista admin_status para incluir email
DROP VIEW IF EXISTS admin_status;
CREATE OR REPLACE VIEW admin_status AS
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM public.users WHERE role = 'admin') 
    THEN 'Administrador configurado'
    ELSE 'Administrador pendiente de configuración'
  END as status,
  COUNT(*) FILTER (WHERE role = 'admin') as admin_count
FROM public.users;

-- Promover el usuario tourredmx@gmail.com a administrador
SELECT * FROM promote_to_admin('tourredmx@gmail.com');

-- Verificar el resultado
SELECT * FROM check_admin_status();