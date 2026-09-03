-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260830225341
--   name:    add_trigger_for_penalty_payout_accounting_entry
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

-- create_accounting_entry_for_penalty_payout existia desde hace tiempo pero
-- nunca se conecto a nada: ni cron, ni trigger, ni llamada desde frontend.
-- Confirmado revisando AdminPayouts.tsx -> ProcessPenaltyModal: actualiza
-- cancellation_penalty_records.status='processed' (incluso en lote) pero
-- nunca invoca la funcion de asiento contable, a diferencia de los flujos
-- analogos de comision ejecutiva y liquidacion de seguros que si lo hacen
-- desde el frontend justo despues del update. En vez de parchar el frontend
-- (fragil: dependeria de que cualquier lugar que toque este status recuerde
-- llamar la funcion), se resuelve con un trigger de base de datos que se
-- dispara automaticamente en cualquier UPDATE que deje status='processed',
-- sin importar el origen (UI actual, un futuro cambio de UI, o incluso un
-- update directo por SQL). La funcion ya es idempotente (verifica que no
-- exista ya un accounting_entries para ese source_id antes de insertar).
CREATE OR REPLACE FUNCTION public.trg_create_accounting_entry_for_penalty_payout()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
IF NEW.status = 'processed' AND (OLD.status IS NULL OR OLD.status IS DISTINCT FROM 'processed') THEN
PERFORM public.create_accounting_entry_for_penalty_payout(NEW.id);
END IF;
RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_penalty_payout_accounting ON cancellation_penalty_records;
CREATE TRIGGER trg_penalty_payout_accounting
AFTER UPDATE ON cancellation_penalty_records
FOR EACH ROW
EXECUTE FUNCTION public.trg_create_accounting_entry_for_penalty_payout()
;
