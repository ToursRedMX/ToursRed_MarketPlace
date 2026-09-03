/*
# Renombrar pac_issuer_zip y agregar tour_amount a cfdi_invoices

1. Renombrar columna en platform_settings
   - Renombra `pac_issuer_zip` a `pac_issuer_postal_code` para alinear con otros campos del emisor.
   - Conserva el valor existente (11560) — no se borra ni se pone en NULL.

2. Nueva columna en cfdi_invoices
   - Agrega `tour_amount` (numeric, nullable) para guardar el monto específico del concepto de tour
     de cada CFDI al momento de crearse (sin cargo de servicio, sin seguro, sin opcionales).
   - Permite que las sustituciones encadenadas usen el monto real del tour del CFDI específico
     en lugar del depósito fijo de la reserva, preservando así el cargo de servicio.

3. Notas
   - CFDIs anteriores sin tour_amount siguen funcionando: el código de sustitución usa
     deposit_amount como respaldo cuando tour_amount es NULL.
   - No se modifican políticas RLS existentes.
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'pac_issuer_zip'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'pac_issuer_postal_code'
  ) THEN
    ALTER TABLE platform_settings RENAME COLUMN pac_issuer_zip TO pac_issuer_postal_code;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cfdi_invoices' AND column_name = 'tour_amount'
  ) THEN
    ALTER TABLE cfdi_invoices ADD COLUMN tour_amount numeric(12,2);
  END IF;
END $$;