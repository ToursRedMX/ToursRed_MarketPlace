
-- Drop existing policies
DROP POLICY IF EXISTS "Admins can view all inquiries" ON public.international_tour_inquiries;
DROP POLICY IF EXISTS "Admins can update inquiries" ON public.international_tour_inquiries;

-- Create new policy for viewing inquiries (SELECT)
CREATE POLICY "Admins with permission can view inquiries"
  ON public.international_tour_inquiries FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
      AND (
        users.is_super_admin = true
        OR EXISTS (
          SELECT 1 FROM public.admin_permissions
          WHERE admin_permissions.user_id = users.id
          AND admin_permissions.can_manage_inquiries = true
        )
      )
    )
  );

-- Create new policy for updating inquiries (UPDATE)
CREATE POLICY "Admins with permission can update inquiries"
  ON public.international_tour_inquiries FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
      AND (
        users.is_super_admin = true
        OR EXISTS (
          SELECT 1 FROM public.admin_permissions
          WHERE admin_permissions.user_id = users.id
          AND admin_permissions.can_manage_inquiries = true
        )
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
      AND (
        users.is_super_admin = true
        OR EXISTS (
          SELECT 1 FROM public.admin_permissions
          WHERE admin_permissions.user_id = users.id
          AND admin_permissions.can_manage_inquiries = true
        )
      )
    )
  );
