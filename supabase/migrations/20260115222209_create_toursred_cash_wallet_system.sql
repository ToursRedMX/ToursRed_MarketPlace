
-- Create enum type for transaction types
DO $$ BEGIN
  CREATE TYPE toursred_cash_transaction_type AS ENUM (
    'credit',
    'debit', 
    'refund',
    'promotion',
    'gift_card',
    'adjustment'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create wallets table
CREATE TABLE IF NOT EXISTS toursred_cash_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance decimal(10,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  currency text NOT NULL DEFAULT 'MXN',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create transactions table
CREATE TABLE IF NOT EXISTS toursred_cash_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES toursred_cash_wallets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount decimal(10,2) NOT NULL,
  balance_after decimal(10,2) NOT NULL,
  type toursred_cash_transaction_type NOT NULL,
  description text NOT NULL,
  reference_id uuid,
  reference_type text,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE toursred_cash_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE toursred_cash_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for wallets

-- Users can view their own wallet
CREATE POLICY "Users can view own wallet"
  ON toursred_cash_wallets FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Admins can view all wallets
CREATE POLICY "Admins can view all wallets"
  ON toursred_cash_wallets FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  );

-- Only service role can insert wallets (automated via trigger)
CREATE POLICY "Service role can insert wallets"
  ON toursred_cash_wallets FOR INSERT
  WITH CHECK (true);

-- Only admins can update wallets (for manual adjustments)
CREATE POLICY "Admins can update wallets"
  ON toursred_cash_wallets FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  );

-- RLS Policies for transactions

-- Users can view their own transactions
CREATE POLICY "Users can view own transactions"
  ON toursred_cash_transactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Admins can view all transactions
CREATE POLICY "Admins can view all transactions"
  ON toursred_cash_transactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  );

-- Only service role can insert transactions (via functions)
CREATE POLICY "Service role can insert transactions"
  ON toursred_cash_transactions FOR INSERT
  WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON toursred_cash_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_is_active ON toursred_cash_wallets(is_active);
CREATE INDEX IF NOT EXISTS idx_transactions_wallet_id ON toursred_cash_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON toursred_cash_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON toursred_cash_transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_reference ON toursred_cash_transactions(reference_id, reference_type);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON toursred_cash_transactions(created_at DESC);

-- Function to automatically create wallet for new users
CREATE OR REPLACE FUNCTION create_wallet_for_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create wallet for travelers
  IF NEW.role = 'traveler' THEN
    INSERT INTO public.toursred_cash_wallets (user_id, balance, currency, is_active)
    VALUES (NEW.id, 0.00, 'MXN', true);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Trigger to create wallet when user is created
DROP TRIGGER IF EXISTS trigger_create_wallet_for_new_user ON users;
CREATE TRIGGER trigger_create_wallet_for_new_user
  AFTER INSERT ON users
  FOR EACH ROW
  EXECUTE FUNCTION create_wallet_for_new_user();

-- Function to update wallet updated_at timestamp
CREATE OR REPLACE FUNCTION update_wallet_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Trigger to update wallet updated_at
DROP TRIGGER IF EXISTS trigger_update_wallet_updated_at ON toursred_cash_wallets;
CREATE TRIGGER trigger_update_wallet_updated_at
  BEFORE UPDATE ON toursred_cash_wallets
  FOR EACH ROW
  EXECUTE FUNCTION update_wallet_updated_at();

-- Function to safely add/subtract from wallet balance
CREATE OR REPLACE FUNCTION update_wallet_balance(
  p_user_id uuid,
  p_amount decimal,
  p_type toursred_cash_transaction_type,
  p_description text,
  p_reference_id uuid DEFAULT NULL,
  p_reference_type text DEFAULT NULL
)
RETURNS json AS $$
DECLARE
  v_wallet_id uuid;
  v_current_balance decimal;
  v_new_balance decimal;
  v_transaction_id uuid;
BEGIN
  -- Get wallet and lock row for update
  SELECT id, balance INTO v_wallet_id, v_current_balance
  FROM public.toursred_cash_wallets
  WHERE user_id = p_user_id AND is_active = true
  FOR UPDATE;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found for user %', p_user_id;
  END IF;

  -- Calculate new balance
  v_new_balance := v_current_balance + p_amount;

  -- Ensure balance doesn't go negative
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient balance. Current: %, Attempting: %', v_current_balance, p_amount;
  END IF;

  -- Update wallet balance
  UPDATE public.toursred_cash_wallets
  SET balance = v_new_balance
  WHERE id = v_wallet_id;

  -- Create transaction record
  INSERT INTO public.toursred_cash_transactions (
    wallet_id,
    user_id,
    amount,
    balance_after,
    type,
    description,
    reference_id,
    reference_type
  ) VALUES (
    v_wallet_id,
    p_user_id,
    p_amount,
    v_new_balance,
    p_type,
    p_description,
    p_reference_id,
    p_reference_type
  ) RETURNING id INTO v_transaction_id;

  RETURN json_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'previous_balance', v_current_balance,
    'amount', p_amount,
    'new_balance', v_new_balance
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Create wallets for existing travelers who don't have one
INSERT INTO toursred_cash_wallets (user_id, balance, currency, is_active)
SELECT id, 0.00, 'MXN', true
FROM users
WHERE role = 'traveler'
AND id NOT IN (SELECT user_id FROM toursred_cash_wallets)
ON CONFLICT (user_id) DO NOTHING;
