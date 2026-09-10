-- Canonical financial architecture:
--   accounting = internal ERP
--   CFDI       = Facturapi
-- This migration also closes the most serious integrity gaps found in the
-- accounting audit. It is intentionally additive and keeps historical rows.

BEGIN;

CREATE TABLE IF NOT EXISTS public.facturapi_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed')),
  error_message text
);
ALTER TABLE public.facturapi_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facturapi_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.facturapi_webhook_events TO service_role;

-- Normalize legacy configuration before narrowing the allowed values.
UPDATE public.platform_settings
SET accounting_provider = 'internal'
WHERE accounting_provider IS NULL
   OR accounting_provider IN ('zoho_books', 'odoo', 'quickbooks', 'contpaqi_cloud');

UPDATE public.platform_settings
SET accounting_sync_enabled = true
WHERE accounting_provider = 'internal';

UPDATE public.platform_settings
SET pac_provider = 'facturapi'
WHERE pac_provider IS NULL
   OR pac_provider IN ('none', 'sw_sapien', 'contpaqi', 'zoho_books');

ALTER TABLE public.platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_accounting_provider_check;
ALTER TABLE public.platform_settings
  ADD CONSTRAINT platform_settings_accounting_provider_check
  CHECK (accounting_provider IN ('none', 'internal'));

ALTER TABLE public.platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_pac_provider_check;
ALTER TABLE public.platform_settings
  ADD CONSTRAINT platform_settings_pac_provider_check
  CHECK (pac_provider = 'facturapi');

-- A line must represent one side of a journal entry, never both.
ALTER TABLE public.accounting_entry_lines
  DROP CONSTRAINT IF EXISTS accounting_entry_lines_one_side_check;
ALTER TABLE public.accounting_entry_lines
  ADD CONSTRAINT accounting_entry_lines_one_side_check
  CHECK (NOT (debit > 0 AND credit > 0)) NOT VALID;

CREATE OR REPLACE FUNCTION public.enforce_accounting_line_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_posted boolean;
BEGIN
  IF TG_OP <> 'DELETE' AND NEW.debit > 0 AND NEW.credit > 0 THEN
    RAISE EXCEPTION 'Una partida no puede tener débito y crédito simultáneamente';
  END IF;

  SELECT is_posted INTO v_posted
  FROM public.accounting_entries
  WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);

  IF TG_OP <> 'INSERT' AND COALESCE(v_posted, false) THEN
    RAISE EXCEPTION 'Las partidas de una póliza publicada son inmutables';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_accounting_line_integrity ON public.accounting_entry_lines;
CREATE TRIGGER trg_accounting_line_integrity
BEFORE INSERT OR UPDATE OR DELETE ON public.accounting_entry_lines
FOR EACH ROW EXECUTE FUNCTION public.enforce_accounting_line_integrity();

CREATE OR REPLACE FUNCTION public.validate_posted_accounting_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debit numeric;
  v_credit numeric;
  v_lines integer;
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_posted THEN
    RAISE EXCEPTION 'Una póliza publicada no puede eliminarse; genere una reversa';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.is_posted THEN
    RAISE EXCEPTION 'Una póliza publicada es inmutable; genere una reversa';
  END IF;

  -- Inserts are validated by the deferred constraint trigger below. This is
  -- required because the existing accounting RPCs insert the header before
  -- inserting its lines in the same transaction.
  IF TG_OP = 'UPDATE' AND NEW.is_posted AND NOT OLD.is_posted THEN
    SELECT COUNT(*), COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO v_lines, v_debit, v_credit
    FROM public.accounting_entry_lines
    WHERE entry_id = NEW.id;

    IF v_lines = 0 OR v_debit <> v_credit THEN
      RAISE EXCEPTION 'La póliza publicada debe tener partidas y estar balanceada (débito %, crédito %)', v_debit, v_credit;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_posted_accounting_entry ON public.accounting_entries;
