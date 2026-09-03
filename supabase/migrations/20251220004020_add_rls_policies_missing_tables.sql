-- ============================================================================
-- PASSWORD RESET CODES TABLE POLICIES
-- ============================================================================
CREATE POLICY "Users can view own password reset codes"
  ON public.password_reset_codes
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

CREATE POLICY "Users can create own password reset codes"
  ON public.password_reset_codes
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "Users can update own password reset codes"
  ON public.password_reset_codes
  FOR UPDATE
  TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "Admins can manage all password reset codes"
  ON public.password_reset_codes
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (select auth.uid())
      AND role = 'admin'
    )
  );

-- ============================================================================
-- WEBHOOK LOGS TABLE
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'webhook_logs'
  ) THEN
    ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE schemaname = 'public' 
      AND tablename = 'webhook_logs' 
      AND policyname = 'Admins can view all webhook logs'
    ) THEN
      CREATE POLICY "Admins can view all webhook logs"
        ON public.webhook_logs
        FOR SELECT
        TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM public.users
            WHERE id = (select auth.uid())
            AND role = 'admin'
          )
        );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE schemaname = 'public' 
      AND tablename = 'webhook_logs' 
      AND policyname = 'Service role can insert webhook logs'
    ) THEN
      CREATE POLICY "Service role can insert webhook logs"
        ON public.webhook_logs
        FOR INSERT
        TO service_role
        WITH CHECK (true);
    END IF;
  END IF;
END $$;
