-- Add extra_data jsonb to support_tickets for APEL metadata
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS extra_data jsonb;
