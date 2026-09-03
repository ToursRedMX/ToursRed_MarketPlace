-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260827003503
--   name:    routesred_vehicles_drivers
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
# RoutesRed — Vehicles, Vehicle Images, Vehicle Amenities, Drivers

Creates vehicle-related tables and drivers table with RLS.
All tables use standard RLS (not SECURITY DEFINER) for CRUD — membership
is validated through transport_provider_users existence checks in policies.
*/

-- vehicles
CREATE TABLE IF NOT EXISTS routesred.vehicles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transport_provider_id uuid NOT NULL REFERENCES routesred.transport_providers(id) ON DELETE CASCADE,
  vehicle_type_id       uuid NOT NULL REFERENCES routesred.vehicle_types(id) ON DELETE RESTRICT,
  internal_name         text NOT NULL,
  brand                 text,
  model                 text,
  year                  integer,
  license_plate         text,
  capacity              integer NOT NULL,
  luggage_capacity      integer,
  description           text,
  primary_image_url     text,
  status                text NOT NULL DEFAULT 'active',
  coordinates           extensions.geography(Point, 4326),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicles_status_check CHECK (status IN ('active', 'maintenance', 'unavailable', 'inactive')),
  CONSTRAINT vehicles_capacity_check CHECK (capacity > 0),
  CONSTRAINT vehicles_year_check CHECK (year IS NULL OR (year >= 1950 AND year <= extract(year FROM now())::integer + 1))
);

CREATE INDEX IF NOT EXISTS vehicles_provider_idx ON routesred.vehicles (transport_provider_id);
CREATE INDEX IF NOT EXISTS vehicles_type_idx ON routesred.vehicles (vehicle_type_id);
CREATE INDEX IF NOT EXISTS vehicles_status_idx ON routesred.vehicles (status);

ALTER TABLE routesred.vehicles ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS vehicles_updated_at ON routesred.vehicles;
CREATE TRIGGER vehicles_updated_at BEFORE UPDATE ON routesred.vehicles
  FOR EACH ROW EXECUTE FUNCTION routesred.set_updated_at();

-- vehicle_images
CREATE TABLE IF NOT EXISTS routesred.vehicle_images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  uuid NOT NULL REFERENCES routesred.vehicles(id) ON DELETE CASCADE,
  image_url   text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_images_vehicle_idx ON routesred.vehicle_images (vehicle_id);

ALTER TABLE routesred.vehicle_images ENABLE ROW LEVEL SECURITY;

-- vehicle_amenities (N:M)
CREATE TABLE IF NOT EXISTS routesred.vehicle_amenities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  uuid NOT NULL REFERENCES routesred.vehicles(id) ON DELETE CASCADE,
  amenity_id  uuid NOT NULL REFERENCES routesred.amenities(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_amenities_unique UNIQUE (vehicle_id, amenity_id)
);

CREATE INDEX IF NOT EXISTS va_vehicle_idx ON routesred.vehicle_amenities (vehicle_id);
CREATE INDEX IF NOT EXISTS va_amenity_idx ON routesred.vehicle_amenities (amenity_id);

ALTER TABLE routesred.vehicle_amenities ENABLE ROW LEVEL SECURITY;

-- drivers
CREATE TABLE IF NOT EXISTS routesred.drivers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transport_provider_id uuid NOT NULL REFERENCES routesred.transport_providers(id) ON DELETE CASCADE,
  user_id               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  first_name            text NOT NULL,
  last_name             text,
  phone                 text,
  email                 text,
  photo_url             text,
  license_number        text,
  license_type          text,
  license_expiration    date,
  status                text NOT NULL DEFAULT 'active',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drivers_status_check CHECK (status IN ('active', 'inactive', 'suspended', 'expired_documents'))
);

CREATE INDEX IF NOT EXISTS drivers_provider_idx ON routesred.drivers (transport_provider_id);
CREATE INDEX IF NOT EXISTS drivers_status_idx ON routesred.drivers (status);

