-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831051333
--   name:    fix_get_discount_code_details_admin_only
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

-- BUG: devolvia el historial completo de uso de un codigo de descuento
-- (nombre y user_id de cada persona que lo uso) sin ninguna verificacion de
-- rol. Cualquier usuario autenticado podia ver quien ha usado que codigos.
CREATE OR REPLACE FUNCTION public.get_discount_code_details(p_code_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_code_record record;
v_usage_records jsonb;
v_caller_role text;
BEGIN
SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();
IF COALESCE(v_caller_role, '') NOT IN ('admin', 'super_admin', 'agency') THEN
RAISE EXCEPTION 'No autorizado';
END IF;

SELECT * INTO v_code_record FROM public.discount_codes WHERE id = p_code_id;
IF v_code_record IS NULL THEN
RETURN jsonb_build_object('error', 'Código no encontrado');
END IF;

SELECT jsonb_agg(
jsonb_build_object(
'id', dcu.id, 'user_id', dcu.user_id,
'user_name', u.first_name || ' ' || u.last_name,
'used_at', dcu.used_at, 'booking_id', dcu.booking_id,
'gift_card_id', dcu.gift_card_id, 'membership_id', dcu.membership_id
) ORDER BY dcu.used_at DESC
)
INTO v_usage_records
FROM public.discount_code_usage dcu
LEFT JOIN public.users u ON u.id = dcu.user_id
WHERE dcu.discount_code_id = p_code_id;

RETURN jsonb_build_object(
'id', v_code_record.id, 'code', v_code_record.code,
'description', v_code_record.description,
'discount_type', v_code_record.discount_type,
'discount_value', v_code_record.discount_value,
'applicable_to', v_code_record.applicable_to,
'is_single_use', v_code_record.is_single_use,
'is_active', v_code_record.is_active,
'valid_from', v_code_record.valid_from,
'valid_until', v_code_record.valid_until,
'max_uses', v_code_record.max_uses,
'times_used', v_code_record.times_used,
'created_at', v_code_record.created_at,
'usage_records', COALESCE(v_usage_records, '[]'::jsonb)
);
END;
$function$
;
