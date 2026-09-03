-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260830203523
--   name:    fix_generate_entry_number_use_max_not_count
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

CREATE OR REPLACE FUNCTION public.generate_entry_number(p_type text, p_year integer DEFAULT NULL::integer, p_month integer DEFAULT NULL::integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_year  integer;
v_month integer;
prefix  text;
seq     integer;
BEGIN
v_year  := COALESCE(p_year,  date_part('year',  now())::integer);
v_month := COALESCE(p_month, date_part('month', now())::integer);

prefix := CASE p_type
WHEN 'ingreso'  THEN 'I'
WHEN 'egreso'   THEN 'E'
WHEN 'apertura' THEN 'A'
ELSE 'D'
END;

-- Antes usaba COUNT(*)+1, lo cual es fragil ante CUALQUIER borrado o hueco en
-- la secuencia (no solo concurrencia): si se borra un asiento de en medio del
-- periodo, el conteo baja y la siguiente llamada recicla un numero que ya le
-- pertenece a otro asiento distinto que nunca se toco. Confirmado en vivo el
-- 30-ago-2026 al regenerar 5 asientos corregidos de julio: el nuevo conteo
-- choco con el folio de una reserva completamente ajena (TRG-TV2HK6UAZ04).
-- Se corrige extrayendo el maximo secuencial ya usado en el periodo (a partir
-- del propio texto del folio) en vez de contar filas, lo cual es inmune a
-- huecos por borrado. Esto no resuelve una carrera de concurrencia perfecta
-- (para eso haria falta una SEQUENCE real o un lock), pero cubre el caso
-- real que causo el problema y es una mejora significativa sobre COUNT(*).
SELECT COALESCE(MAX(
  NULLIF(regexp_replace(entry_number, '^.*-(\d{4})$', '\1'), entry_number)::integer
), 0) + 1
INTO seq
FROM accounting_entries
WHERE entry_type  = p_type
AND period_year = v_year
AND period_month = v_month;

RETURN prefix || '-' || v_year || '-' || LPAD(v_month::text, 2, '0') || '-' || LPAD(seq::text, 4, '0');
END;
$function$
;
