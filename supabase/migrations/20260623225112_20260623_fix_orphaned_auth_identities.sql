
-- Fix Google OAuth "User not found" error caused by orphaned auth.identities records.
-- The pre-UAT cleanup deleted auth.users rows but left dangling identity records.
-- When GoTrue receives a Google OAuth login and finds an identity record (provider=google)
-- whose user_id no longer exists in auth.users, it returns "User not found".
DELETE FROM auth.identities
WHERE user_id NOT IN (SELECT id FROM auth.users);
