
CREATE TABLE IF NOT EXISTS cookie_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id text NOT NULL,
  consent_type text NOT NULL CHECK (consent_type IN ('all', 'essential-only')),
  ip_address text,
  user_agent text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE cookie_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can record consent"
  ON cookie_consents
  FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Admins can view all consents"
  ON cookie_consents
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE INDEX IF NOT EXISTS idx_cookie_consents_user_id ON cookie_consents(user_id);
CREATE INDEX IF NOT EXISTS idx_cookie_consents_session_id ON cookie_consents(session_id);
CREATE INDEX IF NOT EXISTS idx_cookie_consents_created_at ON cookie_consents(created_at DESC);
