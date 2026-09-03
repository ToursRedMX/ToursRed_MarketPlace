-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831022258
--   name:    fix_toggle_agency_seat_block_verify_caller_belongs_to_agency
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

-- BUG: la funcion verificaba que p_agency_id fuera dueña de p_tour_id, pero
-- NUNCA verificaba que quien llama (auth.uid()) realmente perteneciera a esa
-- agencia -- ambos IDs vienen del cliente sin cruzarse con la sesion real.
-- Cualquier usuario autenticado (incluso un viajero) que conociera o
-- adivinara el tour_id + agency_id de CUALQUIER tour (publicos, visibles en
-- las paginas de tour) podia bloquear/desbloquear asientos de esa agencia,
-- afectando la disponibilidad real de un tour ajeno. Se corrige exigiendo
-- que auth.uid() sea el dueño de la agencia (agencies.user_id), un miembro
-- de staff activo (agency_staff.is_active=true), o admin/super_admin.
CREATE OR REPLACE FUNCTION public.toggle_agency_seat_block(p_tour_id uuid, p_agency_id uuid, p_seat_number integer, p_block boolean, p_block_note text DEFAULT NULL::text, p_slot_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_current_status text;
v_caller_role text;
v_belongs_to_agency boolean;
BEGIN
IF NOT EXISTS (SELECT 1 FROM tours WHERE id = p_tour_id AND agency_id = p_agency_id) THEN
RETURN jsonb_build_object('success', false, 'error', 'Sin autorización');
END IF;

SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();

SELECT EXISTS (
SELECT 1 FROM agencies a WHERE a.id = p_agency_id AND a.user_id = auth.uid()
) OR EXISTS (
SELECT 1 FROM agency_staff s WHERE s.agency_id = p_agency_id AND s.user_id = auth.uid() AND s.is_active = true
) INTO v_belongs_to_agency;

IF NOT v_belongs_to_agency AND COALESCE(v_caller_role, '') NOT IN ('admin', 'super_admin') THEN
RETURN jsonb_build_object('success', false, 'error', 'Sin autorización');
END IF;

SELECT status INTO v_current_status
FROM slot_seat_status
WHERE tour_id = p_tour_id
AND ((p_slot_id IS NULL AND slot_id IS NULL) OR (p_slot_id IS NOT NULL AND slot_id = p_slot_id))
AND seat_number = p_seat_number;

IF p_block THEN
IF v_current_status = 'reservado_online' THEN
RETURN jsonb_build_object('success', false, 'error', 'El asiento tiene una reserva activa');
END IF;

INSERT INTO slot_seat_status (tour_id, slot_id, agency_id, seat_number, status, block_note, blocked_by, blocked_at)
VALUES (p_tour_id, p_slot_id, p_agency_id, p_seat_number, 'bloqueado_agencia', p_block_note, (SELECT auth.uid()), now())
ON CONFLICT (tour_id, slot_id, seat_number)
DO UPDATE SET status = 'bloqueado_agencia', block_note = p_block_note,
blocked_by = (SELECT auth.uid()), blocked_at = now(), booking_id = NULL, updated_at = now();
ELSE
IF v_current_status != 'bloqueado_agencia' THEN
RETURN jsonb_build_object('success', false, 'error', 'El asiento no está bloqueado por la agencia');
END IF;

DELETE FROM slot_seat_status
WHERE tour_id = p_tour_id
AND ((p_slot_id IS NULL AND slot_id IS NULL) OR (p_slot_id IS NOT NULL AND slot_id = p_slot_id))
AND seat_number = p_seat_number AND status = 'bloqueado_agencia';
END IF;

RETURN jsonb_build_object('success', true);
END;
$function$
;
