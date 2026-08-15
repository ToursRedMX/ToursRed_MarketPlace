-- ============================================================
-- PASO 1: Revocar 'anon' de todas las funciones que lo tienen
--         (elimina los 3 warnings "Public Can Execute")
-- ============================================================

REVOKE EXECUTE ON FUNCTION public._get_user_conversations_internal(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_conversations() FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_user_has_role(text[]) FROM anon;

-- ============================================================
-- PASO 2: Revocar 'authenticated' de funciones helper internas
--         que solo se usan en políticas RLS, no via RPC cliente
--         (elimina los warnings "Signed-In Users Can Execute")
-- ============================================================

-- is_admin_user() — solo usada en políticas RLS de conversations y message_participants
REVOKE EXECUTE ON FUNCTION public.is_admin_user() FROM authenticated;

-- is_conversation_participant() — solo usada en política RLS de message_participants
REVOKE EXECUTE ON FUNCTION public.is_conversation_participant(uuid) FROM authenticated;

-- is_super_admin() — solo usada en políticas RLS internas
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM authenticated;

-- has_manage_travelers_permission() — solo usada en políticas RLS
REVOKE EXECUTE ON FUNCTION public.has_manage_travelers_permission() FROM authenticated;

-- get_current_user_agency_id() — solo usada en políticas RLS
REVOKE EXECUTE ON FUNCTION public.get_current_user_agency_id() FROM authenticated;

-- current_user_is_admin() — solo usada en políticas RLS
REVOKE EXECUTE ON FUNCTION public.current_user_is_admin() FROM authenticated;

-- current_user_has_role() — solo usada en políticas RLS
REVOKE EXECUTE ON FUNCTION public.current_user_has_role(text[]) FROM authenticated;

-- ============================================================
-- PASO 3: Mantener 'authenticated' SOLO en get_user_conversations
--         que es la única llamada via .rpc() desde el frontend
-- ============================================================
-- (ya tiene authenticated=X, no se modifica)

-- Verificación: _get_user_conversations_internal tampoco debe ser accesible
-- desde el cliente (es función interna, el cliente solo llama get_user_conversations)
REVOKE EXECUTE ON FUNCTION public._get_user_conversations_internal(uuid) FROM authenticated;