CREATE TRIGGER trg_validate_posted_accounting_entry
BEFORE INSERT OR UPDATE OR DELETE ON public.accounting_entries
FOR EACH ROW EXECUTE FUNCTION public.validate_posted_accounting_entry();

CREATE OR REPLACE FUNCTION public.validate_posted_accounting_entry_deferred()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debit numeric;
  v_credit numeric;
  v_lines integer;
  v_entry_id uuid := COALESCE(NEW.id, OLD.id);
BEGIN
  IF TG_OP = 'DELETE' OR NOT COALESCE(NEW.is_posted, OLD.is_posted, false) THEN
    RETURN NULL;
  END IF;
  SELECT COUNT(*), COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_lines, v_debit, v_credit
  FROM public.accounting_entry_lines WHERE entry_id = v_entry_id;
  IF v_lines = 0 OR v_debit <> v_credit THEN
    RAISE EXCEPTION 'La póliza publicada debe tener partidas y estar balanceada (débito %, crédito %)', v_debit, v_credit;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_posted_accounting_entry_deferred ON public.accounting_entries;
CREATE CONSTRAINT TRIGGER trg_validate_posted_accounting_entry_deferred
AFTER INSERT OR UPDATE ON public.accounting_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_posted_accounting_entry_deferred();

CREATE OR REPLACE FUNCTION public.validate_posted_accounting_entry_lines()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id uuid := COALESCE(NEW.entry_id, OLD.entry_id);
  v_posted boolean;
  v_debit numeric;
  v_credit numeric;
  v_lines integer;
BEGIN
  SELECT is_posted INTO v_posted FROM public.accounting_entries WHERE id = v_entry_id;
  IF NOT COALESCE(v_posted, false) THEN RETURN NULL; END IF;

  SELECT COUNT(*), COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO v_lines, v_debit, v_credit
  FROM public.accounting_entry_lines
  WHERE entry_id = v_entry_id;

  IF v_lines = 0 OR v_debit <> v_credit THEN
    RAISE EXCEPTION 'La póliza publicada debe permanecer balanceada';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_posted_accounting_entry_lines ON public.accounting_entry_lines;
CREATE CONSTRAINT TRIGGER trg_validate_posted_accounting_entry_lines
AFTER INSERT OR UPDATE OR DELETE ON public.accounting_entry_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_posted_accounting_entry_lines();

-- Serialize monthly folio allocation. MAX remains compatible with historical
-- formats, while the transaction advisory lock removes duplicate folios.
CREATE OR REPLACE FUNCTION public.generate_entry_number(
  p_type text,
  p_year integer DEFAULT NULL,
  p_month integer DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year integer := COALESCE(p_year, date_part('year', now())::integer);
  v_month integer := COALESCE(p_month, date_part('month', now())::integer);
  v_prefix text;
  v_seq integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    format('accounting-folio:%s:%s:%s', p_type, v_year, v_month), 0
  ));

  v_prefix := CASE p_type
    WHEN 'ingreso' THEN 'I'
    WHEN 'egreso' THEN 'E'
    WHEN 'apertura' THEN 'A'
    ELSE 'D'
  END;

  SELECT COALESCE(MAX(NULLIF(regexp_replace(entry_number, '^.*-([0-9]{4})$', E'\\1'), entry_number)::integer), 0) + 1
  INTO v_seq
  FROM public.accounting_entries
  WHERE entry_type = p_type AND period_year = v_year AND period_month = v_month;

  RETURN v_prefix || '-' || v_year || '-' || lpad(v_month::text, 2, '0') || '-' || lpad(v_seq::text, 4, '0');
END;
$$;

