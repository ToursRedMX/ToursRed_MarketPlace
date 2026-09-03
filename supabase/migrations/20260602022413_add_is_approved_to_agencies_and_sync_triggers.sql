-- 1. Agregar columna
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS is_approved boolean NOT NULL DEFAULT false;

-- 2. Backfill desde users
UPDATE agencies a
SET is_approved = u.is_approved
FROM users u
WHERE a.user_id = u.id
  AND u.role = 'agency';

-- 3. Trigger: agencies.is_approved → users.is_approved
CREATE OR REPLACE FUNCTION sync_agency_approval_to_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_approved IS DISTINCT FROM OLD.is_approved THEN
    UPDATE users
    SET is_approved = NEW.is_approved
    WHERE id = NEW.user_id
      AND role = 'agency';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_agency_approval_to_user ON agencies;
CREATE TRIGGER trg_sync_agency_approval_to_user
  AFTER UPDATE OF is_approved ON agencies
  FOR EACH ROW
  EXECUTE FUNCTION sync_agency_approval_to_user();

-- 4. Trigger: users.is_approved → agencies.is_approved
CREATE OR REPLACE FUNCTION sync_user_approval_to_agency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_approved IS DISTINCT FROM OLD.is_approved AND NEW.role = 'agency' THEN
    UPDATE agencies
    SET is_approved = NEW.is_approved
    WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_user_approval_to_agency ON users;
CREATE TRIGGER trg_sync_user_approval_to_agency
  AFTER UPDATE OF is_approved ON users
  FOR EACH ROW
  EXECUTE FUNCTION sync_user_approval_to_agency();

-- 5. Política: ejecutivo asignado puede actualizar is_approved en su agencia
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agencies'
      AND policyname = 'Executive can approve own registered agencies'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Executive can approve own registered agencies"
        ON agencies
        FOR UPDATE
        TO authenticated
        USING (
          account_executive_id IN (
            SELECT ae.id FROM account_executives ae
            WHERE ae.user_id = (SELECT auth.uid()) AND ae.is_active = true
          )
        )
        WITH CHECK (
          account_executive_id IN (
            SELECT ae.id FROM account_executives ae
            WHERE ae.user_id = (SELECT auth.uid()) AND ae.is_active = true
          )
        )
    $policy$;
  END IF;
END $$;
