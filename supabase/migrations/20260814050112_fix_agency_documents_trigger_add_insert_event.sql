-- Fix: trigger on agency_documents only fired on UPDATE, not INSERT.
-- When the last required document is uploaded as a new row, the onboarding
-- status never advanced from pending_documents to pending_review.
-- Recreate the trigger to fire on both INSERT and UPDATE.

DROP TRIGGER IF EXISTS trg_check_onboarding_advance ON agency_documents;

CREATE TRIGGER trg_check_onboarding_advance
  AFTER INSERT OR UPDATE ON agency_documents
  FOR EACH ROW
  WHEN (NEW.is_current = true AND NEW.status <> 'rejected')
  EXECUTE FUNCTION check_and_advance_onboarding_status();
