-- Add new columns to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS curp text,
ADD COLUMN IF NOT EXISTS passport_number text,
ADD COLUMN IF NOT EXISTS is_foreign_traveler boolean DEFAULT false;

-- Dropear índices únicos por si existen así
DROP INDEX IF EXISTS users_curp_unique;
DROP INDEX IF EXISTS users_passport_number_unique;

-- Add unique constraints
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_curp_unique;
ALTER TABLE users ADD CONSTRAINT users_curp_unique UNIQUE (curp);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_passport_number_unique;
ALTER TABLE users ADD CONSTRAINT users_passport_number_unique UNIQUE (passport_number);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_identification_check;
ALTER TABLE users ADD CONSTRAINT users_identification_check 
CHECK (
  (curp IS NOT NULL AND passport_number IS NULL AND is_foreign_traveler = false) OR
  (curp IS NULL AND passport_number IS NOT NULL AND is_foreign_traveler = true) OR
  (curp IS NULL AND passport_number IS NULL)
);
