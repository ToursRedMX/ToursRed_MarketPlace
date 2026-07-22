
-- Add columns to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS referred_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS referral_code_used text;

-- Add column to bookings table
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS referral_bonus_awarded boolean DEFAULT false;

-- Add columns to platform_settings table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'platform_settings' AND column_name = 'default_max_referrals_per_user'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN default_max_referrals_per_user integer DEFAULT 10;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'platform_settings' AND column_name = 'referral_bonus_points'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN referral_bonus_points integer DEFAULT 5000;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'platform_settings' AND column_name = 'referral_program_enabled'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN referral_program_enabled boolean DEFAULT true;
  END IF;
END $$;

-- Update existing platform_settings record if exists
UPDATE platform_settings 
SET 
  default_max_referrals_per_user = COALESCE(default_max_referrals_per_user, 10),
  referral_bonus_points = COALESCE(referral_bonus_points, 5000),
  referral_program_enabled = COALESCE(referral_program_enabled, true)
WHERE id IS NOT NULL;

-- Create referral_codes table
CREATE TABLE IF NOT EXISTS referral_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code text UNIQUE NOT NULL,
  is_active boolean DEFAULT true,
  successful_referrals_count integer DEFAULT 0,
  max_referrals_allowed integer DEFAULT 10,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create referral_relationships table
CREATE TABLE IF NOT EXISTS referral_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referral_code_used text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  referrer_bonus_awarded boolean DEFAULT false,
  referred_bonus_awarded boolean DEFAULT false,
  first_booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  is_suspicious boolean DEFAULT false,
  UNIQUE(referred_user_id)
);

-- Create referral_bonuses table
CREATE TABLE IF NOT EXISTS referral_bonuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_relationship_id uuid NOT NULL REFERENCES referral_relationships(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points_amount integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'awarded', 'expired')),
  awarded_at timestamptz,
  reason text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create referral_fraud_logs table
CREATE TABLE IF NOT EXISTS referral_fraud_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_relationship_id uuid NOT NULL REFERENCES referral_relationships(id) ON DELETE CASCADE,
  fraud_type text NOT NULL,
  details jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_referral_codes_user_id ON referral_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_relationships_referrer ON referral_relationships(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referral_relationships_referred ON referral_relationships(referred_user_id);
CREATE INDEX IF NOT EXISTS idx_referral_relationships_status ON referral_relationships(status);
CREATE INDEX IF NOT EXISTS idx_referral_bonuses_user_id ON referral_bonuses(user_id);
CREATE INDEX IF NOT EXISTS idx_referral_bonuses_status ON referral_bonuses(status);
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by_user_id);

-- Function to generate unique referral code
CREATE OR REPLACE FUNCTION public.generate_unique_referral_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_code text;
  code_exists boolean;
  attempts integer := 0;
  max_attempts integer := 10;
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- Excluding ambiguous characters
BEGIN
  LOOP
    -- Generate 8-character code
    new_code := '';
    FOR i IN 1..8 LOOP
      new_code := new_code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    
    -- Check if code exists
    SELECT EXISTS(SELECT 1 FROM public.referral_codes WHERE code = new_code) INTO code_exists;
    
    IF NOT code_exists THEN
      RETURN new_code;
    END IF;
    
    attempts := attempts + 1;
    IF attempts >= max_attempts THEN
      RAISE EXCEPTION 'Could not generate unique referral code after % attempts', max_attempts;
    END IF;
  END LOOP;
END;
$$;

-- Function to create referral code on user signup (for travelers only)
CREATE OR REPLACE FUNCTION public.create_referral_code_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_code text;
  max_referrals integer;
BEGIN
  -- Only create referral codes for travelers
  IF NEW.role = 'traveler' THEN
    -- Get default max referrals from platform settings
    SELECT default_max_referrals_per_user INTO max_referrals
    FROM public.platform_settings
    LIMIT 1;
    
    IF max_referrals IS NULL THEN
      max_referrals := 10;
    END IF;
    
    -- Generate unique code
    new_code := public.generate_unique_referral_code();
    
    -- Insert referral code
    INSERT INTO public.referral_codes (user_id, code, max_referrals_allowed)
    VALUES (NEW.id, new_code, max_referrals);
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for automatic referral code generation
DROP TRIGGER IF EXISTS trigger_create_referral_code_on_signup ON users;
CREATE TRIGGER trigger_create_referral_code_on_signup
  AFTER INSERT ON users
  FOR EACH ROW
  EXECUTE FUNCTION public.create_referral_code_on_signup();

