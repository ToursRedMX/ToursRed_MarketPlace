
CREATE TABLE IF NOT EXISTS booking_cleanup_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deleted_count integer NOT NULL DEFAULT 0,
  deleted_by uuid NOT NULL REFERENCES auth.users(id),
  deleted_at timestamptz NOT NULL DEFAULT now(),
  criteria text NOT NULL DEFAULT '',
  booking_codes text[] NOT NULL DEFAULT '{}'
);

ALTER TABLE booking_cleanup_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can insert cleanup logs"
  ON booking_cleanup_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins can view cleanup logs"
  ON booking_cleanup_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );
