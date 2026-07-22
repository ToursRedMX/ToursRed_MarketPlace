
ALTER TABLE contract_acceptances
  ADD COLUMN IF NOT EXISTS otp_attempts  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accepted_email text;
