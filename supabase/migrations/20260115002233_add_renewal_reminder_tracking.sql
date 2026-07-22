
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memberships' AND column_name = 'renewal_reminder_sent'
  ) THEN
    ALTER TABLE public.memberships 
    ADD COLUMN renewal_reminder_sent boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memberships' AND column_name = 'renewal_reminder_sent_at'
  ) THEN
    ALTER TABLE public.memberships 
    ADD COLUMN renewal_reminder_sent_at timestamptz;
  END IF;
END $$;
