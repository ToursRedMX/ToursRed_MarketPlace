ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS platform_url text NOT NULL DEFAULT 'https://toursredmx.netlify.app';

UPDATE platform_settings
  SET platform_url = 'https://toursredmx.netlify.app'
  WHERE platform_url = 'https://toursredmx.netlify.app';
