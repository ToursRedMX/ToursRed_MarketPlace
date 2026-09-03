-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831022451
--   name:    fix_sync_tour_slots_capacity_for_tour_respect_booked_count
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

-- BUG: a diferencia de sus dos funciones hermanas (sync_tour_slots_capacity_
-- on_schedule_update y _on_tour_update), esta version NO protegia contra
-- bajar la capacidad de un slot por debajo de booked_count. Si una agencia
-- reduce la capacidad de un tour despues de que ya hay reservas confirmadas
-- (llamada desde AgencyTours.tsx), el slot podia quedar con capacity < 
-- booked_count, generando disponibilidad negativa en cualquier calculo
-- downstream (v_available := capacity - booked - bloqueados - holds).
-- Se agrega el mismo piso GREATEST(nueva_capacidad, booked_count) que ya
-- usan las otras dos.
CREATE OR REPLACE FUNCTION public.sync_tour_slots_capacity_for_tour(p_tour_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
v_tour RECORD;
BEGIN
SELECT default_slot_capacity, max_travelers INTO v_tour
FROM tours WHERE id = p_tour_id;

UPDATE tour_slots ts
SET capacity = GREATEST(
COALESCE(
(SELECT s.slot_capacity FROM tour_schedules s
WHERE s.tour_id = p_tour_id
AND s.is_active = true
AND s.departure_time = ts.departure_time
LIMIT 1),
v_tour.default_slot_capacity,
COALESCE(v_tour.max_travelers, 20)
),
ts.booked_count
)
WHERE ts.tour_id = p_tour_id
AND ts.status = 'activo'
AND ts.slot_date >= CURRENT_DATE;
END;
$function$
;