ALTER TABLE routesred.drivers ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS drivers_updated_at ON routesred.drivers;
CREATE TRIGGER drivers_updated_at BEFORE UPDATE ON routesred.drivers
  FOR EACH ROW EXECUTE FUNCTION routesred.set_updated_at();

-- =============================================================
-- RLS Policies for vehicles
-- =============================================================
DROP POLICY IF EXISTS "vehicles_select_members" ON routesred.vehicles;
CREATE POLICY "vehicles_select_members"
  ON routesred.vehicles FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.transport_provider_id = vehicles.transport_provider_id
    AND tpu.user_id = auth.uid() AND tpu.status = 'active') OR public.is_super_admin());

DROP POLICY IF EXISTS "vehicles_insert_members" ON routesred.vehicles;
CREATE POLICY "vehicles_insert_members"
  ON routesred.vehicles FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.transport_provider_id = vehicles.transport_provider_id
    AND tpu.user_id = auth.uid() AND tpu.status = 'active'
    AND tpu.role IN ('owner', 'administrator', 'operator_manager')) OR public.is_super_admin());

DROP POLICY IF EXISTS "vehicles_update_members" ON routesred.vehicles;
CREATE POLICY "vehicles_update_members"
  ON routesred.vehicles FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.transport_provider_id = vehicles.transport_provider_id
    AND tpu.user_id = auth.uid() AND tpu.status = 'active'
    AND tpu.role IN ('owner', 'administrator', 'operator_manager')) OR public.is_super_admin())
  WITH CHECK (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.transport_provider_id = vehicles.transport_provider_id
    AND tpu.user_id = auth.uid() AND tpu.status = 'active'
    AND tpu.role IN ('owner', 'administrator', 'operator_manager')) OR public.is_super_admin());

DROP POLICY IF EXISTS "vehicles_delete_members" ON routesred.vehicles;
CREATE POLICY "vehicles_delete_members"
  ON routesred.vehicles FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.transport_provider_id = vehicles.transport_provider_id
    AND tpu.user_id = auth.uid() AND tpu.status = 'active'
    AND tpu.role IN ('owner', 'administrator')) OR public.is_super_admin());

-- =============================================================
-- RLS Policies for vehicle_images (same membership as parent vehicle)
-- =============================================================
DROP POLICY IF EXISTS "vi_select_members" ON routesred.vehicle_images;
CREATE POLICY "vi_select_members"
  ON routesred.vehicle_images FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM routesred.vehicles v
    JOIN routesred.transport_provider_users tpu ON tpu.transport_provider_id = v.transport_provider_id
    WHERE v.id = vehicle_images.vehicle_id AND tpu.user_id = auth.uid() AND tpu.status = 'active') OR public.is_super_admin());

DROP POLICY IF EXISTS "vi_insert_members" ON routesred.vehicle_images;
CREATE POLICY "vi_insert_members"
  ON routesred.vehicle_images FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM routesred.vehicles v
    JOIN routesred.transport_provider_users tpu ON tpu.transport_provider_id = v.transport_provider_id
    WHERE v.id = vehicle_images.vehicle_id AND tpu.user_id = auth.uid() AND tpu.status = 'active'
    AND tpu.role IN ('owner', 'administrator', 'operator_manager')) OR public.is_super_admin());

DROP POLICY IF EXISTS "vi_update_members" ON routesred.vehicle_images;
CREATE POLICY "vi_update_members"
  ON routesred.vehicle_images FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM routesred.vehicles v
    JOIN routesred.transport_provider_users tpu ON tpu.transport_provider_id = v.transport_provider_id
    WHERE v.id = vehicle_images.vehicle_id AND tpu.user_id = auth.uid() AND tpu.status = 'active'
    AND tpu.role IN ('owner', 'administrator', 'operator_manager')) OR public.is_super_admin())
  WITH CHECK (EXISTS (SELECT 1 FROM routesred.vehicles v
    JOIN routesred.transport_provider_users tpu ON tpu.transport_provider_id = v.transport_provider_id
    WHERE v.id = vehicle_images.vehicle_id AND tpu.user_id = auth.uid() AND tpu.status = 'active'
    AND tpu.role IN ('owner', 'administrator', 'operator_manager')) OR public.is_super_admin());

