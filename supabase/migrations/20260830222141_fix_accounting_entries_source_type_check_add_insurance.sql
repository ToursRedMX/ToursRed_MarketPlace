-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260830222141
--   name:    fix_accounting_entries_source_type_check_add_insurance
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

-- El constraint no incluia 'insurance' como source_type valido, aunque
-- create_accounting_entry_for_insurance_purchase (llamada desde 5 Edge
-- Functions distintas al momento del pago) SIEMPRE inserta con
-- source_type='insurance'. Esto significa que la funcion nunca pudo
-- insertar exitosamente desde que existe -- confirmado en vivo el
-- 30-ago-2026 al intentar generar el asiento de una reserva real con
-- seguro, que fallo con esta misma violacion de constraint. El ingreso por
-- seguro de viaje nunca se ha registrado contablemente. Se agrega
-- 'insurance' a la lista de valores permitidos.
ALTER TABLE accounting_entries DROP CONSTRAINT accounting_entries_source_type_check;
ALTER TABLE accounting_entries ADD CONSTRAINT accounting_entries_source_type_check
CHECK (source_type = ANY (ARRAY['booking'::text, 'payout'::text, 'cancellation'::text, 'manual'::text,
'membership'::text, 'gift_card'::text, 'gift_card_sale'::text, 'gift_card_redemption'::text,
'gift_card_expiration'::text, 'featured_slot'::text, 'apertura'::text, 'insurance_settlement'::text,
'insurance_commission'::text, 'wallet_topup'::text, 'executive_commission'::text,
'insurance'::text, 'supplement'::text, 'optional_service'::text]))
;
