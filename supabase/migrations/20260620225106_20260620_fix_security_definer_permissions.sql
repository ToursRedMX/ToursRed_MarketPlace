
-- Revoke EXECUTE from anon/authenticated on SECURITY DEFINER functions
-- that should not be directly callable by those roles

-- Trigger functions (called only by triggers, not directly by users)
REVOKE EXECUTE ON FUNCTION public.audit_admin_permissions_change() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_agencies_change() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_bookings_change() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_payment_transactions_change() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_payouts_change() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_platform_settings_change() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_table_change() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_users_change() FROM anon, authenticated;

-- Cron/internal functions (only invoked by pg_cron or service_role)
REVOKE EXECUTE ON FUNCTION public.auto_cleanup_garbage_bookings() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_expired_gift_cards_accounting() FROM anon, authenticated;

-- Gift card accounting internals (called by edge functions via service_role)
REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_gift_card_redemption(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_gift_card_sale(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_gift_card_accounting_summary() FROM anon, authenticated;

-- Audit log query functions (admin-only, accessed via edge functions with service_role)
REVOKE EXECUTE ON FUNCTION public.get_audit_logs(text, text, text, uuid, timestamptz, timestamptz, integer, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_audit_logs_sensitive(text, text, text, uuid, timestamptz, timestamptz, integer, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.insert_audit_log(text, uuid, text, text, text, text, text, jsonb, jsonb, inet, text, text, text, uuid, jsonb, text, timestamptz, text, text, text, text, text) FROM anon;

-- Admin-only management functions (revoke from anon; admins call via authenticated session)
REVOKE EXECUTE ON FUNCTION public.calculate_executive_platform_commissions(integer, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_and_notify_platform_commissions(integer, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_garbage_bookings(integer) FROM anon, authenticated;

-- validate_featured_slot_discount: authenticated needed, revoke only from anon
REVOKE EXECUTE ON FUNCTION public.validate_featured_slot_discount(text, uuid) FROM anon;
