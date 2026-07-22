
-- Eliminar constraint restrictivo
ALTER TABLE tours DROP CONSTRAINT IF EXISTS tours_departure_points_not_empty;

-- Actualizar tours con departure_points vacío a tener un valor por defecto
UPDATE tours 
SET departure_points = ARRAY['Por confirmar']::text[]
WHERE departure_points IS NULL OR departure_points = '{}';

-- Agregar constraint más flexible que permite NULL pero no arrays vacíos
ALTER TABLE tours 
ADD CONSTRAINT tours_departure_points_check 
CHECK (departure_points IS NULL OR array_length(departure_points, 1) > 0);
