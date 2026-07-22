
-- Restore EXECUTE for authenticated on functions called directly from admin frontend
-- These functions have internal admin checks, so authenticated admins need access

GRANT EXECUTE ON FUNCTION public.calculate_executive_platform_commissions(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_and_notify_platform_commissions(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_garbage_bookings(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_audit_logs(text, text, text, uuid, timestamptz, timestamptz, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_audit_logs_sensitive(text, text, text, uuid, timestamptz, timestamptz, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_audit_log(text, uuid, text, text, text, text, text, jsonb, jsonb, inet, text, text, text, uuid, jsonb, text, timestamptz, text, text, text, text, text) TO authenticated;
