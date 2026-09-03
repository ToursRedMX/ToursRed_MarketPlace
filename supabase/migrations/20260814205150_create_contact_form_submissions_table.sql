-- Part 17: Create contact_form_submissions table for rate limiting
CREATE TABLE IF NOT EXISTS public.contact_form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  message text,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_form_submissions_email_created_idx
  ON public.contact_form_submissions (email, created_at DESC);
CREATE INDEX IF NOT EXISTS contact_form_submissions_ip_created_idx
  ON public.contact_form_submissions (ip_address, created_at DESC);

ALTER TABLE public.contact_form_submissions ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role can access (edge functions use service key)

GRANT INSERT ON public.contact_form_submissions TO service_role;
GRANT SELECT ON public.contact_form_submissions TO service_role;