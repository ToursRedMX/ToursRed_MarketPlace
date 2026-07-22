-- Grant EXECUTE to authenticated role for all client-callable RPC functions
-- that are now confirmed safe (use auth.uid() internally or have been patched)

GRANT EXECUTE ON FUNCTION public.auto_generate_slots_for_range(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_tour_slots_capacity_for_tour(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking_optional_services(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_accounting_entry_for_cancellation(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_points(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_points_wallet(uuid) TO authenticated;
