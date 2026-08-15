-- Create agency_payouts table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.agency_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid REFERENCES public.agencies(id),
  payment_date date DEFAULT CURRENT_DATE,
  amount numeric CHECK (amount >= 0),
  payment_method text CHECK (payment_method = ANY (ARRAY['spei_transfer','international_transfer','check','cash','other'])),
  bank_reference text,
  receipt_url text,
  status text DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending','processing','completed','failed','cancelled'])),
  notes text,
  external_transaction_id text,
  bank_account_id text,
  erp_sync_status text CHECK (erp_sync_status = ANY (ARRAY['synced','pending','failed','not_applicable'])),
  erp_invoice_id text,
  erp_reference text,
  processed_by uuid REFERENCES public.users(id),
  commission_records_count integer DEFAULT 0 CHECK (commission_records_count >= 0),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create payout_batches table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.payout_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_code text,
  batch_date date DEFAULT CURRENT_DATE,
  period_start date,
  period_end date,
  total_amount numeric DEFAULT 0 CHECK (total_amount >= 0),
  agencies_count integer DEFAULT 0 CHECK (agencies_count >= 0),
  payouts_count integer DEFAULT 0 CHECK (payouts_count >= 0),
  status text DEFAULT 'draft' CHECK (status = ANY (ARRAY['draft','ready','processing','completed','cancelled'])),
  processed_by uuid REFERENCES public.users(id),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  processed_at timestamptz
);

-- Create financial_transactions table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.financial_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_date timestamptz DEFAULT now(),
  transaction_type text CHECK (transaction_type = ANY (ARRAY['booking','cancellation_full','cancellation_partial','no_show','tour_cancellation_by_agency','adjustment','payout','refund','commission_correction'])),
  agency_id uuid REFERENCES public.agencies(id),
  booking_id uuid REFERENCES public.bookings(id),
  tour_id uuid REFERENCES public.tours(id),
  cancellation_id uuid,
  payout_id uuid,
  gross_amount numeric DEFAULT 0,
  platform_commission numeric DEFAULT 0,
  net_to_agency numeric DEFAULT 0,
  platform_revenue numeric DEFAULT 0,
  description text,
  payment_status text DEFAULT 'pending' CHECK (payment_status = ANY (ARRAY['pending','paid','cancelled'])),
  reconciliation_status text DEFAULT 'pending' CHECK (reconciliation_status = ANY (ARRAY['reconciled','pending','disputed'])),
  metadata jsonb,
  created_by_user_id uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);

-- Create payout_schedules table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.payout_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid UNIQUE REFERENCES public.agencies(id),
  frequency text DEFAULT 'weekly' CHECK (frequency = ANY (ARRAY['weekly','biweekly','monthly'])),
  day_of_week integer CHECK (day_of_week >= 1 AND day_of_week <= 7),
  day_of_month integer CHECK (day_of_month >= 1 AND day_of_month <= 31),
  minimum_payout_amount numeric DEFAULT 500.00 CHECK (minimum_payout_amount >= 0),
  preferred_payment_method text DEFAULT 'spei_transfer' CHECK (preferred_payment_method = ANY (ARRAY['spei_transfer','international_transfer','check','cash','other'])),
  bank_account_holder_name text,
  bank_name text,
  bank_account_number text,
  bank_clabe text,
  bank_swift_code text,
  payment_currency text DEFAULT 'MXN' CHECK (payment_currency = ANY (ARRAY['MXN','USD','EUR'])),
  automatic_payout_enabled boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add missing columns to agency_payouts
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agency_payouts' AND column_name = 'payout_code') THEN
    ALTER TABLE agency_payouts ADD COLUMN payout_code text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agency_payouts' AND column_name = 'payout_batch_id') THEN
    ALTER TABLE agency_payouts ADD COLUMN payout_batch_id uuid REFERENCES payout_batches(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agency_payouts' AND column_name = 'email_sent') THEN
    ALTER TABLE agency_payouts ADD COLUMN email_sent boolean NOT NULL DEFAULT false;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agency_payouts' AND column_name = 'payout_date')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agency_payouts' AND column_name = 'payment_date') THEN
    ALTER TABLE agency_payouts RENAME COLUMN payout_date TO payment_date;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agency_payouts' AND column_name = 'processed_by_user_id')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agency_payouts' AND column_name = 'processed_by') THEN
    ALTER TABLE agency_payouts RENAME COLUMN processed_by_user_id TO processed_by;
  END IF;
END $$;

