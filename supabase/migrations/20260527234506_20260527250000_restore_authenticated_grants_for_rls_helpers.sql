
GRANT EXECUTE ON FUNCTION public.is_admin_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_participant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_manage_travelers_permission() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_user_agency_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_has_role(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public._get_user_conversations_internal(uuid) TO authenticated;