DROP POLICY IF EXISTS "vi_delete_members" ON routesred.vehicle_images;
CREATE POLICY "vi_delete_members"
  ON routesred.vehicle_images FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM routesred.vehicles v
    JOIN routesred.transport_provider_users tpu ON tpu.transport_provider_id = v.transport_provider_id
    WHERE v.id = vehicle_images.vehicle_id AND tpu.user_id = auth.uid() AND tpu.status = 'active'
    AND tpu.role IN ('owner', 'administrator', 'operator_manager')) OR public.is_super_admin());

-- =============================================================
-- RLS Policies for vehicle_amenities
-- =============================================================
DROP POLICY IF EXISTS "va_select_members" ON routesred.vehicle_amenities;
CREATE POLICY "va_select_members"
  ON routesred.vehicle_amenities FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM routesred.vehicles v
    JOIN routesred.transport_provider_users tpu ON tpu.transport_provider_id = v.transport_provider_id
    WHERE v.id = vehicle_amenities.vehicle_id AND tpu.user_id = auth.uid() AND tpu.status = 'active') OR public.is_super_admin());

DROP POLICY IF EXISTS "va_insert_members" ON routesred.vehicle_amenities;
CREATE POLICY "va_insert_members"
  ON routesred.vehicle_amenities FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM routesred.vehicles v
    JOIN routesred.transport_provider_users tpu ON tpu.transport_provider_id = v.transport_provider_id
    WHERE v.id = vehicle_amenities.vehicle_id AND tpu.user_id = auth.uid() AND tpu.status = 'active'
    AND tpu.role IN ('owner', 'administrator', 'operator_manager')) OR public.is_super_admin());

DROP POLICY IF EXISTS "va_delete_members" ON routesred.vehicle_amenities;
CREATE POLICY "va_delete_members"
  ON routesred.vehicle_amenities FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM routesred.vehicles v
    JOIN routesred.transport_provider_users tpu ON tpu.transport_provider_id = v.transport_provider_id
    WHERE v.id = vehicle_amenities.vehicle_id AND tpu.user_id = auth.uid() AND tpu.status = 'active'
    AND tpu.role IN ('owner', 'administrator', 'operator_manager')) OR public.is_super_admin());

-- =============================================================
-- RLS Policies for drivers
-- =============================================================
DROP POLICY IF EXISTS "drivers_select_members" ON routesred.drivers;
CREATE POLICY "drivers_select_members"
  ON routesred.drivers FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.transport_provider_id = drivers.transport_provider_id
    AND tpu.user_id = auth.uid() AND tpu.status = 'active') OR public.is_super_admin());

DROP POLICY IF EXISTS "drivers_insert_members" ON routesred.drivers;
CREATE POLICY "drivers_insert_members"
  ON routesred.drivers FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.transport_provider_id = drivers.transport_provider_id
    AND tpu.user_id = auth.uid() AND tpu.status = 'active'
    AND tpu.role IN ('owner', 'administrator', 'operator_manager')) OR public.is_super_admin());

DROP POLICY IF EXISTS "drivers_update_members" ON routesred.drivers;
CREATE POLICY "drivers_update_members"
  ON routesred.drivers FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.transport_provider_id = drivers.transport_provider_id
    AND tpu.user_id = auth.uid() AND tpu.status = 'active'
    AND tpu.role IN ('owner', 'administrator', 'operator_manager')) OR public.is_super_admin())
  WITH CHECK (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.transport_provider_id = drivers.transport_provider_id
    AND tpu.user_id = auth.uid() AND tpu.status = 'active'
    AND tpu.role IN ('owner', 'administrator', 'operator_manager')) OR public.is_super_admin());

DROP POLICY IF EXISTS "drivers_delete_members" ON routesred.drivers;
CREATE POLICY "drivers_delete_members"
  ON routesred.drivers FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.transport_provider_id = drivers.transport_provider_id
    AND tpu.user_id = auth.uid() AND tpu.status = 'active'
    AND tpu.role IN ('owner', 'administrator')) OR public.is_super_admin());

;
