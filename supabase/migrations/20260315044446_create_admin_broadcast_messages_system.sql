
CREATE TABLE IF NOT EXISTS admin_broadcast_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL DEFAULT '',
  message_body text NOT NULL,
  audience text NOT NULL CHECK (audience IN ('travelers', 'agencies', 'all')),
  send_channel text NOT NULL DEFAULT 'both' CHECK (send_channel IN ('email', 'notification', 'both')),
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recipients_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'completed', 'failed')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE admin_broadcast_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can insert broadcast messages"
  ON admin_broadcast_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins can view broadcast messages"
  ON admin_broadcast_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins can update broadcast messages"
  ON admin_broadcast_messages FOR UPDATE
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'system_announcement'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'notification_type')
  ) THEN
    ALTER TYPE notification_type ADD VALUE 'system_announcement';
  END IF;
END $$;
