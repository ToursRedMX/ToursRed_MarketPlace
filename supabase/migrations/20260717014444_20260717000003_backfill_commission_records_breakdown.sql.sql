-- ============================================================
-- BACKFILL: Actualizar commission_records existentes con desglose completo
-- ============================================================
DO $$
DECLARE
  v_cr record;
  v_breakdown record;
BEGIN
  FOR v_cr IN
    SELECT cr.id, cr.booking_id
    FROM public.commission_records cr
  LOOP
    SELECT * INTO v_breakdown
    FROM public.calculate_booking_financial_breakdown(v_cr.booking_id);

    UPDATE public.commission_records
    SET
      gross_service_charge_amount = v_breakdown.gross_service_charge,
      membership_exemption_total = v_breakdown.membership_exemption_total,
      payment_plan_service_charges = v_breakdown.payment_plan_service_charges,
      payment_plan_membership_exemptions = v_breakdown.payment_plan_membership_exemptions,
      optional_services_subtotal = v_breakdown.optional_services_subtotal,
      optional_services_commission = v_breakdown.optional_services_commission,
      optional_services_service_charge = v_breakdown.optional_services_service_charge,
      optional_services_agency_net = v_breakdown.optional_services_agency_net,
      supplements_subtotal = v_breakdown.supplements_subtotal,
      supplements_commission = v_breakdown.supplements_commission,
      supplements_service_charge = v_breakdown.supplements_service_charge,
      supplements_agency_net = v_breakdown.supplements_agency_net,
      platform_total_revenue = v_breakdown.platform_total_revenue,
      agency_net_amount = v_breakdown.agency_payout_total
    WHERE id = v_cr.id;
  END LOOP;
END $$;
