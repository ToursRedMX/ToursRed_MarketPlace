
-- Crear tabla de categorías
CREATE TABLE IF NOT EXISTS tour_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text,
  is_active boolean DEFAULT true,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Insertar categorías predeterminadas
INSERT INTO tour_categories (name, slug, description, display_order) VALUES
  ('Aventura', 'adventure', 'Tours de aventura y actividades extremas', 1),
  ('Naturaleza', 'nature', 'Experiencias en contacto con la naturaleza', 2),
  ('Cultural', 'cultural', 'Tours culturales e históricos', 3),
  ('Playa', 'beach', 'Experiencias playeras y costeras', 4),
  ('Urbano', 'urban', 'Tours por ciudades y entornos urbanos', 5),
  ('Bienestar', 'wellness', 'Experiencias de relajación y bienestar', 6)
ON CONFLICT (slug) DO NOTHING;

-- Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION update_tour_categories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tour_categories_updated_at
  BEFORE UPDATE ON tour_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_tour_categories_updated_at();

-- Enable RLS
ALTER TABLE tour_categories ENABLE ROW LEVEL SECURITY;

-- Policy: Todos pueden leer categorías activas
CREATE POLICY "Anyone can view active categories"
  ON tour_categories
  FOR SELECT
  USING (is_active = true);

-- Policy: Admins pueden ver todas las categorías (activas e inactivas)
CREATE POLICY "Admins can view all categories"
  ON tour_categories
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Policy: Solo admins pueden crear categorías
CREATE POLICY "Admins can create categories"
  ON tour_categories
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Policy: Solo admins pueden actualizar categorías
CREATE POLICY "Admins can update categories"
  ON tour_categories
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Policy: Solo admins pueden eliminar categorías
CREATE POLICY "Admins can delete categories"
  ON tour_categories
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Crear índice para mejorar performance
CREATE INDEX IF NOT EXISTS idx_tour_categories_slug ON tour_categories(slug);
CREATE INDEX IF NOT EXISTS idx_tour_categories_is_active ON tour_categories(is_active);
CREATE INDEX IF NOT EXISTS idx_tour_categories_display_order ON tour_categories(display_order);
