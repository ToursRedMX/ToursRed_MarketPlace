-- Extender el ENUM notification_type con valores de soporte
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'support_ticket_created';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'support_ticket_updated';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'support_ticket_assigned';

-- Agregar campo canManageServiceDesk a admin_permissions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_permissions' AND column_name = 'can_manage_service_desk'
  ) THEN
    ALTER TABLE admin_permissions ADD COLUMN can_manage_service_desk boolean DEFAULT false;
  END IF;
END $$;

-- Crear bucket para adjuntos de soporte
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'support-attachments',
  'support-attachments',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Políticas de storage para el bucket de soporte
CREATE POLICY "Authenticated users can upload support attachments"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'support-attachments');

CREATE POLICY "Authenticated users can view support attachments"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'support-attachments');

CREATE POLICY "Admins can delete support attachments"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'support-attachments'
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );
