-- ============================================================
-- chart_of_accounts
-- ============================================================
DROP POLICY IF EXISTS "Admin and accountant can view chart of accounts" ON public.chart_of_accounts;
CREATE POLICY "Admin and accountant can view chart of accounts"
  ON public.chart_of_accounts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role IN ('admin', 'accountant')
    )
  );

DROP POLICY IF EXISTS "Admin can insert chart of accounts" ON public.chart_of_accounts;
CREATE POLICY "Admin can insert chart of accounts"
  ON public.chart_of_accounts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role IN ('admin', 'accountant')
    )
  );

DROP POLICY IF EXISTS "Admin can update chart of accounts" ON public.chart_of_accounts;
CREATE POLICY "Admin can update chart of accounts"
  ON public.chart_of_accounts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role IN ('admin', 'accountant')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role IN ('admin', 'accountant')
    )
  );

-- ============================================================
-- accounting_entries
-- ============================================================
DROP POLICY IF EXISTS "Admin and accountant can view accounting entries" ON public.accounting_entries;
CREATE POLICY "Admin and accountant can view accounting entries"
  ON public.accounting_entries FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role IN ('admin', 'accountant')
    )
  );

DROP POLICY IF EXISTS "Admin and accountant can insert accounting entries" ON public.accounting_entries;
CREATE POLICY "Admin and accountant can insert accounting entries"
  ON public.accounting_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role IN ('admin', 'accountant')
    )
  );

DROP POLICY IF EXISTS "Admin and accountant can update accounting entries" ON public.accounting_entries;
CREATE POLICY "Admin and accountant can update accounting entries"
  ON public.accounting_entries FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role IN ('admin', 'accountant')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role IN ('admin', 'accountant')
    )
  );

-- ============================================================
-- accounting_entry_lines
-- ============================================================
DROP POLICY IF EXISTS "Admin and accountant can view entry lines" ON public.accounting_entry_lines;
CREATE POLICY "Admin and accountant can view entry lines"
  ON public.accounting_entry_lines FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role IN ('admin', 'accountant')
    )
  );

DROP POLICY IF EXISTS "Admin and accountant can insert entry lines" ON public.accounting_entry_lines;
CREATE POLICY "Admin and accountant can insert entry lines"
  ON public.accounting_entry_lines FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role IN ('admin', 'accountant')
    )
  );

DROP POLICY IF EXISTS "Admin and accountant can update entry lines" ON public.accounting_entry_lines;
CREATE POLICY "Admin and accountant can update entry lines"
  ON public.accounting_entry_lines FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role IN ('admin', 'accountant')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role IN ('admin', 'accountant')
    )
  );
