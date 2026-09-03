/*
# Fix: grant EXECUTE on is_admin_user() to authenticated role

## Root cause
The function `is_admin_user()` (SECURITY DEFINER) was missing the EXECUTE grant
for the `authenticated` role. This function is called by RLS policies on:
- conversations (SELECT policy "Admins can view all conversations")
- message_participants (SELECT/INSERT policies)
- messages (SELECT/INSERT policies)

Without EXECUTE permission, every authenticated user — including admins —
got "permission denied for function is_admin_user" when accessing any
messaging table, which broke the entire admin messaging module.

## Fix
Grant EXECUTE on `is_admin_user()` to `authenticated`.
*/

GRANT EXECUTE ON FUNCTION public.is_admin_user() TO authenticated;