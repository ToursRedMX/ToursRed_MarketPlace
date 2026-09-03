-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260827003405
--   name:    routesred_airports
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
# RoutesRed — Airports Catalog
PostGIS is in extensions schema. Creates airports with 23 Mexican airports.
*/

CREATE TABLE IF NOT EXISTS routesred.airports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iata_code    text,
  icao_code    text,
  name         text NOT NULL,
  city         text NOT NULL,
  state        text,
  country      text NOT NULL DEFAULT 'Mexico',
  country_code text NOT NULL DEFAULT 'MX',
  coordinates  extensions.geography(Point, 4326),
  timezone     text,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS airports_iata_unique ON routesred.airports (iata_code) WHERE iata_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS airports_icao_unique ON routesred.airports (icao_code) WHERE icao_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS airports_active_idx ON routesred.airports (active);

ALTER TABLE routesred.airports ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS airports_updated_at ON routesred.airports;
CREATE TRIGGER airports_updated_at BEFORE UPDATE ON routesred.airports
  FOR EACH ROW EXECUTE FUNCTION routesred.set_updated_at();

DROP POLICY IF EXISTS "public_read_airports" ON routesred.airports;
CREATE POLICY "public_read_airports"
  ON routesred.airports FOR SELECT TO anon, authenticated USING (true);

INSERT INTO routesred.airports (iata_code, icao_code, name, city, state, coordinates, timezone, active)
VALUES
  ('MEX','MMMX','Aeropuerto Internacional de la Ciudad de Mexico','Ciudad de Mexico','Ciudad de Mexico',extensions.ST_MakePoint(-99.0721,19.4363)::extensions.geography(Point,4326),'America/Mexico_City',true),
  ('NLU','MMSM','Aeropuerto Internacional Felipe Angeles','Santa Lucia','Estado de Mexico',extensions.ST_MakePoint(-99.0167,19.7411)::extensions.geography(Point,4326),'America/Mexico_City',true),
  ('CUN','MMUN','Aeropuerto Internacional de Cancun','Cancun','Quintana Roo',extensions.ST_MakePoint(-86.8771,21.0365)::extensions.geography(Point,4326),'America/Cancun',true),
  ('GDL','MMGL','Aeropuerto Internacional de Guadalajara','Guadalajara','Jalisco',extensions.ST_MakePoint(-103.3111,20.5218)::extensions.geography(Point,4326),'America/Mexico_City',true),
  ('MTY','MMMY','Aeropuerto Internacional de Monterrey','Monterrey','Nuevo Leon',extensions.ST_MakePoint(-100.1058,25.7785)::extensions.geography(Point,4326),'America/Monterrey',true),
  ('TIJ','MMTJ','Aeropuerto Internacional de Tijuana','Tijuana','Baja California',extensions.ST_MakePoint(-116.9706,32.5411)::extensions.geography(Point,4326),'America/Tijuana',true),
  ('SJD','MMSD','Aeropuerto Internacional de Los Cabos','San Jose del Cabo','Baja California Sur',extensions.ST_MakePoint(-109.7211,23.1518)::extensions.geography(Point,4326),'America/Mazatlan',true),
  ('PVR','MMPR','Aeropuerto Internacional de Puerto Vallarta','Puerto Vallarta','Jalisco',extensions.ST_MakePoint(-105.2543,20.6801)::extensions.geography(Point,4326),'America/Mexico_City',true),
  ('MID','MMMD','Aeropuerto Internacional de Merida','Merida','Yucatan',extensions.ST_MakePoint(-89.6536,20.9370)::extensions.geography(Point,4326),'America/Merida',true),
  ('OAX','MMOX','Aeropuerto Internacional de Oaxaca','Oaxaca','Oaxaca',extensions.ST_MakePoint(-96.7264,16.9999)::extensions.geography(Point,4326),'America/Mexico_City',true),
  ('BJX','MMLO','Aeropuerto Internacional del Bajio','Silao','Guanajuato',extensions.ST_MakePoint(-101.4826,20.9935)::extensions.geography(Point,4326),'America/Mexico_City',true),
  ('QRO','MMQT','Aeropuerto Intercontinental de Queretaro','Queretaro','Queretaro',extensions.ST_MakePoint(-100.1856,20.6173)::extensions.geography(Point,4326),'America/Mexico_City',true),
  ('PBC','MMPB','Aeropuerto Internacional de Puebla','Puebla','Puebla',extensions.ST_MakePoint(-98.3715,19.1581)::extensions.geography(Point,4326),'America/Mexico_City',true),
  ('VER','MMVR','Aeropuerto Internacional de Veracruz','Veracruz','Veracruz',extensions.ST_MakePoint(-96.1875,19.1459)::extensions.geography(Point,4326),'America/Mexico_City',true),
  ('HMO','MMHO','Aeropuerto Internacional de Hermosillo','Hermosillo','Sonora',extensions.ST_MakePoint(-111.0394,29.0959)::extensions.geography(Point,4326),'America/Hermosillo',true),
  ('CUU','MMCU','Aeropuerto Internacional de Chihuahua','Chihuahua','Chihuahua',extensions.ST_MakePoint(-105.9697,28.7029)::extensions.geography(Point,4326),'America/Chihuahua',true),
  ('CJS','MMCS','Aeropuerto Internacional de Ciudad Juarez','Ciudad Juarez','Chihuahua',extensions.ST_MakePoint(-106.4288,31.6361)::extensions.geography(Point,4326),'America/Ciudad_Juarez',true),
  ('LAP','MMLP','Aeropuerto Internacional de La Paz','La Paz','Baja California Sur',extensions.ST_MakePoint(-110.3625,24.0737)::extensions.geography(Point,4326),'America/Mazatlan',true),
  ('ZIH','MMZH','Aeropuerto Internacional de Ixtapa-Zihuatanejo','Zihuatanejo','Guerrero',extensions.ST_MakePoint(-101.4607,17.6016)::extensions.geography(Point,4326),'America/Mexico_City',true),
  ('ACA','MMAA','Aeropuerto Internacional de Acapulco','Acapulco','Guerrero',extensions.ST_MakePoint(-99.7543,16.7571)::extensions.geography(Point,4326),'America/Mexico_City',true),
  ('HUX','MMHT','Aeropuerto Internacional de Huatulco','Huatulco','Oaxaca',extensions.ST_MakePoint(-96.0258,15.7754)::extensions.geography(Point,4326),'America/Mexico_City',true),
  ('TGZ','MMTG','Aeropuerto Internacional de Tuxtla Gutierrez','Tuxtla Gutierrez','Chiapas',extensions.ST_MakePoint(-93.0224,16.5638)::extensions.geography(Point,4326),'America/Mexico_City',true),
  ('TLC','MMTO','Aeropuerto Internacional de Toluca','Toluca','Estado de Mexico',extensions.ST_MakePoint(-99.5662,19.3370)::extensions.geography(Point,4326),'America/Mexico_City',true)
ON CONFLICT DO NOTHING;

;
