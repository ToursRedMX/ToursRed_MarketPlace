
-- Add membership price columns to platform_settings table
ALTER TABLE public.platform_settings
ADD COLUMN IF NOT EXISTS membership_monthly_price decimal(10,2) DEFAULT 49.00 CHECK (membership_monthly_price > 0),
ADD COLUMN IF NOT EXISTS membership_annual_price decimal(10,2) DEFAULT 490.00 CHECK (membership_annual_price > 0);

-- Add helpful comments
COMMENT ON COLUMN public.platform_settings.membership_monthly_price IS 'Display price for monthly ToursRed+ membership in MXN';
COMMENT ON COLUMN public.platform_settings.membership_annual_price IS 'Display price for annual ToursRed+ membership in MXN';

-- Update existing row with default values if columns are null
UPDATE public.platform_settings
SET
  membership_monthly_price = COALESCE(membership_monthly_price, 49.00),
  membership_annual_price = COALESCE(membership_annual_price, 490.00)
WHERE membership_monthly_price IS NULL OR membership_annual_price IS NULL;
