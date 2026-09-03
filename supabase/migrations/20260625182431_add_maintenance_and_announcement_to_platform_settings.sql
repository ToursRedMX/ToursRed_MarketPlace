ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS maintenance_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS maintenance_message text NOT NULL DEFAULT 'Estamos realizando tareas de mantenimiento. Estaremos de vuelta muy pronto.',
  ADD COLUMN IF NOT EXISTS maintenance_enabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS announcement_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS announcement_title text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS announcement_message text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS announcement_cta_text text NOT NULL DEFAULT 'Aceptar',
  ADD COLUMN IF NOT EXISTS announcement_activated_at timestamptz;
