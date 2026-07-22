-- Grant EXECUTE on the two create_conversation_with_participants overloads to authenticated.
-- reset_monthly_service_fee_exemption is a cron-only function and must NOT receive this grant.

GRANT EXECUTE ON FUNCTION public.create_conversation_with_participants(text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_conversation_with_participants(text, text, uuid, uuid, uuid[]) TO authenticated;
