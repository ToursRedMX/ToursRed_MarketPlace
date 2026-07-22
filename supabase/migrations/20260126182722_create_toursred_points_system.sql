
-- Create toursred_points_wallets table
CREATE TABLE IF NOT EXISTS toursred_points_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance integer DEFAULT 0 CHECK (balance >= 0),
  total_earned integer DEFAULT 0 CHECK (total_earned >= 0),
  total_used integer DEFAULT 0 CHECK (total_used >= 0),
  total_expired integer DEFAULT 0 CHECK (total_expired >= 0),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- Create toursred_points_transactions table
CREATE TABLE IF NOT EXISTS toursred_points_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES toursred_points_wallets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount integer NOT NULL,
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  type text NOT NULL CHECK (type IN ('earned', 'redeemed', 'expired', 'refund', 'adjustment')),
  description text NOT NULL,
  reference_id uuid,
  reference_type text CHECK (reference_type IN ('booking', 'adjustment', 'promotion')),
  expires_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Add points fields to bookings table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bookings' AND column_name = 'points_earned'
  ) THEN
    ALTER TABLE bookings ADD COLUMN points_earned integer DEFAULT 0 CHECK (points_earned >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bookings' AND column_name = 'points_used'
  ) THEN
    ALTER TABLE bookings ADD COLUMN points_used integer DEFAULT 0 CHECK (points_used >= 0);
  END IF;
END $$;

-- Add constraint to bookings: points_used cannot exceed 50% of total_price
-- Drop constraint if exists to avoid conflicts
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_points_usage_limit;

-- Add the constraint (points_used in cents must be <= 50% of total_price in cents)
-- Since 100 points = 1 peso, points_used must be <= (total_price * 100 * 0.5) = total_price * 50
ALTER TABLE bookings ADD CONSTRAINT bookings_points_usage_limit 
  CHECK (points_used <= (total_price * 50));

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_points_wallets_user_id ON toursred_points_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_points_wallets_is_active ON toursred_points_wallets(is_active);

CREATE INDEX IF NOT EXISTS idx_points_transactions_wallet_id ON toursred_points_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_points_transactions_user_id ON toursred_points_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_points_transactions_type ON toursred_points_transactions(type);
CREATE INDEX IF NOT EXISTS idx_points_transactions_expires_at ON toursred_points_transactions(expires_at) 
  WHERE expires_at IS NOT NULL AND type = 'earned';
CREATE INDEX IF NOT EXISTS idx_points_transactions_created_at ON toursred_points_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_points_transactions_reference ON toursred_points_transactions(reference_type, reference_id);

-- Enable RLS
ALTER TABLE toursred_points_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE toursred_points_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for toursred_points_wallets

-- Users can view their own wallet
CREATE POLICY "Users can view own points wallet"
  ON toursred_points_wallets FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Admins can view all wallets
CREATE POLICY "Admins can view all points wallets"
  ON toursred_points_wallets FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Only service role can insert/update wallets (through functions)
CREATE POLICY "Service role can manage wallets"
  ON toursred_points_wallets FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS Policies for toursred_points_transactions

-- Users can view their own transactions
CREATE POLICY "Users can view own points transactions"
  ON toursred_points_transactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Admins can view all transactions
CREATE POLICY "Admins can view all points transactions"
  ON toursred_points_transactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Only service role can insert transactions (through functions)
CREATE POLICY "Service role can manage transactions"
  ON toursred_points_transactions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_points_wallet_updated_at()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Create trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_points_wallet_timestamp ON toursred_points_wallets;
CREATE TRIGGER update_points_wallet_timestamp
  BEFORE UPDATE ON toursred_points_wallets
  FOR EACH ROW
  EXECUTE FUNCTION update_points_wallet_updated_at();
