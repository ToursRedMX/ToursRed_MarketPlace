
-- Drop the global unique constraint on curp
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_curp_unique;

-- Drop the old partial index if it existed separately
DROP INDEX IF EXISTS idx_users_curp_not_null;

-- Create composite unique index: one CURP per role (allows same CURP across different roles)
CREATE UNIQUE INDEX IF NOT EXISTS users_curp_role_unique
  ON users (curp, role)
  WHERE curp IS NOT NULL;
