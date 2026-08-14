/*
# Add failed_attempts column to password_reset_codes

## Purpose
Security hardening: prevent brute-force attacks against the 6-digit password reset code.
Previously, verify-reset-code accepted unlimited guesses against a code with only 1,000,000
combinations. This migration adds a counter that the edge function uses to block after 5
failed attempts, matching the pattern already used in verify-email-code.

## Changes
1. New column: `password_reset_codes.failed_attempts` (integer, NOT NULL, default 0)
   - Tracks consecutive failed verification attempts per code
   - Reset to 0 is not needed — the code is single-use, so after success it's marked `used`

## Security
- No RLS policy changes (table is only accessed via service-role key in edge functions)
- No data loss — existing rows get default value 0
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'password_reset_codes'
    AND column_name = 'failed_attempts'
  ) THEN
    ALTER TABLE password_reset_codes
      ADD COLUMN failed_attempts integer NOT NULL DEFAULT 0;
  END IF;
END $$;
