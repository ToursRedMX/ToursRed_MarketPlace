-- Add 'approved' to the allowed status values
ALTER TABLE agency_documents DROP CONSTRAINT agency_documents_status_check;
ALTER TABLE agency_documents ADD CONSTRAINT agency_documents_status_check
  CHECK (status = ANY (ARRAY['pending_review'::text, 'approved'::text, 'rejected'::text, 'superseded'::text]));

-- Backfill: documents that were reviewed (reviewed_at IS NOT NULL) but stuck in pending_review
UPDATE agency_documents
SET status = 'approved'
WHERE status = 'pending_review'
  AND reviewed_at IS NOT NULL
  AND is_current = true;