-- agency_payouts
CREATE INDEX IF NOT EXISTS idx_agency_payouts_agency_id
  ON public.agency_payouts (agency_id);

-- cookie_consents
CREATE INDEX IF NOT EXISTS idx_cookie_consents_user_id
  ON public.cookie_consents (user_id);

-- email_settings
CREATE INDEX IF NOT EXISTS idx_email_settings_updated_by
  ON public.email_settings (updated_by);

-- platform_settings
CREATE INDEX IF NOT EXISTS idx_platform_settings_updated_by
  ON public.platform_settings (updated_by);

-- terms_versions
CREATE INDEX IF NOT EXISTS idx_terms_versions_published_by_user_id
  ON public.terms_versions (published_by_user_id);
