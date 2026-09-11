-- Trigger callbacks are invoked by PostgreSQL, never by a client RPC call.
-- Removing default EXECUTE prevents authenticated users from invoking these
-- SECURITY DEFINER functions directly while preserving trigger execution.
REVOKE ALL ON FUNCTION public.cancel_commissions_on_booking_cancel() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.enforce_accounting_line_integrity() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.refresh_commission_on_optional_service() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.refresh_commission_on_payment_plan_txn() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.refresh_commission_on_supplement() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.set_agency_commission_from_platform() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.set_commission_tour_completion_date() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.set_openpay_topup_updated_at() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.set_sla_deadline() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.snapshot_booking_tax() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.snapshot_optional_service_tax() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.snapshot_supplement_tax() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.trg_create_accounting_entry_for_penalty_payout() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.trg_insurance_commission_completed() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.trg_insurance_settlement_completed() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.update_accounting_sync_log_updated_at() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.update_agency_documents_updated_at() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.update_contract_acceptances_updated_at() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.validate_posted_accounting_entry() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.validate_posted_accounting_entry_deferred() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.validate_posted_accounting_entry_lines() FROM PUBLIC, authenticated;
