-- Phase 1: remove unauthenticated execution of internal privileged RPCs.
-- These functions are invoked by triggers, cron jobs, service-role Edge Functions,
-- or authenticated administrative flows; anon must not be able to call them via PostgREST.

REVOKE EXECUTE ON FUNCTION public.get_platform_secrets() FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_platform_secrets(text, text, text, text, text) FROM anon;

REVOKE EXECUTE ON FUNCTION public.asentar_comisiones_faltantes() FROM anon;
REVOKE EXECUTE ON FUNCTION public.comisiones_no_asentadas() FROM anon;
REVOKE EXECUTE ON FUNCTION public.reconcile_paid_accounting_movements(date, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_errores_de_auditoria() FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_missing_tax_snapshots() FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_orphaned_cfdi_substitutes() FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_cobros_sin_comision() FROM anon;

REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_executive_commission(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_insurance_commission(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_insurance_purchase(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_insurance_settlement(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_membership(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_optional_service(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_payment_plan_installment(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_supplement(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_accounting_line_integrity() FROM anon;
REVOKE EXECUTE ON FUNCTION public.validate_posted_accounting_entry() FROM anon;
REVOKE EXECUTE ON FUNCTION public.validate_posted_accounting_entry_deferred() FROM anon;
REVOKE EXECUTE ON FUNCTION public.validate_posted_accounting_entry_lines() FROM anon;

REVOKE EXECUTE ON FUNCTION public.refresh_commission_on_optional_service() FROM anon;
REVOKE EXECUTE ON FUNCTION public.refresh_commission_on_payment_plan_txn() FROM anon;
REVOKE EXECUTE ON FUNCTION public.refresh_commission_on_supplement() FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_agency_commission_from_platform() FROM anon;
REVOKE EXECUTE ON FUNCTION public.snapshot_booking_tax() FROM anon;
REVOKE EXECUTE ON FUNCTION public.snapshot_optional_service_tax() FROM anon;
REVOKE EXECUTE ON FUNCTION public.snapshot_supplement_tax() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_create_accounting_entry_for_penalty_payout() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_insurance_commission_completed() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_insurance_settlement_completed() FROM anon;

REVOKE EXECUTE ON FUNCTION public.cleanup_expired_seat_holds() FROM anon;
REVOKE EXECUTE ON FUNCTION public.clear_documents_submitted_at_on_rejection() FROM anon;
REVOKE EXECUTE ON FUNCTION public.revocar_sesiones_al_bloquear() FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_openpay_topup_updated_at() FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_sla_deadline() FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_lead_status_on_agency_active() FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_agency_documents_updated_at() FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_contract_acceptances_updated_at() FROM anon;

REVOKE EXECUTE ON FUNCTION public.publish_new_terms_version(text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_blocked_ips_count() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_sessions(integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_remaining_service_fee_exemption(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_wallet_portion_for_booking_component(uuid, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.request_supplement_with_lock(uuid, uuid, uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.requires_aal2_check() FROM anon;

REVOKE EXECUTE ON FUNCTION public.generate_agency_slug(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_composite_tour_slug(text, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_referral_code(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_tour_slug(uuid, text, boolean) FROM anon;

REVOKE EXECUTE ON FUNCTION routesred.create_provider(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION routesred.get_user_provider_role(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION routesred.is_provider_member(uuid, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION routesred.link_provider_agency(uuid, uuid) FROM anon;
