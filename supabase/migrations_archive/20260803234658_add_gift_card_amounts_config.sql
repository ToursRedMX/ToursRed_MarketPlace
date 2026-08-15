/*
# Add gift card amounts configuration to platform_settings

## Summary
Adds two new columns to `platform_settings` so the admin can configure:
1. `gift_card_amounts` — a JSON array of preset amounts shown on the gift cards page (default [100, 200, 500, 1000])
2. `gift_card_max_amount` — the maximum allowed amount for any gift card including custom amounts (default 10000)

## New Columns
- `platform_settings.gift_card_amounts` (jsonb, default '[100,200,500,1000]')
- `platform_settings.gift_card_max_amount` (integer, default 10000)

## Security
No new tables. No RLS changes. Existing platform_settings policies already restrict access to admins.
*/

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS gift_card_amounts jsonb DEFAULT '[100, 200, 500, 1000]'::jsonb;

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS gift_card_max_amount integer DEFAULT 10000;