-- Add missing columns to payout_batches
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payout_batches' AND column_name = 'batch_name')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payout_batches' AND column_name = 'batch_code') THEN
    ALTER TABLE payout_batches RENAME COLUMN batch_name TO batch_code;
  ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payout_batches' AND column_name = 'batch_code') THEN
    ALTER TABLE payout_batches ADD COLUMN batch_code text;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payout_batches' AND column_name = 'processed_by_user_id')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payout_batches' AND column_name = 'processed_by') THEN
    ALTER TABLE payout_batches RENAME COLUMN processed_by_user_id TO processed_by;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payout_batches' AND column_name = 'completed_at')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payout_batches' AND column_name = 'processed_at') THEN
    ALTER TABLE payout_batches RENAME COLUMN completed_at TO processed_at;
  ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payout_batches' AND column_name = 'processed_at') THEN
    ALTER TABLE payout_batches ADD COLUMN processed_at timestamptz;
  END IF;
END $$;

-- Add missing columns to financial_transactions
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'financial_transactions' AND column_name = 'transaction_code') THEN
    ALTER TABLE financial_transactions ADD COLUMN transaction_code text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'financial_transactions' AND column_name = 'tour_start_date') THEN
    ALTER TABLE financial_transactions ADD COLUMN tour_start_date date;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'financial_transactions' AND column_name = 'commission_rate') THEN
    ALTER TABLE financial_transactions ADD COLUMN commission_rate numeric(5, 4);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'financial_transactions' AND column_name = 'commission_amount') THEN
    ALTER TABLE financial_transactions ADD COLUMN commission_amount numeric(12, 2);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'financial_transactions' AND column_name = 'notes') THEN
    ALTER TABLE financial_transactions ADD COLUMN notes text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'financial_transactions' AND column_name = 'updated_at') THEN
    ALTER TABLE financial_transactions ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

-- Add missing columns to payout_schedules
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payout_schedules' AND column_name = 'last_payout_date') THEN
    ALTER TABLE payout_schedules ADD COLUMN last_payout_date date;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payout_schedules' AND column_name = 'next_scheduled_payout') THEN
    ALTER TABLE payout_schedules ADD COLUMN next_scheduled_payout date;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payout_schedules' AND column_name = 'notes') THEN
    ALTER TABLE payout_schedules ADD COLUMN notes text;
  END IF;
END $$;

-- Add missing columns to commission_records
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'commission_records' AND column_name = 'payout_id') THEN
    ALTER TABLE commission_records ADD COLUMN payout_id uuid REFERENCES agency_payouts(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'commission_records' AND column_name = 'payout_scheduled_date') THEN
    ALTER TABLE commission_records ADD COLUMN payout_scheduled_date date;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'commission_records' AND column_name = 'reconciliation_status') THEN
    ALTER TABLE commission_records ADD COLUMN reconciliation_status text NOT NULL DEFAULT 'pending';
  END IF;
END $$;

-- Add constraint to reconciliation_status in commission_records
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_records_reconciliation_status_check') THEN
    ALTER TABLE commission_records ADD CONSTRAINT commission_records_reconciliation_status_check 
      CHECK (reconciliation_status IN ('pending', 'reconciled', 'disputed'));
  END IF;
END $$;

-- Update payout codes for existing records
WITH numbered_payouts AS (
  SELECT id, 
    'PAY-' || EXTRACT(YEAR FROM created_at)::text || '-' || LPAD(row_number() OVER (ORDER BY created_at)::text, 6, '0') as new_code
  FROM agency_payouts
  WHERE payout_code IS NULL
)
UPDATE agency_payouts 
SET payout_code = numbered_payouts.new_code
FROM numbered_payouts
WHERE agency_payouts.id = numbered_payouts.id;

-- Update batch codes for existing records
WITH numbered_batches AS (
  SELECT id, 
    'BATCH-' || EXTRACT(YEAR FROM created_at)::text || '-W' || LPAD(EXTRACT(WEEK FROM created_at)::text, 2, '0') || '-' || LPAD(row_number() OVER (ORDER BY created_at)::text, 3, '0') as new_code
  FROM payout_batches
  WHERE batch_code IS NULL OR batch_code = ''
)
UPDATE payout_batches 
SET batch_code = numbered_batches.new_code
FROM numbered_batches
WHERE payout_batches.id = numbered_batches.id;

-- Update transaction codes for existing records
WITH numbered_transactions AS (
  SELECT id, 
    'TXN-' || EXTRACT(YEAR FROM created_at)::text || '-' || LPAD(row_number() OVER (ORDER BY created_at)::text, 9, '0') as new_code
  FROM financial_transactions
  WHERE transaction_code IS NULL
)
UPDATE financial_transactions 
SET transaction_code = numbered_transactions.new_code
FROM numbered_transactions
WHERE financial_transactions.id = numbered_transactions.id;

