ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS stripe_bookings_enabled    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS stripe_gift_cards_enabled  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS stripe_memberships_enabled boolean NOT NULL DEFAULT true;
