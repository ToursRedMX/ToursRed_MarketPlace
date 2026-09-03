/*
# Add travel_insurance_enabled master toggle to platform_settings

1. Purpose
   Adds a platform-wide master on/off switch for offering travel insurance
   during the booking flow. When OFF, the insurance section is hidden from
   the booking form regardless of other rules (foreign travelers, activity
   type, tours that include insurance). Post-booking insurance purchases
   are NOT affected — only the initial booking flow.

   Default is `true` so existing behavior is unchanged until an admin
   explicitly turns it off.

2. Changes
   - `platform_settings` table: new column `travel_insurance_enabled`
     (boolean, NOT NULL, DEFAULT true)

3. Security
   - No new tables. No RLS policy changes needed — platform_settings
     already has RLS enabled with existing admin-only policies.
   - Audit logging is automatic: the existing trigger
     `trg_audit_platform_settings` captures all changes to this table,
     including who changed it, when, old/new values, and the diff.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings'
      AND column_name = 'travel_insurance_enabled'
  ) THEN
    ALTER TABLE platform_settings
      ADD COLUMN travel_insurance_enabled boolean NOT NULL DEFAULT true;
  END IF;
END $$;
