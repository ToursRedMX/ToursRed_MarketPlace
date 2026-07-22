-- Fix SECURITY DEFINER functions accessible to PUBLIC
-- Root cause: PostgreSQL grants EXECUTE to PUBLIC by default on function creation.
-- REVOKE from individual roles is insufficient; must REVOKE FROM PUBLIC.

-- ============================================================
-- 1. Trigger functions — no user role should call these directly
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.audit_admin_permissions_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_agencies_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_bookings_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_payment_transactions_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_payouts_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_platform_settings_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_table_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_users_change() FROM PUBLIC;

-- ============================================================
-- 2. Cron/background functions — invoked by pg_cron, not users
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.auto_cleanup_garbage_bookings() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_expired_gift_cards_accounting() FROM PUBLIC;

-- ============================================================
-- 3. Gift card accounting internals — called by triggers/service layer only
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_gift_card_redemption(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_gift_card_sale(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_gift_card_accounting_summary() FROM PUBLIC;

-- ============================================================
-- 4. Audit log functions
-- insert_audit_log: called only by edge function using service_role key
-- get_audit_logs / get_audit_logs_sensitive: admin-only, need authenticated
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.insert_audit_log(
  text, uuid, text, text, text, text, text, jsonb, jsonb,
  inet, text, text, text, uuid, jsonb, text, timestamptz,
  text, text, text, text, text
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.get_audit_logs(
  text, text, text, uuid, timestamptz, timestamptz, int, int, text
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.get_audit_logs_sensitive(
  text, text, text, uuid, timestamptz, timestamptz, int, int, text
) FROM PUBLIC;

-- ============================================================
-- 5. Featured slot discount validation — authenticated agencies only
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.validate_featured_slot_discount(text, uuid) FROM PUBLIC;

-- ============================================================
-- 6. Admin commission functions — authenticated admins only
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.calculate_executive_platform_commissions(integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_and_notify_platform_commissions(integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_garbage_bookings(int) FROM PUBLIC;

-- ============================================================
-- Selective re-grants
-- ============================================================

-- Audit log read: admin frontend calls these as authenticated user
GRANT EXECUTE ON FUNCTION public.get_audit_logs(
  text, text, text, uuid, timestamptz, timestamptz, int, int, text
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_audit_logs_sensitive(
  text, text, text, uuid, timestamptz, timestamptz, int, int, text
) TO authenticated;

-- Audit log write: edge function uses service_role key exclusively
GRANT EXECUTE ON FUNCTION public.insert_audit_log(
  text, uuid, text, text, text, text, text, jsonb, jsonb,
  inet, text, text, text, uuid, jsonb, text, timestamptz,
  text, text, text, text, text
) TO service_role;

-- Featured slot discount: agencies call during checkout flow
GRANT EXECUTE ON FUNCTION public.validate_featured_slot_discount(text, uuid) TO authenticated;

-- Admin functions: authenticated admin users call these from admin pages
GRANT EXECUTE ON FUNCTION public.calculate_executive_platform_commissions(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_and_notify_platform_commissions(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_garbage_bookings(int) TO authenticated;

-- NOTE: increment_featured_stat intentionally keeps PUBLIC access (anonymous analytics tracking)
-- NOTE: pg_net extension schema warning cannot be resolved — extension does not support SET SCHEMA
