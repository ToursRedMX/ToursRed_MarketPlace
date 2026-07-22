-- Migration C: notification_type enum values + support category for appeals

-- 1. Add onboarding-related notification types (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum
      WHERE enumtypid = 'notification_type'::regtype AND enumlabel = 'agency_documents_approved'
    ) THEN ALTER TYPE notification_type ADD VALUE 'agency_documents_approved'; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_enum
      WHERE enumtypid = 'notification_type'::regtype AND enumlabel = 'agency_documents_rejected'
    ) THEN ALTER TYPE notification_type ADD VALUE 'agency_documents_rejected'; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_enum
      WHERE enumtypid = 'notification_type'::regtype AND enumlabel = 'agency_permanently_rejected'
    ) THEN ALTER TYPE notification_type ADD VALUE 'agency_permanently_rejected'; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_enum
      WHERE enumtypid = 'notification_type'::regtype AND enumlabel = 'agency_rejection_reversed'
    ) THEN ALTER TYPE notification_type ADD VALUE 'agency_rejection_reversed'; END IF;
  END IF;
END $$;

-- 2. Support sub-category for appeals — aplica_a is text[]
INSERT INTO support_categories (nombre, descripcion, activa, aplica_a)
VALUES (
  'Apelación de rechazo de registro',
  'Para agencias cuyo registro fue rechazado y desean apelar la decisión.',
  true,
  ARRAY['agency']
);
