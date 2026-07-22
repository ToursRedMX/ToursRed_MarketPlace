
CREATE TABLE IF NOT EXISTS memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL,
  stripe_subscription_id text NOT NULL UNIQUE,
  plan_type text NOT NULL CHECK (plan_type IN ('monthly', 'annual')),
  status text NOT NULL CHECK (status IN ('active', 'cancelled', 'past_due', 'expired', 'trialing')),
  start_date timestamptz NOT NULL DEFAULT now(),
  current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL,
  cancel_at_period_end boolean DEFAULT false,
  cancelled_at timestamptz,
  service_fee_exemption_used decimal(10,2) DEFAULT 0 NOT NULL,
  service_fee_exemption_reset_date timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own membership"
  ON memberships
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own exemption usage"
  ON memberships
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all memberships"
  ON memberships
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Service role can insert memberships"
  ON memberships
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update memberships"
  ON memberships
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_stripe_subscription_id ON memberships(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_memberships_status ON memberships(status);
CREATE INDEX IF NOT EXISTS idx_memberships_current_period_end ON memberships(current_period_end);

CREATE OR REPLACE FUNCTION public.has_active_membership(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM public.memberships 
    WHERE user_id = p_user_id 
    AND status = 'active'
    AND current_period_end > now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_available_service_fee_exemption(p_user_id uuid)
RETURNS decimal
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exemption_used decimal;
  v_reset_date timestamptz;
  v_status text;
BEGIN
  SELECT 
    service_fee_exemption_used,
    service_fee_exemption_reset_date,
    status
  INTO 
    v_exemption_used,
    v_reset_date,
    v_status
  FROM public.memberships
  WHERE user_id = p_user_id
  AND status = 'active'
  AND current_period_end > now()
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  IF now() >= v_reset_date THEN
    UPDATE public.memberships
    SET 
      service_fee_exemption_used = 0,
      service_fee_exemption_reset_date = date_trunc('month', now() + interval '1 month')
    WHERE user_id = p_user_id;
    
    RETURN 500;
  END IF;

  RETURN GREATEST(0, 500 - v_exemption_used);
END;
$$;

CREATE OR REPLACE FUNCTION update_membership_updated_at()
RETURNS trigger 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER memberships_updated_at
  BEFORE UPDATE ON public.memberships
  FOR EACH ROW
  EXECUTE FUNCTION update_membership_updated_at();
