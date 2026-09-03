
-- Create email_settings table
CREATE TABLE IF NOT EXISTS email_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_email text NOT NULL DEFAULT 'contacto@toursred.com',
  smtp_host text NOT NULL DEFAULT 'mail.smtp2go.com',
  smtp_port integer NOT NULL DEFAULT 2525,
  smtp_user text NOT NULL DEFAULT 'toursred',
  smtp_password text NOT NULL,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE email_settings ENABLE ROW LEVEL SECURITY;

-- Admins can read email settings
CREATE POLICY "Admins can read email settings"
  ON email_settings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Admins can update email settings
CREATE POLICY "Admins can update email settings"
  ON email_settings
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Insert default email settings (only if table is empty)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM email_settings LIMIT 1) THEN
    INSERT INTO email_settings (contact_email, smtp_host, smtp_port, smtp_user, smtp_password)
    VALUES ('contacto@toursred.com', 'mail.smtp2go.com', 2525, 'toursred', 'T0ur$R3dMX2025');
  END IF;
END $$;
