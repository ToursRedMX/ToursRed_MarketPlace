/*
# Auto-approve lead when agency completes onboarding

## Summary
When an agency's onboarding_status transitions to 'active' (i.e., the agency has signed
the contract and been fully approved), the corresponding agency_leads record that created
this agency should automatically have its status updated to 'aprobado'. This keeps the
executive's pipeline accurate without manual intervention.

## Changes
1. New trigger function `sync_lead_status_on_agency_active()`:
   - Fires AFTER UPDATE on `agencies`
   - Checks if onboarding_status changed TO 'active'
   - Finds any agency_leads row where converted_agency_id = NEW.id
   - Updates that lead's status to 'aprobado'

2. Trigger `trg_sync_lead_status_on_agency_active` on `agencies`

3. Backfill: Updates existing leads whose converted agency is already active
   but whose lead status is still 'registrado'.

## Notes
- The trigger only fires when onboarding_status changes (OLD != NEW) so it does not
  run on unrelated updates.
- Safe to re-run: DROP FUNCTION IF EXISTS + CREATE OR REPLACE is used.
*/

-- Trigger function
CREATE OR REPLACE FUNCTION public.sync_lead_status_on_agency_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only act when onboarding_status transitions to 'active'
  IF NEW.onboarding_status = 'active' AND (OLD.onboarding_status IS DISTINCT FROM 'active') THEN
    UPDATE public.agency_leads
    SET status = 'aprobado',
        updated_at = now()
    WHERE converted_agency_id = NEW.id
      AND status != 'aprobado';
  END IF;
  RETURN NEW;
END;
$$;

-- Drop if exists (idempotent) then create
DROP TRIGGER IF EXISTS trg_sync_lead_status_on_agency_active ON public.agencies;

CREATE TRIGGER trg_sync_lead_status_on_agency_active
  AFTER UPDATE ON public.agencies
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_lead_status_on_agency_active();

-- Backfill: fix any existing leads whose agency is already active
UPDATE public.agency_leads al
SET status = 'aprobado',
    updated_at = now()
FROM public.agencies a
WHERE al.converted_agency_id = a.id
  AND a.onboarding_status = 'active'
  AND al.status != 'aprobado';
