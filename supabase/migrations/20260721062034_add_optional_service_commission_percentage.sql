ALTER TABLE public.platform_settings
  ADD COLUMN optional_service_commission_percentage numeric(5,2) NOT NULL DEFAULT 15.00;