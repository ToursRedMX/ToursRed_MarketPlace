-- Función para eliminar destinos (solo administradores)
CREATE OR REPLACE FUNCTION delete_destination(destination_uuid uuid)
RETURNS TABLE(
  success boolean,
  message text
) AS $$
DECLARE
  tour_count integer;
  current_user_role text;
BEGIN
  -- Verificar que el usuario actual es administrador
  SELECT role INTO current_user_role
  FROM users
  WHERE id = auth.uid();
  
  IF current_user_role != 'admin' THEN
    RETURN QUERY SELECT false, 'Solo los administradores pueden eliminar destinos';
    RETURN;
  END IF;
  
  -- Verificar si hay tours asociados a este destino
  SELECT COUNT(*) INTO tour_count
  FROM tour_destinations
  WHERE destination_id = destination_uuid;
  
  IF tour_count > 0 THEN
    RETURN QUERY SELECT false, 'No se puede eliminar el destino porque tiene tours asociados';
    RETURN;
  END IF;
  
  -- Eliminar imágenes del destino primero
  DELETE FROM destination_images
  WHERE destination_id = destination_uuid;
  
  -- Eliminar el destino
  DELETE FROM destinations
  WHERE id = destination_uuid;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Destino no encontrado';
    RETURN;
  END IF;
  
  RETURN QUERY SELECT true, 'Destino eliminado correctamente';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Política DELETE para administradores en destinations
CREATE POLICY "Admins can delete destinations"
  ON destinations
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Política DELETE para administradores en destination_images
CREATE POLICY "Admins can delete destination images"
  ON destination_images
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Comentarios para documentación
COMMENT ON FUNCTION delete_destination(uuid) IS 'Elimina un destino y sus imágenes asociadas. Solo disponible para administradores.';
