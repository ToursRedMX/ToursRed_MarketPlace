-- activate_featured_slot: solo usuarios autenticados pueden activar slots
REVOKE ALL ON FUNCTION public.activate_featured_slot(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_featured_slot(uuid, uuid, uuid) TO authenticated;

-- confirm_featured_slot_payment: llamada por service_role (webhook/edge function)
REVOKE ALL ON FUNCTION public.confirm_featured_slot_payment(uuid, text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_featured_slot_payment(uuid, text, text, numeric) TO service_role;

-- create_accounting_entry_for_featured_slot: interna, llamada desde edge functions (service_role)
REVOKE ALL ON FUNCTION public.create_accounting_entry_for_featured_slot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_accounting_entry_for_featured_slot(uuid) TO service_role;

-- deduct_points: interna, no debe ser callable directamente
REVOKE ALL ON FUNCTION public.deduct_points(uuid, integer, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deduct_points(uuid, integer, text, uuid, text) TO authenticated;

-- expire_supplement_approvals: cron job, solo service_role
REVOKE ALL ON FUNCTION public.expire_supplement_approvals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_supplement_approvals() TO service_role;

-- get_payment_plan_minimum_at_booking: consulta de planes de pago, accesible para autenticados
REVOKE ALL ON FUNCTION public.get_payment_plan_minimum_at_booking(uuid, date, numeric, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_payment_plan_minimum_at_booking(uuid, date, numeric, date) TO authenticated;

-- increment_featured_stat: interna, llamada desde edge functions (service_role)
REVOKE ALL ON FUNCTION public.increment_featured_stat(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_featured_stat(uuid, text) TO service_role;

-- process_payment_plan_deadlines: cron job, solo service_role
REVOKE ALL ON FUNCTION public.process_payment_plan_deadlines() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_payment_plan_deadlines() TO service_role;

-- update_payment_plan_updated_at: trigger function, no debe ser callable externamente
REVOKE ALL ON FUNCTION public.update_payment_plan_updated_at() FROM PUBLIC;
