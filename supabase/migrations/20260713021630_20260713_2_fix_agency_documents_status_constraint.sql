
-- Eliminar constraint viejo que incluía 'approved'
ALTER TABLE agency_documents
  DROP CONSTRAINT IF EXISTS agency_documents_status_check;

-- Recrear sin 'approved'
ALTER TABLE agency_documents
  ADD CONSTRAINT agency_documents_status_check
    CHECK (status IN ('pending_review', 'rejected', 'superseded'));
