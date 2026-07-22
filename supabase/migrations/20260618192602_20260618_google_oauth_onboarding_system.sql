-- Add onboarding_completed flag to users table
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT true;

-- Existing users already completed onboarding (email/password flow)
UPDATE public.users SET onboarding_completed = true WHERE onboarding_completed IS NULL;

-- Create user_auth_providers table for multi-provider support
CREATE TABLE IF NOT EXISTS public.user_auth_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('email', 'google', 'facebook', 'apple', 'microsoft')),
  provider_user_id text,
  linked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

ALTER TABLE public.user_auth_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_view_own_providers" ON public.user_auth_providers
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "users_insert_own_providers" ON public.user_auth_providers
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_delete_own_providers" ON public.user_auth_providers
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Backfill existing users as email provider
INSERT INTO public.user_auth_providers (user_id, provider, linked_at)
SELECT id, 'email', created_at
FROM public.users
ON CONFLICT (user_id, provider) DO NOTHING;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_auth_providers_user_id ON public.user_auth_providers(user_id);
