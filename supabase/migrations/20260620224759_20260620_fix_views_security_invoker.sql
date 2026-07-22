
-- Enable security_invoker on all views whose base tables have RLS enabled
-- This ensures the view respects the caller's RLS policies instead of the view owner's

ALTER VIEW account_executives_safe SET (security_invoker = on);
ALTER VIEW admin_conversations SET (security_invoker = on);
ALTER VIEW admin_reviews_view SET (security_invoker = on);
ALTER VIEW admin_status SET (security_invoker = on);
ALTER VIEW audit_logs_sensitive_view SET (security_invoker = on);
ALTER VIEW audit_logs_view SET (security_invoker = on);
ALTER VIEW commission_records_with_days_pending SET (security_invoker = on);
ALTER VIEW points_expiration_summary SET (security_invoker = on);
ALTER VIEW user_notifications SET (security_invoker = on);
ALTER VIEW user_sessions_view SET (security_invoker = on);
