

CREATE TABLE IF NOT EXISTS saved_tours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  tour_id uuid REFERENCES tours(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, tour_id)
);

ALTER TABLE saved_tours ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own saved tours"
  ON saved_tours FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can save tours"
  ON saved_tours FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own saved tours"
  ON saved_tours FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
