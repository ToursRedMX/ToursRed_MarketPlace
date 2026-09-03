/*
# Newsletter module: unsubscribe token, broadcast history table

## Context
The newsletter_subscriptions table exists since the first version but only stored
email records. This migration adds:
1. A secure unsubscribe token so users can unsubscribe via a public link without
   guessing other people's emails.
2. An unsubscribed_at timestamp to track when someone opted out.
3. A new newsletter_broadcasts table to record each newsletter campaign sent to
   subscribers (separate from admin_broadcast_messages, which targets registered
   platform users).

## Changes to newsletter_subscriptions
- ADD COLUMN unsubscribe_token uuid DEFAULT gen_random_uuid()
- ADD COLUMN unsubscribed_at timestamptz (nullable)
- Backfill all existing rows with a unique token
- CREATE INDEX on unsubscribe_token for fast public lookups

## New table: newsletter_broadcasts
- id (uuid PK)
- subject (text, not null) — email subject line
- message_body (text, not null) — email content
- sent_by (uuid FK users) — admin who sent it
- recipients_count (int) — how many active subscribers received it
- success_count (int) — how many emails succeeded
- error_count (int) — how many emails failed
- status (text, check: sending/completed/failed)
- created_at (timestamptz)

## Security
- RLS enabled on newsletter_broadcasts
- 4 separate policies (SELECT/INSERT/UPDATE/DELETE) restricted to admins
- No changes to existing newsletter_subscriptions RLS policies (they already
  allow anon INSERT, admin SELECT/UPDATE)
*/
ALTER TABLE newsletter_subscriptions
  ADD COLUMN IF NOT EXISTS unsubscribe_token uuid DEFAULT gen_random_uuid();

ALTER TABLE newsletter_subscriptions
  ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz;

UPDATE newsletter_subscriptions
SET unsubscribe_token = gen_random_uuid()
WHERE unsubscribe_token IS NULL;

CREATE INDEX IF NOT EXISTS idx_newsletter_subscriptions_unsubscribe_token
  ON newsletter_subscriptions(unsubscribe_token);

CREATE TABLE IF NOT EXISTS newsletter_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  message_body text NOT NULL,
  sent_by uuid REFERENCES users(id) ON DELETE SET NULL,
  recipients_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending','completed','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE newsletter_broadcasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "newsletter_broadcasts_admin_select" ON newsletter_broadcasts;
CREATE POLICY "newsletter_broadcasts_admin_select" ON newsletter_broadcasts
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "newsletter_broadcasts_admin_insert" ON newsletter_broadcasts;
CREATE POLICY "newsletter_broadcasts_admin_insert" ON newsletter_broadcasts
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "newsletter_broadcasts_admin_update" ON newsletter_broadcasts;
CREATE POLICY "newsletter_broadcasts_admin_update" ON newsletter_broadcasts
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "newsletter_broadcasts_admin_delete" ON newsletter_broadcasts;
CREATE POLICY "newsletter_broadcasts_admin_delete" ON newsletter_broadcasts
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_newsletter_broadcasts_created_at
  ON newsletter_broadcasts(created_at DESC);
