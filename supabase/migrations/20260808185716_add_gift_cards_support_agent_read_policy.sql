/*
# Add support_agent read access to gift_cards

1. Security changes
- Adds a SELECT policy on `gift_cards` for users with role `support_agent` so support staff can view gift card purchases in the admin panel.
- Existing admin/super_admin access remains unchanged.
- The policy uses the same pattern as the existing "Users and admins can view gift cards" policy but adds support_agent to the role check.
*/

-- Drop the existing read policy and recreate it with support_agent included
DROP POLICY IF EXISTS "Users and admins can view gift cards" ON gift_cards;

CREATE POLICY "Users and admins can view gift cards"
ON gift_cards FOR SELECT
TO authenticated
USING (
  redeemed_by = auth.uid()
  OR purchaser_email = auth.email()
  OR EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role IN ('admin', 'super_admin', 'support_agent')
  )
);
