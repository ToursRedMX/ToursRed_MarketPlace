/*
# Add Turnstile toggle to platform_settings

## Purpose
Adds a boolean column `turnstile_auth_enabled` to `platform_settings` so the
super admin can turn the Cloudflare Turnstile CAPTCHA widget on/off from the
admin settings panel — same pattern as the existing OAuth provider toggles.

When the column is `false` (the default), the login, signup, change-password,
and maintenance-admin forms omit the Turnstile widget entirely and do NOT
block submission, allowing the Bolt web-container preview to work without
Turnstile's domain-restricted widget rendering. When `true`, the widget
appears and the submit buttons require a valid token.

## Changes
1. New column: `platform_settings.turnstile_auth_enabled` (boolean, NOT NULL, default false)
   - Controls whether the Turnstile CAPTCHA widget is shown on auth forms
   - Default is false so previews are not blocked during development
   - Super admin flips it to true when ready for production

## Security
- No RLS policy changes (platform_settings already has admin-only write)
- No data loss — existing row gets default value false
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings'
    AND column_name = 'turnstile_auth_enabled'
  ) THEN
    ALTER TABLE platform_settings
      ADD COLUMN turnstile_auth_enabled boolean NOT NULL DEFAULT false;
  END IF;
END $$;
