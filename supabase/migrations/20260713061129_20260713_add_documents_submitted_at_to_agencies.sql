-- Add documents_submitted_at to agencies
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS documents_submitted_at TIMESTAMPTZ;

-- When admin invalidates/rejects a document, clear documents_submitted_at so
-- the agency can re-notify after re-uploading.
CREATE OR REPLACE FUNCTION clear_documents_submitted_at_on_rejection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- NEW.status = 'rejected' means admin rejected this document
  IF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    UPDATE agencies
    SET documents_submitted_at = NULL
    WHERE id = NEW.agency_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_submitted_on_rejection ON agency_documents;
CREATE TRIGGER trg_clear_submitted_on_rejection
  AFTER UPDATE OF status ON agency_documents
  FOR EACH ROW
  EXECUTE FUNCTION clear_documents_submitted_at_on_rejection();
