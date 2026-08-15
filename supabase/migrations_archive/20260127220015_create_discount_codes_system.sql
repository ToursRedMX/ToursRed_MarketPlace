
-- Create discount_codes table
CREATE TABLE IF NOT EXISTS discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  description text NOT NULL,
  discount_type text NOT NULL CHECK (discount_type IN ('tour_percentage', 'tour_fixed', 'membership_free_month', 'gift_card_percentage', 'gift_card_fixed')),
  discount_value numeric NOT NULL CHECK (discount_value > 0),
  applicable_to text NOT NULL CHECK (applicable_to IN ('tours', 'memberships', 'gift_cards')),
  is_single_use boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz NOT NULL,
  max_uses integer CHECK (max_uses IS NULL OR max_uses > 0),
  times_used integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CHECK (valid_until > valid_from)
);

-- Create discount_code_usage table
CREATE TABLE IF NOT EXISTS discount_code_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discount_code_id uuid NOT NULL REFERENCES public.discount_codes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  used_at timestamptz DEFAULT now(),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  gift_card_id uuid REFERENCES public.gift_cards(id) ON DELETE SET NULL,
  membership_id uuid REFERENCES public.memberships(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(discount_code_id, user_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_discount_codes_code ON public.discount_codes(UPPER(code));
CREATE INDEX IF NOT EXISTS idx_discount_codes_active ON public.discount_codes(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_discount_codes_valid ON public.discount_codes(valid_from, valid_until);
CREATE INDEX IF NOT EXISTS idx_discount_code_usage_code_id ON public.discount_code_usage(discount_code_id);
CREATE INDEX IF NOT EXISTS idx_discount_code_usage_user_id ON public.discount_code_usage(user_id);

-- Function to auto-uppercase code
CREATE OR REPLACE FUNCTION uppercase_discount_code()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.code = UPPER(NEW.code);
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Trigger to uppercase code
DROP TRIGGER IF EXISTS uppercase_discount_code_trigger ON public.discount_codes;
CREATE TRIGGER uppercase_discount_code_trigger
  BEFORE INSERT OR UPDATE ON public.discount_codes
  FOR EACH ROW
  EXECUTE FUNCTION uppercase_discount_code();

-- Function to increment times_used counter
CREATE OR REPLACE FUNCTION increment_discount_code_usage()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.discount_codes
  SET times_used = times_used + 1,
      updated_at = now()
  WHERE id = NEW.discount_code_id;
  RETURN NEW;
END;
$$;

-- Trigger to increment usage counter
DROP TRIGGER IF EXISTS increment_discount_code_usage_trigger ON public.discount_code_usage;
CREATE TRIGGER increment_discount_code_usage_trigger
  AFTER INSERT ON public.discount_code_usage
  FOR EACH ROW
  EXECUTE FUNCTION increment_discount_code_usage();

-- Enable Row Level Security
ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_code_usage ENABLE ROW LEVEL SECURITY;

-- RLS Policies for discount_codes table

-- Admins can view all discount codes
CREATE POLICY "Admins can view all discount codes"
  ON public.discount_codes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Authenticated users can view active and valid discount codes
CREATE POLICY "Users can view active valid discount codes"
  ON public.discount_codes
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    AND now() >= valid_from
    AND now() <= valid_until
  );

-- Admins can insert discount codes
CREATE POLICY "Admins can insert discount codes"
  ON public.discount_codes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Admins can update discount codes
CREATE POLICY "Admins can update discount codes"
  ON public.discount_codes
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Admins can delete discount codes
CREATE POLICY "Admins can delete discount codes"
  ON public.discount_codes
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- RLS Policies for discount_code_usage table

-- Admins can view all usage records
CREATE POLICY "Admins can view all usage records"
  ON public.discount_code_usage
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Users can view their own usage records
CREATE POLICY "Users can view own usage records"
  ON public.discount_code_usage
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- System can insert usage records (via service role)
CREATE POLICY "System can insert usage records"
  ON public.discount_code_usage
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Admins can insert usage records for any user
CREATE POLICY "Admins can insert usage records"
  ON public.discount_code_usage
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );
