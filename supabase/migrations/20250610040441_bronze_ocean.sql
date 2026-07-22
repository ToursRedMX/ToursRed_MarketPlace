-- Agregar campos includes y excludes a la tabla tours
ALTER TABLE tours 
ADD COLUMN IF NOT EXISTS includes text[],
ADD COLUMN IF NOT EXISTS excludes text[];

-- Comentarios para documentación
COMMENT ON COLUMN tours.includes IS 'Lista de elementos incluidos en el tour';
COMMENT ON COLUMN tours.excludes IS 'Lista de elementos no incluidos en el tour';
