-- These functions are only trigger callbacks; clients call the table operation
-- that fires them, never the callback itself.
REVOKE ALL ON FUNCTION public.clear_documents_submitted_at_on_rejection() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.revocar_sesiones_al_bloquear() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.sync_lead_status_on_agency_active() FROM PUBLIC, authenticated;
