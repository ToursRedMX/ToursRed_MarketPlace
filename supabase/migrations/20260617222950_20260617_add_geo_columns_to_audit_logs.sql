-- Add geo columns to audit_logs so country/city appear in the admin audit log
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS country      text,
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS city         text,
  ADD COLUMN IF NOT EXISTS region       text;
