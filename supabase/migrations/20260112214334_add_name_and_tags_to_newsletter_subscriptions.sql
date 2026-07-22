
-- Add name column (nullable since existing records won't have it)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'newsletter_subscriptions' AND column_name = 'name'
  ) THEN
    ALTER TABLE newsletter_subscriptions ADD COLUMN name text;
  END IF;
END $$;

-- Add tags column (array of text, default to empty array)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'newsletter_subscriptions' AND column_name = 'tags'
  ) THEN
    ALTER TABLE newsletter_subscriptions ADD COLUMN tags text[] DEFAULT '{}';
  END IF;
END $$;

-- Create index on tags for better query performance
CREATE INDEX IF NOT EXISTS idx_newsletter_subscriptions_tags ON newsletter_subscriptions USING GIN(tags);
