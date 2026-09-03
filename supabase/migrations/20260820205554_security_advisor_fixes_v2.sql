-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260820205554
--   name:    security_advisor_fixes_v2
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

-- PARTE 1 — Cosméticos (search_path mutable)
ALTER FUNCTION public.get_booking_total_paid(p_booking_id uuid)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.get_booking_total_paid_batch(p_booking_ids uuid[])
  SET search_path = public, pg_temp;
ALTER FUNCTION public.generate_tour_slug(p_name text)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.set_tour_slug_on_insert()
  SET search_path = public, pg_temp;

-- PARTE 3 — Seguras para revoke completo (solo Edge Functions / huérfanas)
REVOKE EXECUTE ON FUNCTION public.process_agency_payout_atomic(
  uuid, uuid[], uuid[], numeric, numeric, numeric, text, text, text, text, text, text, uuid
) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.process_cancellation_refund(
  uuid, numeric, text, text, text, boolean, text, numeric
) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.allocate_payment_plan_installment(
  uuid, numeric, text, numeric, numeric, text, uuid, boolean, boolean
) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.cancel_booking_optional_services(
  uuid, boolean, boolean
) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.claw_back_points_for_refund(
  uuid, uuid, text, uuid, integer
) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_referral_fraud_signals(
  integer
) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.apply_insurance_discount_code(
  text, uuid, uuid
) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.apply_tour_discount_code(
  text, uuid, uuid, uuid
) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.calculate_executive_platform_commissions(
  integer, integer
) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.apply_membership_service_fee_exemption(
  uuid, numeric
) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.request_supplement_with_lock(
  uuid, uuid, uuid, integer
) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.claim_cfdi_stamping_slot(
  uuid, text, uuid, uuid, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric
) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_insurance_purchase(
  uuid
) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_membership(
  uuid
) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_optional_service(
  uuid
) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_payment_plan_installment(
  uuid
) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_supplement(
  uuid
) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_wallet_topup(
  uuid
) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_available_service_fee_exemption(
  uuid
) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_booking(
  uuid
) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_cancellation(
  uuid, text
) FROM anon, authenticated;

-- PARTE 4 — Revoke de 'anon' en las 10 ya protegidas con check interno por Bolt
REVOKE EXECUTE ON FUNCTION public.get_balance_sheet(
  integer, integer
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.insert_audit_log(
  text, uuid, text, text, text, text, text, jsonb, jsonb, inet, text, text, text, uuid, jsonb, text, timestamptz, text, text, text, text, text
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.activate_featured_slot(
  uuid, uuid, uuid
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.get_agency_staff_for_owner(
  uuid
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.create_accounting_entry_for_executive_commission(
  uuid
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.activate_draft_booking(
  uuid
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.auto_generate_slots_for_range(
  uuid, date, date
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.reserve_seats(
  uuid, uuid, uuid, integer[], uuid
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.create_commission_records_for_receptivo_slot(
  uuid
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.create_commission_records_for_tour(
  uuid
) FROM anon;

;
