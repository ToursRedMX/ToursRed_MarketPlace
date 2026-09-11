-- Phase 1b: RPCs used only by authenticated/internal flows.
REVOKE EXECUTE ON FUNCTION public.calculate_booking_financial_breakdown(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_and_advance_onboarding_status() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_earned_points_for_reference(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_agency_executive() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_agency_onboarding_status() FROM PUBLIC, anon;
