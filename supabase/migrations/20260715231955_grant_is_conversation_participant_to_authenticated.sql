/*
# Fix: grant EXECUTE on is_conversation_participant to authenticated role

The function `is_conversation_participant` (SECURITY DEFINER) was missing the
EXECUTE grant for the `authenticated` role, causing "permission denied" errors
for admins and all other authenticated users accessing the messaging module.
*/

GRANT EXECUTE ON FUNCTION public.is_conversation_participant(uuid) TO authenticated;