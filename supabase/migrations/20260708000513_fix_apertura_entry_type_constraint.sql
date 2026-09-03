-- Fix entry_type constraint to include 'apertura'
ALTER TABLE accounting_entries
  DROP CONSTRAINT IF EXISTS accounting_entries_entry_type_check;

ALTER TABLE accounting_entries
  ADD CONSTRAINT accounting_entries_entry_type_check
  CHECK (entry_type IN ('ingreso', 'egreso', 'diario', 'apertura'));

-- Fix source_type constraint to include 'apertura'
ALTER TABLE accounting_entries
  DROP CONSTRAINT IF EXISTS accounting_entries_source_type_check;

ALTER TABLE accounting_entries
  ADD CONSTRAINT accounting_entries_source_type_check
  CHECK (source_type IN ('booking', 'payout', 'cancellation', 'manual', 'membership', 'gift_card', 'apertura'));

-- Fix generate_entry_number to handle 'apertura' type
CREATE OR REPLACE FUNCTION generate_entry_number(p_type text, p_year integer DEFAULT NULL, p_month integer DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year  integer;
  v_month integer;
  prefix  text;
  seq     integer;
BEGIN
  v_year  := COALESCE(p_year,  date_part('year',  now())::integer);
  v_month := COALESCE(p_month, date_part('month', now())::integer);

  prefix := CASE p_type
    WHEN 'ingreso'  THEN 'I'
    WHEN 'egreso'   THEN 'E'
    WHEN 'apertura' THEN 'A'
    ELSE 'D'
  END;

  SELECT COUNT(*) + 1
    INTO seq
    FROM accounting_entries
   WHERE entry_type  = p_type
     AND period_year = v_year
     AND period_month = v_month;

  RETURN prefix || '-' || v_year || '-' || LPAD(v_month::text, 2, '0') || '-' || LPAD(seq::text, 4, '0');
END;
$$;
