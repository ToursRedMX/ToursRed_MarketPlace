-- Crear una vista para verificar si existe un administrador
CREATE OR REPLACE VIEW admin_status AS
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM public.users WHERE role = 'admin') 
    THEN 'Administrador configurado'
    ELSE 'Administrador pendiente de configuración'
  END as status,
  COUNT(*) FILTER (WHERE role = 'admin') as admin_count
FROM public.users;

-- Comentario en la tabla users para documentar el proceso
COMMENT ON TABLE public.users IS 'Tabla de perfiles de usuario. Para crear el administrador inicial, usar Supabase Auth Dashboard o la función de registro de la app.';

-- Función helper para verificar el estado del administrador
CREATE OR REPLACE FUNCTION check_admin_status()
RETURNS TABLE(
  has_admin boolean,
  admin_count bigint,
  instructions text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    EXISTS(SELECT 1 FROM public.users WHERE role = 'admin') as has_admin,
    COUNT(*) FILTER (WHERE role = 'admin') as admin_count,
    CASE 
      WHEN EXISTS(SELECT 1 FROM public.users WHERE role = 'admin') 
      THEN 'Administrador ya configurado'
      ELSE 'Crear usuario admin@tourred.com en Supabase Auth Dashboard con metadata {"role": "admin"}'
    END as instructions
  FROM public.users;
END;
$$ LANGUAGE plpgsql;

-- Ejecutar verificación inicial
SELECT * FROM check_admin_status();
