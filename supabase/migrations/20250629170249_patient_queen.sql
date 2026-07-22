-- Add fiscal information columns to agencies table
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS rfc text;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS razon_social text;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS regimen_fiscal text;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS domicilio_fiscal text;

-- Add banking information columns to agencies table
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS banco text;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS cuenta_clabe text;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS titular_cuenta text;

-- Add comment to explain the purpose of these fields
COMMENT ON COLUMN agencies.rfc IS 'Registro Federal de Contribuyentes (RFC) para facturación';
COMMENT ON COLUMN agencies.razon_social IS 'Nombre legal de la empresa para facturación';
COMMENT ON COLUMN agencies.regimen_fiscal IS 'Código del régimen fiscal (ej: 601, 612, 625)';
COMMENT ON COLUMN agencies.domicilio_fiscal IS 'Dirección fiscal completa';
COMMENT ON COLUMN agencies.banco IS 'Nombre del banco para transferencias';
COMMENT ON COLUMN agencies.cuenta_clabe IS 'Número de cuenta CLABE (18 dígitos)';
COMMENT ON COLUMN agencies.titular_cuenta IS 'Nombre del titular de la cuenta bancaria';
