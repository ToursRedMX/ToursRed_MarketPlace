
-- Add smtp_api_key column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'email_settings' AND column_name = 'smtp_api_key'
  ) THEN
    ALTER TABLE email_settings ADD COLUMN smtp_api_key text;
  END IF;
END $$;

-- Aqui iba un UPDATE que sembraba la llave SMTP hardcodeada. Se removio el
-- 02-sep-2026, despues de rotar esa llave: el valor viejo quedo muerto y en un
-- entorno nuevo se sembraba solo (el guard WHERE smtp_api_key IS NULL no frena
-- en una base recien creada), dejando el correo fallando en silencio con una
-- credencial presente pero invalida.
--
-- La columna queda en NULL a proposito: la llave se carga por configuracion,
-- no por migracion. Esta migracion ya esta aplicada en produccion, asi que
-- editar este archivo no altera la base existente; solo cambia lo que recibe
-- un entorno reconstruido desde el repo.
