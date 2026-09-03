
-- Agregar campos de verificación de email a la tabla users
DO $$
BEGIN
  -- Campo para indicar si el email está verificado
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'email_verified'
  ) THEN
    ALTER TABLE users ADD COLUMN email_verified boolean DEFAULT false NOT NULL;
    COMMENT ON COLUMN users.email_verified IS 'Indica si el correo electrónico ha sido verificado';
  END IF;

  -- Campo para almacenar el código de verificación
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'verification_code'
  ) THEN
    ALTER TABLE users ADD COLUMN verification_code text;
    COMMENT ON COLUMN users.verification_code IS 'Código de verificación de un solo uso (6 dígitos)';
  END IF;

  -- Campo para la fecha de expiración del código
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'verification_code_expires_at'
  ) THEN
    ALTER TABLE users ADD COLUMN verification_code_expires_at timestamptz;
    COMMENT ON COLUMN users.verification_code_expires_at IS 'Fecha de expiración del código de verificación';
  END IF;

  -- Campo para contador de intentos
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'verification_code_attempts'
  ) THEN
    ALTER TABLE users ADD COLUMN verification_code_attempts integer DEFAULT 0 NOT NULL;
    COMMENT ON COLUMN users.verification_code_attempts IS 'Contador de intentos fallidos de verificación';
  END IF;
END $$;
