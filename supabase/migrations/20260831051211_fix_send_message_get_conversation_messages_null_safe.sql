-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831051211
--   name:    fix_send_message_get_conversation_messages_null_safe
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

CREATE OR REPLACE FUNCTION public.get_conversation_messages(p_conversation_id uuid)
 RETURNS TABLE(id uuid, conversation_id uuid, sender_id uuid, content text, created_at timestamp with time zone, sender_first_name text, sender_last_name text, sender_email text, sender_role text, sender_profile_picture text, agency_name text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
v_user_role text;
v_is_admin boolean;
v_is_participant boolean;
BEGIN
SELECT u.role, (u.role IN ('admin','super_admin')) INTO v_user_role, v_is_admin
FROM users u WHERE u.id = auth.uid();

SELECT EXISTS (
SELECT 1 FROM message_participants mp
WHERE mp.conversation_id = p_conversation_id AND mp.user_id = auth.uid()
) INTO v_is_participant;

IF NOT COALESCE(v_is_admin, false) AND NOT COALESCE(v_is_participant, false) THEN
RAISE EXCEPTION 'No tienes acceso a esta conversación';
END IF;

RETURN QUERY
SELECT
m.id, m.conversation_id, m.sender_id, m.content, m.created_at,
u.first_name, u.last_name, u.email, u.role, u.profile_picture_url,
a.name
FROM messages m
JOIN users u ON m.sender_id = u.id
LEFT JOIN agencies a ON u.id = a.user_id AND u.role = 'agency'
WHERE m.conversation_id = p_conversation_id
ORDER BY m.created_at ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.send_message(p_conversation_id uuid, p_content text, p_message_type text DEFAULT 'text'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
v_message_id uuid;
v_is_admin boolean;
v_is_participant boolean;
BEGIN
SELECT (role IN ('admin','super_admin')) INTO v_is_admin FROM users WHERE id = auth.uid();
SELECT EXISTS (SELECT 1 FROM message_participants WHERE conversation_id = p_conversation_id AND user_id = auth.uid()) INTO v_is_participant;

IF NOT COALESCE(v_is_admin, false) AND NOT COALESCE(v_is_participant, false) THEN
RAISE EXCEPTION 'No tienes permiso para enviar mensajes a esta conversación';
END IF;

INSERT INTO messages (conversation_id, sender_id, content, message_type)
VALUES (p_conversation_id, auth.uid(), p_content, p_message_type)
RETURNING id INTO v_message_id;

UPDATE conversations SET last_message_at = NOW() WHERE id = p_conversation_id;
RETURN v_message_id;
END;
$function$
;
