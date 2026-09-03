
-- Verify the fix: count should be 0 (no orphaned identities remaining)
DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM auth.identities i
  LEFT JOIN auth.users u ON u.id = i.user_id
  WHERE u.id IS NULL;

  IF orphan_count > 0 THEN
    RAISE WARNING 'Still % orphaned auth.identities records remaining', orphan_count;
  ELSE
    RAISE NOTICE 'OK: No orphaned auth.identities records. Google OAuth should work correctly.';
  END IF;
END $$;
