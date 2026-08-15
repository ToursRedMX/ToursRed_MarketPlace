
-- Primero, crear una nueva columna temporal con el tipo array
ALTER TABLE tours ADD COLUMN IF NOT EXISTS categories_temp text[];

-- Migrar los datos existentes: convertir el texto simple en un array de un elemento
UPDATE tours 
SET categories_temp = ARRAY[category]
WHERE category IS NOT NULL;

-- Eliminar la columna antigua
ALTER TABLE tours DROP COLUMN IF EXISTS category;

-- Renombrar la columna temporal a 'category'
ALTER TABLE tours RENAME COLUMN categories_temp TO category;

-- Establecer como NOT NULL con un valor por defecto
ALTER TABLE tours ALTER COLUMN category SET DEFAULT ARRAY['adventure']::text[];
ALTER TABLE tours ALTER COLUMN category SET NOT NULL;