-- Single transaction boundary for generic processor movements (refund fees,
-- disputes and processor payouts). The function is service-role-only because
-- callers receive the accounting side effect, not a draft object.
CREATE OR REPLACE FUNCTION public.create_accounting_entry_atomic(
  p_entry_type text,
  p_description text,
  p_source_type text,
  p_source_id uuid,
  p_entry_date date,
  p_lines jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
  v_entry uuid;
  v_year integer := EXTRACT(YEAR FROM p_entry_date)::integer;
  v_month integer := EXTRACT(MONTH FROM p_entry_date)::integer;
  v_debit numeric;
  v_credit numeric;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Acceso no autorizado';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    format('accounting-source:%s:%s', p_source_type, p_source_id), 0
  ));
  SELECT id INTO v_existing FROM accounting_entries
  WHERE source_type = p_source_type AND source_id = p_source_id
  LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT COALESCE(SUM((x->>'debit')::numeric), 0),
         COALESCE(SUM((x->>'credit')::numeric), 0)
  INTO v_debit, v_credit
  FROM jsonb_array_elements(p_lines) x;
  IF jsonb_array_length(p_lines) < 2 OR v_debit <= 0 OR v_debit <> v_credit THEN
    RAISE EXCEPTION 'El asiento debe tener al menos dos partidas y estar balanceado';
  END IF;

  v_entry := gen_random_uuid();
  INSERT INTO accounting_entries (
    id, entry_number, entry_type, entry_date, period_year, period_month,
    description, source_type, source_id, is_posted, posted_at
  ) VALUES (
    v_entry, generate_entry_number(p_entry_type, v_year, v_month),
    p_entry_type, p_entry_date, v_year, v_month, p_description,
    p_source_type, p_source_id, false, NULL
  );

  INSERT INTO accounting_entry_lines (
    entry_id, line_number, account_code, description, debit, credit
  )
  SELECT v_entry, row_number() OVER (), x->>'account_code',
         COALESCE(x->>'description', p_description),
         COALESCE((x->>'debit')::numeric, 0),
         COALESCE((x->>'credit')::numeric, 0)
  FROM jsonb_array_elements(p_lines) x;

  UPDATE accounting_entries
  SET is_posted = true, posted_at = now(), updated_at = now()
  WHERE id = v_entry;
  RETURN v_entry;
END;
$$;