-- Add unique constraints
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agency_payouts_payout_code_key') THEN
    ALTER TABLE agency_payouts ADD CONSTRAINT agency_payouts_payout_code_key UNIQUE (payout_code);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payout_batches_batch_code_key') THEN
    ALTER TABLE payout_batches ADD CONSTRAINT payout_batches_batch_code_key UNIQUE (batch_code);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_transactions_transaction_code_key') THEN
    ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_transaction_code_key UNIQUE (transaction_code);
  END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_agency_payouts_agency_id ON agency_payouts(agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_payouts_status ON agency_payouts(status);
CREATE INDEX IF NOT EXISTS idx_agency_payouts_batch_id ON agency_payouts(payout_batch_id);
CREATE INDEX IF NOT EXISTS idx_payout_batches_status ON payout_batches(status);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_agency_id ON financial_transactions(agency_id);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_tour_id ON financial_transactions(tour_id);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_booking_id ON financial_transactions(booking_id);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_payout_id ON financial_transactions(payout_id);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_type ON financial_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_payment_status ON financial_transactions(payment_status);
CREATE INDEX IF NOT EXISTS idx_payout_schedules_agency_id ON payout_schedules(agency_id);
CREATE INDEX IF NOT EXISTS idx_payout_schedules_next_scheduled ON payout_schedules(next_scheduled_payout);
CREATE INDEX IF NOT EXISTS idx_commission_records_payout_id ON commission_records(payout_id);
CREATE INDEX IF NOT EXISTS idx_commission_records_reconciliation ON commission_records(reconciliation_status);

-- Create function to generate payout codes
CREATE OR REPLACE FUNCTION generate_payout_code()
RETURNS text AS $$
DECLARE
  next_num integer;
  year_str text;
BEGIN
  year_str := EXTRACT(YEAR FROM CURRENT_DATE)::text;
  SELECT COALESCE(MAX(CAST(SUBSTRING(payout_code FROM 'PAY-\d{4}-(\d+)') AS integer)), 0) + 1
  INTO next_num
  FROM agency_payouts
  WHERE payout_code LIKE 'PAY-' || year_str || '-%';
  RETURN 'PAY-' || year_str || '-' || LPAD(next_num::text, 6, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create function to generate batch codes
CREATE OR REPLACE FUNCTION generate_batch_code(p_period_start date)
RETURNS text AS $$
DECLARE
  year_str text;
  week_num text;
BEGIN
  year_str := EXTRACT(YEAR FROM p_period_start)::text;
  week_num := 'W' || LPAD(EXTRACT(WEEK FROM p_period_start)::text, 2, '0');
  RETURN 'BATCH-' || year_str || '-' || week_num;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create function to generate transaction codes
CREATE OR REPLACE FUNCTION generate_transaction_code()
RETURNS text AS $$
DECLARE
  next_num integer;
  year_str text;
BEGIN
  year_str := EXTRACT(YEAR FROM CURRENT_DATE)::text;
  SELECT COALESCE(MAX(CAST(SUBSTRING(transaction_code FROM 'TXN-\d{4}-(\d+)') AS integer)), 0) + 1
  INTO next_num
  FROM financial_transactions
  WHERE transaction_code LIKE 'TXN-' || year_str || '-%';
  RETURN 'TXN-' || year_str || '-' || LPAD(next_num::text, 9, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create update function for updated_at
CREATE OR REPLACE FUNCTION update_financial_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create triggers for updated_at
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_agency_payouts_updated_at') THEN
    CREATE TRIGGER update_agency_payouts_updated_at
      BEFORE UPDATE ON agency_payouts
      FOR EACH ROW EXECUTE FUNCTION update_financial_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_payout_batches_updated_at') THEN
    CREATE TRIGGER update_payout_batches_updated_at
      BEFORE UPDATE ON payout_batches
      FOR EACH ROW EXECUTE FUNCTION update_financial_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_financial_transactions_updated_at') THEN
    CREATE TRIGGER update_financial_transactions_updated_at
      BEFORE UPDATE ON financial_transactions
      FOR EACH ROW EXECUTE FUNCTION update_financial_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_payout_schedules_updated_at') THEN
    CREATE TRIGGER update_payout_schedules_updated_at
      BEFORE UPDATE ON payout_schedules
      FOR EACH ROW EXECUTE FUNCTION update_financial_updated_at();
  END IF;

  -- Solo crear si la tabla existe
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'integration_configs')
    AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_integration_configs_updated_at') THEN
    CREATE TRIGGER update_integration_configs_updated_at
      BEFORE UPDATE ON integration_configs
      FOR EACH ROW EXECUTE FUNCTION update_financial_updated_at();
  END IF;
END $$;
