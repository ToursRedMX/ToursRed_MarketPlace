ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS oauth_google_login_enabled  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS oauth_azure_login_enabled   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS oauth_twitter_login_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS oauth_facebook_login_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS oauth_google_link_enabled   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS oauth_azure_link_enabled    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS oauth_twitter_link_enabled  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS oauth_facebook_link_enabled boolean NOT NULL DEFAULT false;
