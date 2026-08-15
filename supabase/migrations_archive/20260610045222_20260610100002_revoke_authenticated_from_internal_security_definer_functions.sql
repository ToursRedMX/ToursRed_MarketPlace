-- Función interna (prefijo _ indica privada), llamada desde get_user_conversations
REVOKE EXECUTE ON FUNCTION public._get_user_conversations_internal(uuid) FROM authenticated;

-- Llamada desde stripe-webhook/mercadopago-webhook (service_role), no desde frontend
REVOKE EXECUTE ON FUNCTION public.activate_featured_slot(uuid, uuid, uuid) FROM authenticated;

-- Llamada exclusivamente desde webhooks de pago (service_role)
REVOKE EXECUTE ON FUNCTION public.confirm_featured_slot_payment(uuid, text, text, numeric) FROM authenticated;

-- Interna: llamada desde edge function generate-featured-slot-cfdi (service_role)
REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_featured_slot(uuid) FROM authenticated;

-- Llamada desde edge functions de pago (service_role): process-payment-plan-installment,
-- process-supplement-payment, confirm-booking-checkin, etc.
REVOKE EXECUTE ON FUNCTION public.deduct_points(uuid, integer, text, uuid, text) FROM authenticated;

-- Cron job únicamente, ejecutado por pg_cron con service_role
REVOKE EXECUTE ON FUNCTION public.expire_supplement_approvals() FROM authenticated;

-- Interna: llamada desde edge function (service_role), no directamente desde cliente
REVOKE EXECUTE ON FUNCTION public.increment_featured_stat(uuid, text) FROM authenticated;

-- Cron job únicamente
REVOKE EXECUTE ON FUNCTION public.process_payment_plan_deadlines() FROM authenticated;

-- Trigger function: solo la llama el motor de triggers, sin acceso externo
REVOKE EXECUTE ON FUNCTION public.update_payment_plan_updated_at() FROM authenticated;
