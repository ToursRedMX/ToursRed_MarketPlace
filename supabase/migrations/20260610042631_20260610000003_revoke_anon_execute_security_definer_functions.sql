
REVOKE EXECUTE ON FUNCTION public.activate_featured_slot(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.confirm_featured_slot_payment(uuid, text, text, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_featured_slot(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.deduct_points(uuid, integer, text, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.expire_supplement_approvals() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_payment_plan_minimum_at_booking(uuid, date, numeric, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_featured_stat(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_payment_plan_deadlines() FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_payment_plan_updated_at() FROM anon;
