-- Update the role check constraint to include account_executive
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role = ANY (ARRAY['traveler'::text, 'agency'::text, 'admin'::text, 'accountant'::text, 'account_executive'::text]));

-- Insert the missing profile for the orphaned executive user
INSERT INTO public.users (id, email, first_name, last_name, role, email_verified, is_active)
SELECT 
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'first_name', split_part(au.email, '@', 1)),
  COALESCE(au.raw_user_meta_data->>'last_name', ''),
  'account_executive',
  true,
  true
FROM auth.users au
LEFT JOIN public.users pu ON pu.id = au.id
WHERE pu.id IS NULL
  AND au.raw_user_meta_data->>'role' = 'account_executive'
ON CONFLICT (id) DO UPDATE SET
  role = 'account_executive',
  email_verified = true,
  is_active = true;

-- Insert corresponding account_executives record if missing
INSERT INTO public.account_executives (user_id, first_name, last_name, email, is_active)
SELECT 
  u.id,
  u.first_name,
  u.last_name,
  u.email,
  true
FROM public.users u
LEFT JOIN public.account_executives ae ON ae.user_id = u.id
WHERE u.role = 'account_executive'
  AND ae.id IS NULL;
