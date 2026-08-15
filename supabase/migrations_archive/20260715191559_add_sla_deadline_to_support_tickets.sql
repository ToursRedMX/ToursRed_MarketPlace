/*
# Add sla_deadline column to support_tickets for server-side SLA sorting

## Why
The SLA column in the admin Service Desk panel needs to be sortable. Currently SLA
is computed in the frontend from created_at + subcategory.sla_horas, which makes
server-side sorting impossible without a stored column.

## Changes
1. Add `sla_deadline` timestamptz column to support_tickets.
2. Backfill existing rows: sla_deadline = created_at + (subcategory.sla_horas || ' hours')::interval.
3. Create a trigger that sets sla_deadline automatically on INSERT and on UPDATE
   when created_at or subcategory_id changes.

## Security
No RLS changes needed — the column is readable by anyone who can read the ticket.
*/
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS sla_deadline timestamptz;

-- Backfill existing rows
UPDATE support_tickets t
SET sla_deadline = t.created_at + COALESCE(
  (SELECT ss.sla_horas FROM support_subcategories ss WHERE ss.id = t.subcategory_id),
  24
) * interval '1 hour'
WHERE t.sla_deadline IS NULL;

-- Create index for sorting
CREATE INDEX IF NOT EXISTS idx_support_tickets_sla_deadline
  ON support_tickets(sla_deadline);

-- Trigger function to keep sla_deadline in sync
CREATE OR REPLACE FUNCTION set_sla_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sla_horas int;
BEGIN
  IF NEW.subcategory_id IS NOT NULL THEN
    SELECT sla_horas INTO v_sla_horas FROM support_subcategories WHERE id = NEW.subcategory_id;
  END IF;
  v_sla_horas := COALESCE(v_sla_horas, 24);

  IF TG_OP = 'INSERT' THEN
    NEW.sla_deadline := NEW.created_at + v_sla_horas * interval '1 hour';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.subcategory_id IS DISTINCT FROM OLD.subcategory_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      NEW.sla_deadline := NEW.created_at + v_sla_horas * interval '1 hour';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_sla_deadline ON support_tickets;
CREATE TRIGGER trg_set_sla_deadline
  BEFORE INSERT OR UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION set_sla_deadline();
