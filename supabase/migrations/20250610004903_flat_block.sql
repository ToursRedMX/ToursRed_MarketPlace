-- Actualizar tabla destinations con campos adicionales
ALTER TABLE destinations 
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS main_image_url text,
ADD COLUMN IF NOT EXISTS country text,
ADD COLUMN IF NOT EXISTS region text,
ADD COLUMN IF NOT EXISTS best_time_to_visit text,
ADD COLUMN IF NOT EXISTS average_temperature text,
ADD COLUMN IF NOT EXISTS currency text,
ADD COLUMN IF NOT EXISTS language text,
ADD COLUMN IF NOT EXISTS time_zone text,
ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS last_updated_by uuid REFERENCES users(id);

-- Crear tabla para múltiples imágenes de destinos
CREATE TABLE IF NOT EXISTS destination_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id uuid NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  caption text,
  is_featured boolean DEFAULT false,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE destination_images ENABLE ROW LEVEL SECURITY;

-- Políticas para destination_images
CREATE POLICY "Destination images are readable by everyone"
  ON destination_images
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Agencies can manage destination images"
  ON destination_images
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'agency'
    )
  );

-- Actualizar políticas de destinations para permitir edición por todas las agencias
DROP POLICY IF EXISTS "Agencies can create destinations" ON destinations;

CREATE POLICY "Agencies can manage destinations"
  ON destinations
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'agency'
    )
  );

-- Función para actualizar last_updated_by automáticamente
CREATE OR REPLACE FUNCTION update_destination_last_updated()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_updated_by = auth.uid();
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para actualizar last_updated_by
DROP TRIGGER IF EXISTS destinations_update_last_updated ON destinations;
CREATE TRIGGER destinations_update_last_updated
  BEFORE UPDATE ON destinations
  FOR EACH ROW
  EXECUTE FUNCTION update_destination_last_updated();
