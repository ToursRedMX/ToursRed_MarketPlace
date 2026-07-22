-- Add fiscal information columns to agencies table
ALTER TABLE agencies 
ADD COLUMN IF NOT EXISTS rfc text,
ADD COLUMN IF NOT EXISTS razon_social text,
ADD COLUMN IF NOT EXISTS regimen_fiscal text,
ADD COLUMN IF NOT EXISTS domicilio_fiscal text,
ADD COLUMN IF NOT EXISTS banco text,
ADD COLUMN IF NOT EXISTS cuenta_clabe text,
ADD COLUMN IF NOT EXISTS titular_cuenta text;

-- Create index for RFC for faster lookups
CREATE INDEX IF NOT EXISTS idx_agencies_rfc ON agencies(rfc);

-- Comment on columns to provide documentation
COMMENT ON COLUMN agencies.rfc IS 'Registro Federal de Contribuyentes (RFC) de la agencia';
COMMENT ON COLUMN agencies.razon_social IS 'Nombre legal o razón social de la agencia';
COMMENT ON COLUMN agencies.regimen_fiscal IS 'Código del régimen fiscal (ej: 601, 612, etc.)';
COMMENT ON COLUMN agencies.domicilio_fiscal IS 'Dirección fiscal completa';
COMMENT ON COLUMN agencies.banco IS 'Nombre del banco para pagos';
COMMENT ON COLUMN agencies.cuenta_clabe IS 'Número de cuenta CLABE (18 dígitos)';
COMMENT ON COLUMN agencies.titular_cuenta IS 'Nombre del titular de la cuenta bancaria';
