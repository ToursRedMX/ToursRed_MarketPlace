
-- Create gift_cards table
CREATE TABLE IF NOT EXISTS gift_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  amount numeric NOT NULL CHECK (amount IN (100, 200, 500, 1000)),
  currency text DEFAULT 'MXN' NOT NULL,
  status text DEFAULT 'active' NOT NULL CHECK (status IN ('active', 'redeemed', 'expired', 'cancelled')),
  purchaser_email text NOT NULL,
  purchaser_name text NOT NULL,
  recipient_email text,
  recipient_name text,
  personal_message text,
  purchased_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz NOT NULL,
  redeemed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  redeemed_at timestamptz,
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  scheduled_send_date timestamptz,
  email_sent_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Create indexes for gift_cards
CREATE INDEX IF NOT EXISTS idx_gift_cards_code ON gift_cards(code);
CREATE INDEX IF NOT EXISTS idx_gift_cards_status ON gift_cards(status);
CREATE INDEX IF NOT EXISTS idx_gift_cards_redeemed_by ON gift_cards(redeemed_by);
CREATE INDEX IF NOT EXISTS idx_gift_cards_purchaser_email ON gift_cards(purchaser_email);
CREATE INDEX IF NOT EXISTS idx_gift_cards_expires_at ON gift_cards(expires_at);
CREATE INDEX IF NOT EXISTS idx_gift_cards_stripe_payment_intent ON gift_cards(stripe_payment_intent_id);

-- Create gift_card_redemption_attempts table
CREATE TABLE IF NOT EXISTS gift_card_redemption_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id uuid REFERENCES gift_cards(id) ON DELETE SET NULL,
  code_entered text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ip_address text,
  success boolean DEFAULT false NOT NULL,
  failure_reason text,
  attempted_at timestamptz DEFAULT now() NOT NULL,
  user_agent text
);

-- Create indexes for gift_card_redemption_attempts
CREATE INDEX IF NOT EXISTS idx_redemption_attempts_gift_card ON gift_card_redemption_attempts(gift_card_id);
CREATE INDEX IF NOT EXISTS idx_redemption_attempts_user ON gift_card_redemption_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_redemption_attempts_attempted_at ON gift_card_redemption_attempts(attempted_at);
CREATE INDEX IF NOT EXISTS idx_redemption_attempts_ip_address ON gift_card_redemption_attempts(ip_address);

-- Enable RLS
ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_card_redemption_attempts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for gift_cards

-- Allow service role full access (for Edge Functions)
CREATE POLICY "Service role has full access to gift cards"
  ON gift_cards FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to view cards they redeemed
CREATE POLICY "Users can view their redeemed gift cards"
  ON gift_cards FOR SELECT
  TO authenticated
  USING (redeemed_by = auth.uid());

-- Allow admins to view all gift cards
CREATE POLICY "Admins can view all gift cards"
  ON gift_cards FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Allow admins to update gift cards
CREATE POLICY "Admins can update gift cards"
  ON gift_cards FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- RLS Policies for gift_card_redemption_attempts

-- Allow service role full access
CREATE POLICY "Service role has full access to redemption attempts"
  ON gift_card_redemption_attempts FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to insert redemption attempts
CREATE POLICY "Users can create redemption attempts"
  ON gift_card_redemption_attempts FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Allow admins to view all redemption attempts
CREATE POLICY "Admins can view all redemption attempts"
  ON gift_card_redemption_attempts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_gift_card_updated_at()
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

-- Trigger to automatically update updated_at
DROP TRIGGER IF EXISTS set_gift_card_updated_at ON gift_cards;
CREATE TRIGGER set_gift_card_updated_at
  BEFORE UPDATE ON gift_cards
  FOR EACH ROW
  EXECUTE FUNCTION update_gift_card_updated_at();

-- Function to automatically expire gift cards (can be called by cron job)
CREATE OR REPLACE FUNCTION expire_old_gift_cards()
RETURNS INTEGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  UPDATE gift_cards
  SET status = 'expired',
      updated_at = now()
  WHERE status = 'active'
    AND expires_at < now();
  
  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$;

-- Function to generate unique gift card code
CREATE OR REPLACE FUNCTION generate_gift_card_code()
RETURNS TEXT
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  new_code TEXT;
  code_exists BOOLEAN;
  -- Characters excluding confusing ones (0, O, I, 1)
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  attempt INTEGER := 0;
  max_attempts INTEGER := 100;
BEGIN
  LOOP
    -- Generate 4 blocks of 4 characters
    new_code := '';
    FOR i IN 1..4 LOOP
      IF i > 1 THEN
        new_code := new_code || '-';
      END IF;
      
      FOR j IN 1..4 LOOP
        new_code := new_code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
      END LOOP;
    END LOOP;
    
    -- Check if code already exists
    SELECT EXISTS(SELECT 1 FROM gift_cards WHERE code = new_code) INTO code_exists;
    
    -- If code is unique, return it
    IF NOT code_exists THEN
      RETURN new_code;
    END IF;
    
    -- Increment attempt counter
    attempt := attempt + 1;
    
    -- Safety check to prevent infinite loop
    IF attempt >= max_attempts THEN
      RAISE EXCEPTION 'Failed to generate unique gift card code after % attempts', max_attempts;
    END IF;
  END LOOP;
END;
$$;
