
-- ── 1. Agregar columna applies_to a document_types ───────────────────────────
ALTER TABLE document_types
  ADD COLUMN IF NOT EXISTS applies_to text NOT NULL DEFAULT 'ambas'
    CHECK (applies_to IN ('persona_fisica', 'persona_moral', 'ambas'));

-- ── 2. Corregir tipos existentes ─────────────────────────────────────────────
UPDATE document_types SET applies_to = 'persona_moral', required = true
  WHERE key = 'acta_constitutiva';

UPDATE document_types SET required = false
  WHERE key = 'contrato_agencia';

-- Los demás (comprobante_domicilio, constancia_situacion_fiscal,
-- identificacion_oficial) ya tienen required=true y se aplican a ambas.

-- ── 3. Insertar 3 tipos nuevos ────────────────────────────────────────────────
INSERT INTO document_types (key, label, description, required, applies_to, sort_order)
VALUES
  ('rnt',
   'RNT (Registro Nacional de Turismo)',
   'Registro Nacional de Turismo emitido por SECTUR. Opcional — ToursRed ofrece consultoría para tramitarlo.',
   false, 'ambas', 6),
  ('comprobante_bancario',
   'Comprobante bancario',
   'Estado de cuenta o carátula de cuenta bancaria a nombre de la agencia o representante legal.',
   true, 'ambas', 7),
  ('poder_representante_legal',
   'Poder notarial del representante legal',
   'Para personas morales: poder notarial que acredita la representación legal.',
   true, 'persona_moral', 8)
ON CONFLICT (key) DO NOTHING;
