
-- 1. Limpiar RFC duplicado: dejar NULL al viajero con email aalvarez@coldview.com
UPDATE users
SET rfc = NULL,
    razon_social = NULL,
    regimen_fiscal = NULL,
    codigo_postal_fiscal = NULL,
    uso_cfdi = NULL
WHERE email = 'aalvarez@coldview.com'
  AND role = 'traveler'
  AND rfc = 'AAHA84102489A';

-- 2. Indice unico parcial para RFC de viajeros
CREATE UNIQUE INDEX IF NOT EXISTS users_traveler_rfc_unique
  ON users(rfc)
  WHERE role = 'traveler' AND rfc IS NOT NULL;

-- 3. Constraint unico compuesto en accounting_sync_log
--    Requerido para que el upsert con onConflict funcione correctamente
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'accounting_sync_log'
      AND constraint_name = 'accounting_sync_log_provider_record_type_record_id_key'
      AND constraint_type = 'UNIQUE'
  ) THEN
    ALTER TABLE accounting_sync_log
      ADD CONSTRAINT accounting_sync_log_provider_record_type_record_id_key
      UNIQUE (provider, record_type, record_id);
  END IF;
END $$;
