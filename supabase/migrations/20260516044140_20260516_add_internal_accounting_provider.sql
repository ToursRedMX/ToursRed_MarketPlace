
ALTER TABLE platform_settings DROP CONSTRAINT IF EXISTS platform_settings_accounting_provider_check;

ALTER TABLE platform_settings
  ADD CONSTRAINT platform_settings_accounting_provider_check
  CHECK (accounting_provider IN ('none', 'internal', 'zoho_books', 'odoo', 'quickbooks', 'contpaqi_cloud'));
