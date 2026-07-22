-- Add sexo and split apellidos to users table
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS sexo text CHECK (sexo IN ('masculino', 'femenino', 'no_binario'));
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS apellido_paterno text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS apellido_materno text;

-- Backfill apellido_paterno from last_name for existing records
UPDATE public.users SET apellido_paterno = last_name WHERE last_name IS NOT NULL AND apellido_paterno IS NULL;
