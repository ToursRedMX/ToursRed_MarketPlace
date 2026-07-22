
-- Agregar campos is_visible y reply a agency_reviews
ALTER TABLE agency_reviews 
ADD COLUMN IF NOT EXISTS is_visible boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS reply text;

-- Agregar campo is_visible a traveler_reviews
ALTER TABLE traveler_reviews 
ADD COLUMN IF NOT EXISTS is_visible boolean DEFAULT true;

-- Políticas para REVIEWS (tours)
-- Admin puede ver todas las reseñas, incluso las ocultas
CREATE POLICY "Admins can view all reviews"
  ON reviews FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Admin puede actualizar cualquier reseña
CREATE POLICY "Admins can update any review"
  ON reviews FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Admin puede eliminar cualquier reseña
CREATE POLICY "Admins can delete any review"
  ON reviews FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Políticas para AGENCY_REVIEWS
-- Admin puede ver todas las reseñas de agencias
CREATE POLICY "Admins can view all agency reviews"
  ON agency_reviews FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Admin puede actualizar cualquier reseña de agencia
CREATE POLICY "Admins can update any agency review"
  ON agency_reviews FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Admin puede eliminar cualquier reseña de agencia
CREATE POLICY "Admins can delete any agency review"
  ON agency_reviews FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Políticas para TRAVELER_REVIEWS
-- Admin puede ver todas las reseñas de viajeros
CREATE POLICY "Admins can view all traveler reviews"
  ON traveler_reviews FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Admin puede actualizar cualquier reseña de viajero
CREATE POLICY "Admins can update any traveler review"
  ON traveler_reviews FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Admin puede eliminar cualquier reseña de viajero
CREATE POLICY "Admins can delete any traveler review"
  ON traveler_reviews FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Actualizar la política de lectura pública de agency_reviews para respetar is_visible
DROP POLICY IF EXISTS "Anyone can view agency reviews" ON agency_reviews;
CREATE POLICY "Anyone can view visible agency reviews"
  ON agency_reviews FOR SELECT
  TO public
  USING (is_visible = true);