-- Function to award referral bonus
CREATE OR REPLACE FUNCTION public.award_referral_bonus(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking record;
  v_relationship record;
  v_bonus_points integer;
  v_program_enabled boolean;
BEGIN
  -- Get booking details
  SELECT b.*, u.id as traveler_user_id, u.referred_by_user_id
  INTO v_booking
  FROM public.bookings b
  JOIN public.users u ON b.user_id = u.id
  WHERE b.id = p_booking_id;
  
  -- Check if booking exists
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Check if referral program is enabled
  SELECT referral_program_enabled, referral_bonus_points
  INTO v_program_enabled, v_bonus_points
  FROM public.platform_settings
  LIMIT 1;
  
  IF NOT v_program_enabled THEN
    RETURN;
  END IF;
  
  -- Check if booking is confirmed and payment succeeded
  IF v_booking.status != 'confirmado' OR v_booking.payment_status != 'succeeded' THEN
    RETURN;
  END IF;
  
  -- Check if bonus already awarded
  IF v_booking.referral_bonus_awarded THEN
    RETURN;
  END IF;
  
  -- Check if user was referred
  IF v_booking.referred_by_user_id IS NULL THEN
    RETURN;
  END IF;
  
  -- Get referral relationship
  SELECT *
  INTO v_relationship
  FROM public.referral_relationships
  WHERE referred_user_id = v_booking.traveler_user_id
    AND status = 'pending';
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Check if this is the first booking for the referred user
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE user_id = v_booking.traveler_user_id
      AND status = 'confirmado'
      AND payment_status = 'succeeded'
      AND id != p_booking_id
  ) THEN
    RETURN;
  END IF;
  
  -- Award points to referrer
  INSERT INTO public.toursred_points_transactions (
    user_id, type, amount, description, reference_type, reference_id
  ) VALUES (
    v_relationship.referrer_user_id,
    'earned',
    v_bonus_points,
    'Bono por referido completado',
    'referral',
    v_relationship.id
  );
  
  -- Update referrer wallet
  UPDATE public.toursred_points_wallets
  SET 
    balance = balance + v_bonus_points,
    total_earned = total_earned + v_bonus_points,
    updated_at = now()
  WHERE user_id = v_relationship.referrer_user_id;
  
  -- Award points to referred user
  INSERT INTO public.toursred_points_transactions (
    user_id, type, amount, description, reference_type, reference_id
  ) VALUES (
    v_relationship.referred_user_id,
    'earned',
    v_bonus_points,
    'Bono de bienvenida por registro con código de referido',
    'referral',
    v_relationship.id
  );
  
  -- Update referred user wallet
  UPDATE public.toursred_points_wallets
  SET 
    balance = balance + v_bonus_points,
    total_earned = total_earned + v_bonus_points,
    updated_at = now()
  WHERE user_id = v_relationship.referred_user_id;
  
  -- Update referral relationship
  UPDATE public.referral_relationships
  SET 
    status = 'completed',
    referrer_bonus_awarded = true,
    referred_bonus_awarded = true,
    first_booking_id = p_booking_id,
    completed_at = now()
  WHERE id = v_relationship.id;
  
  -- Update successful referrals count
  UPDATE public.referral_codes
  SET 
    successful_referrals_count = successful_referrals_count + 1,
    updated_at = now()
  WHERE user_id = v_relationship.referrer_user_id;
  
  -- Create bonus records
  INSERT INTO public.referral_bonuses (
    referral_relationship_id, user_id, points_amount, status, awarded_at, reason
  ) VALUES 
    (v_relationship.id, v_relationship.referrer_user_id, v_bonus_points, 'awarded', now(), 'Referido completó primera reserva'),
    (v_relationship.id, v_relationship.referred_user_id, v_bonus_points, 'awarded', now(), 'Bono de bienvenida');
  
  -- Mark booking as bonus awarded
  UPDATE public.bookings
  SET referral_bonus_awarded = true
  WHERE id = p_booking_id;
  
  -- Create notifications
  INSERT INTO public.notifications (user_id, type, title, message, related_id)
  VALUES 
    (
      v_relationship.referrer_user_id,
      'referral_completed',
      '¡Referido completado!',
      format('Has ganado %s puntos ToursRed porque tu referido completó su primera reserva', v_bonus_points),
      v_relationship.id::text
    ),
    (
      v_relationship.referred_user_id,
      'referral_bonus_earned',
      '¡Bono de bienvenida!',
      format('Has recibido %s puntos ToursRed por registrarte con un código de referido', v_bonus_points),
      v_relationship.id::text
    );
