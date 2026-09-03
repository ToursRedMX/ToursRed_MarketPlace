-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260708014120
--   name:    add_insurance_liability_account
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


INSERT INTO chart_of_accounts (code, name, account_type, parent_code, level, nature, sat_group_code, is_system, is_active, description)
VALUES ('201.01', 'Aseguradoras', 'pasivo', '201', 4, 'acreedora', '201-01', false, true,
        'Monto retenido de viajeros pendiente de liquidar a aseguradoras (ej. Universal Assistance) por venta de seguros de viaje intermediados')
ON CONFLICT (code) DO NOTHING;

;
