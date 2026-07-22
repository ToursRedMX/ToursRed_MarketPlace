DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'slot_seat_status'
  ) THEN
    CREATE POLICY "Authenticated users can view seat status for booking"
      ON slot_seat_status
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;
