-- Internal audit and reconciliation jobs have no user-facing caller.
-- Keep service_role access for scheduled Edge Functions and revoke direct
-- authenticated execution.
REVOKE ALL ON FUNCTION public.check_missing_tax_snapshots() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.check_orphaned_cfdi_substitutes() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_paid_accounting_movements(date, date) FROM PUBLIC, authenticated;