END;
$$;

-- Trigger function to check if referral bonus should be awarded
CREATE OR REPLACE FUNCTION public.check_referral_bonus_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if booking status or payment status changed to qualified values
  IF (NEW.status = 'confirmado' AND NEW.payment_status = 'succeeded') AND
     (OLD.status != 'confirmado' OR OLD.payment_status != 'succeeded') THEN
    -- Try to award referral bonus
    PERFORM public.award_referral_bonus(NEW.id);
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger on bookings to check for referral bonus eligibility
DROP TRIGGER IF EXISTS trigger_check_referral_bonus ON bookings;
CREATE TRIGGER trigger_check_referral_bonus
  AFTER UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.check_referral_bonus_eligibility();

-- Enable RLS on all new tables
ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_bonuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_fraud_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for referral_codes

-- Users can view their own referral code
CREATE POLICY "Users can view own referral code"
  ON referral_codes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can update their own referral code (only certain fields)
CREATE POLICY "Users can update own referral code"
  ON referral_codes FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admins can view all referral codes
CREATE POLICY "Admins can view all referral codes"
  ON referral_codes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role = 'admin'
        AND users.is_active = true
    )
  );

-- Admins can update referral codes
CREATE POLICY "Admins can update referral codes"
  ON referral_codes FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role = 'admin'
        AND users.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role = 'admin'
        AND users.is_active = true
    )
  );

-- RLS Policies for referral_relationships

-- Users can view their own referral relationships (as referrer or referred)
CREATE POLICY "Users can view own referral relationships"
  ON referral_relationships FOR SELECT
  TO authenticated
  USING (
    auth.uid() = referrer_user_id OR auth.uid() = referred_user_id
  );

-- Admins can view all referral relationships
CREATE POLICY "Admins can view all referral relationships"
  ON referral_relationships FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role = 'admin'
        AND users.is_active = true
    )
  );

-- Admins can update referral relationships
CREATE POLICY "Admins can update referral relationships"
  ON referral_relationships FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role = 'admin'
        AND users.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role = 'admin'
        AND users.is_active = true
    )
  );

-- RLS Policies for referral_bonuses

-- Users can view their own bonuses
CREATE POLICY "Users can view own bonuses"
  ON referral_bonuses FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Admins can view all bonuses
CREATE POLICY "Admins can view all bonuses"
  ON referral_bonuses FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role = 'admin'
        AND users.is_active = true
    )
  );

-- RLS Policies for referral_fraud_logs

-- Only admins can view fraud logs
CREATE POLICY "Only admins can view fraud logs"
  ON referral_fraud_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role = 'admin'
        AND users.is_active = true
    )
  );

-- Generate referral codes for existing traveler users
DO $$
DECLARE
  user_record record;
  new_code text;
  max_referrals integer;
BEGIN
  -- Get default max referrals
  SELECT default_max_referrals_per_user INTO max_referrals
  FROM public.platform_settings
  LIMIT 1;
  
  IF max_referrals IS NULL THEN
    max_referrals := 10;
  END IF;
  
  -- Create referral codes for existing travelers who don't have one
  FOR user_record IN 
    SELECT u.id 
    FROM public.users u
    LEFT JOIN public.referral_codes rc ON rc.user_id = u.id
    WHERE u.role = 'traveler' AND rc.id IS NULL
  LOOP
    new_code := public.generate_unique_referral_code();
    INSERT INTO public.referral_codes (user_id, code, max_referrals_allowed)
    VALUES (user_record.id, new_code, max_referrals);
  END LOOP;
END $$;