REVOKE ALL ON FUNCTION public.create_accounting_entry_atomic(text, text, text, uuid, date, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_accounting_entry_atomic(text, text, text, uuid, date, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_executive_commissions_batch(
  p_from_date date DEFAULT (current_date - 90),
  p_to_date date DEFAULT current_date
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
  v_entry uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() AND NOT public.is_accountant_user() THEN
    RAISE EXCEPTION 'Acceso no autorizado';
  END IF;
  FOR v_row IN
    SELECT ec.id, ec.amount, ec.paid_at, ec.payment_reference,
           trim(COALESCE(ae.first_name, '') || ' ' || COALESCE(ae.last_name, '')) AS executive_name
    FROM executive_commissions ec
    LEFT JOIN account_executives ae ON ae.id = ec.executive_id
    WHERE ec.status = 'paid'
      AND COALESCE(ec.paid_at, ec.created_at)::date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (
        SELECT 1 FROM accounting_entries ae
        WHERE ae.source_type = 'executive_commission' AND ae.source_id = ec.id
      )
  LOOP
    v_entry := public.create_accounting_entry_atomic(
      'egreso',
      'Comision ejecutivo ' || v_row.executive_name || ' - ref: ' || COALESCE(v_row.payment_reference, ''),
      'executive_commission',
      v_row.id,
      COALESCE(v_row.paid_at::date, current_date),
      jsonb_build_array(
        jsonb_build_object('account_code', '601.05', 'description', 'Comision ejecutivo ' || v_row.executive_name, 'debit', v_row.amount, 'credit', 0),
        jsonb_build_object('account_code', '102', 'description', 'Pago comision ejecutivo - ' || COALESCE(v_row.payment_reference, ''), 'debit', 0, 'credit', v_row.amount)
      )
    );
    IF v_entry IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_executive_commissions_batch(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_executive_commissions_batch(date, date) TO service_role;

-- The scheduled job must pass a real range. Explicit NULL bypasses function
-- defaults and makes BETWEEN predicates match no rows.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-accounting-entries-daily') THEN
    PERFORM cron.unschedule('generate-accounting-entries-daily');
  END IF;
  PERFORM cron.schedule(
    'generate-accounting-entries-daily',
    '0 4 * * *',
    $job$SELECT public.generate_accounting_entries_batch(current_date - 1, current_date - 1);$job$
  );
EXCEPTION WHEN undefined_table OR undefined_function THEN
  -- Local/test databases may not have pg_cron installed.
  NULL;
END;
$$;

-- Correct financial statements: excluded entries must not remain in the
-- aggregate through a LEFT JOIN.
CREATE OR REPLACE FUNCTION public.get_income_statement(
  p_from_year integer, p_from_month integer,
  p_to_year integer, p_to_month integer
)
RETURNS TABLE(code text, name text, account_type text, total_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_user() AND NOT public.is_accountant_user() THEN
    RAISE EXCEPTION 'Acceso no autorizado';
  END IF;
  RETURN QUERY
  SELECT coa.code, coa.name, coa.account_type,
    CASE WHEN coa.nature = 'acreedora'
      THEN COALESCE(SUM(ael.credit), 0) - COALESCE(SUM(ael.debit), 0)
      ELSE COALESCE(SUM(ael.debit), 0) - COALESCE(SUM(ael.credit), 0)
    END
  FROM public.chart_of_accounts coa
  JOIN public.accounting_entry_lines ael ON ael.account_code = coa.code
  JOIN public.accounting_entries ae ON ae.id = ael.entry_id
  WHERE coa.account_type IN ('ingreso', 'gasto', 'costo')
    AND coa.is_active = true
    AND ae.is_posted = true
    AND (ae.period_year, ae.period_month) >= (p_from_year, p_from_month)
    AND (ae.period_year, ae.period_month) <= (p_to_year, p_to_month)
  GROUP BY coa.code, coa.name, coa.account_type, coa.nature
  HAVING SUM(ael.debit) <> 0 OR SUM(ael.credit) <> 0
  ORDER BY coa.code;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_balance_sheet(p_year integer, p_month integer)
RETURNS TABLE(code text, name text, account_type text, nature text, balance numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_user() AND NOT public.is_accountant_user() THEN
    RAISE EXCEPTION 'Acceso no autorizado';
  END IF;
  RETURN QUERY
  SELECT coa.code, coa.name, coa.account_type, coa.nature,
    CASE WHEN coa.nature = 'deudora'
      THEN COALESCE(SUM(ael.debit), 0) - COALESCE(SUM(ael.credit), 0)
      ELSE COALESCE(SUM(ael.credit), 0) - COALESCE(SUM(ael.debit), 0)
    END
  FROM public.chart_of_accounts coa
  JOIN public.accounting_entry_lines ael ON ael.account_code = coa.code
  JOIN public.accounting_entries ae ON ae.id = ael.entry_id
  WHERE coa.account_type IN ('activo', 'pasivo', 'capital', 'ingreso', 'gasto', 'costo')
    AND coa.is_active = true AND coa.level >= 3
    AND ae.is_posted = true
    AND (ae.period_year, ae.period_month) <= (p_year, p_month)
  GROUP BY coa.code, coa.name, coa.account_type, coa.nature
  HAVING ABS(CASE WHEN coa.nature = 'deudora'
    THEN COALESCE(SUM(ael.debit), 0) - COALESCE(SUM(ael.credit), 0)
    ELSE COALESCE(SUM(ael.credit), 0) - COALESCE(SUM(ael.debit), 0) END) > 0
  ORDER BY coa.code;
END;
$$;

COMMIT;
