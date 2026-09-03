-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260827003419
--   name:    routesred_provider_tables
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

/*
# RoutesRed — Transport Provider Tables
Creates transport_providers (individual/company) and transport_provider_users.
PostGIS geography uses extensions schema on ToursRed.
*/

CREATE TABLE IF NOT EXISTS routesred.transport_providers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_type          text NOT NULL DEFAULT 'company',
  first_name             text,
  last_name              text,
  legal_name             text,
  legal_representative   text,
  trade_name             text,
  slug                   text NOT NULL UNIQUE,
  rfc                    text,
  description            text,
  logo_url               text,
  cover_image_url        text,
  phone                  text,
  email                  text,
  website                text,
  country_code           text NOT NULL DEFAULT 'MX',
  state                  text,
  city                   text,
  address                text,
  postal_code            text,
  coordinates            extensions.geography(Point, 4326),
  status                 text NOT NULL DEFAULT 'draft',
  verification_status    text NOT NULL DEFAULT 'unverified',
  rating_average         numeric(3,2) NOT NULL DEFAULT 0,
  rating_count           integer NOT NULL DEFAULT 0,
  completed_services_count integer NOT NULL DEFAULT 0,
  active                 boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tp_provider_type_check CHECK (provider_type IN ('individual', 'company')),
  CONSTRAINT tp_status_check CHECK (status IN ('draft', 'pending_review', 'active', 'suspended', 'rejected', 'inactive')),
  CONSTRAINT tp_verification_check CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected')),
  CONSTRAINT tp_slug_reserved CHECK (slug NOT IN ('new', 'create', 'admin', 'api', 'login', 'registro', 'provider', 'providers', 'transportadoras', 'rutas', 'cotizar', 'aeropuertos', 'account', 'settings'))
);

CREATE INDEX IF NOT EXISTS tp_owner_idx ON routesred.transport_providers (owner_user_id);
CREATE INDEX IF NOT EXISTS tp_status_idx ON routesred.transport_providers (status);
CREATE INDEX IF NOT EXISTS tp_verification_idx ON routesred.transport_providers (verification_status);
CREATE INDEX IF NOT EXISTS tp_active_idx ON routesred.transport_providers (active);

ALTER TABLE routesred.transport_providers ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS tp_updated_at ON routesred.transport_providers;
CREATE TRIGGER tp_updated_at BEFORE UPDATE ON routesred.transport_providers
  FOR EACH ROW EXECUTE FUNCTION routesred.set_updated_at();

CREATE TABLE IF NOT EXISTS routesred.transport_provider_users (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transport_provider_id  uuid NOT NULL REFERENCES routesred.transport_providers(id) ON DELETE CASCADE,
  user_id                uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role                   text NOT NULL,
  status                 text NOT NULL DEFAULT 'active',
  invited_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  joined_at              timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tpu_role_check CHECK (role IN ('owner', 'administrator', 'dispatcher', 'finance', 'operator_manager', 'viewer')),
  CONSTRAINT tpu_status_check CHECK (status IN ('active', 'inactive', 'invited')),
  CONSTRAINT tpu_unique UNIQUE (transport_provider_id, user_id)
);

CREATE INDEX IF NOT EXISTS tpu_user_idx ON routesred.transport_provider_users (user_id);
CREATE INDEX IF NOT EXISTS tpu_provider_idx ON routesred.transport_provider_users (transport_provider_id);

ALTER TABLE routesred.transport_provider_users ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS tpu_updated_at ON routesred.transport_provider_users;
CREATE TRIGGER tpu_updated_at BEFORE UPDATE ON routesred.transport_provider_users
  FOR EACH ROW EXECUTE FUNCTION routesred.set_updated_at();

;
