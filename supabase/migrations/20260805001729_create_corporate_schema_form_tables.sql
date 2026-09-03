-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260805001729
--   name:    create_corporate_schema_form_tables
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
# Create corporate schema with 11 form submission tables

## Purpose
Creates a dedicated `corporate` schema to store all ToursRed corporate website form
submissions, completely isolated from the marketplace data in the `public` schema.
Each public form saves submissions to its own table before sending email notifications.
If the email service fails, the data is preserved in the database.

## Schema
- New schema: `corporate` (separate from `public` where marketplace tables live)

## Tables created (11 total, all in `corporate` schema)
1. agency_registration_submissions — Agency ally registration form
2. contact_submissions — General contact form
3. agency_support_submissions — Agency support/advisory request form
4. esim_quote_submissions — eSIM quote request form
5. exoticca_quote_submissions — Exoticca travel quote form
6. mega_travel_quote_submissions — Mega Travel quote form
7. nefertari_quote_submissions — Nefertari Travel quote form
8. rent_a_car_quote_submissions — Car rental quote form
9. travel_insurance_quote_submissions — Travel insurance quote form
10. traveler_services_submissions — Traveler services request form
11. nature_stay_hub_submissions — Nature Stay Hub host registration form

## Common columns on every table
- id (uuid, PK, auto-generated)
- email_status (text: 'pending' | 'sent' | 'failed') — tracks email delivery
- email_error (text, nullable) — error message if email failed
- ip_address (text, nullable) — sender IP for audit
- user_agent (text, nullable) — sender browser for audit
- created_at (timestamptz, default now())

## Security
- RLS enabled on every table.
- Only INSERT is allowed for anon+authenticated (the server writes using the service
  role key which bypasses RLS).
- SELECT, UPDATE, DELETE are denied for anon and authenticated roles — no one can
  read or modify submissions from the browser.
- The server-side code uses SUPABASE_SERVICE_ROLE_KEY which bypasses RLS entirely.

## Grants
- USAGE on `corporate` schema granted to anon, authenticated roles.
- INSERT privilege on all tables granted to anon, authenticated roles.
*/

-- Create the corporate schema
CREATE SCHEMA IF NOT EXISTS corporate
;



-- Grant schema usage to anon and authenticated so they can insert via RLS policies
GRANT USAGE ON SCHEMA corporate TO anon, authenticated
;



-- 1. agency_registration_submissions
CREATE TABLE IF NOT EXISTS corporate.agency_registration_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  agency_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  website text NOT NULL,
  rfc text NOT NULL,
  rnt text,
  legal_name text NOT NULL,
  street text NOT NULL,
  exterior_number text NOT NULL,
  interior_number text,
  neighborhood text NOT NULL,
  city text NOT NULL,
  state text NOT NULL,
  postal_code text NOT NULL,
  country text NOT NULL,
  email_status text NOT NULL DEFAULT 'pending',
  email_error text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
)
;


ALTER TABLE corporate.agency_registration_submissions ENABLE ROW LEVEL SECURITY
;


GRANT INSERT ON corporate.agency_registration_submissions TO anon, authenticated
;


DROP POLICY IF EXISTS "insert_agency_registration" ON corporate.agency_registration_submissions
;


CREATE POLICY "insert_agency_registration" ON corporate.agency_registration_submissions
  FOR INSERT TO anon, authenticated WITH CHECK (true)
;



-- 2. contact_submissions
CREATE TABLE IF NOT EXISTS corporate.contact_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  subject text NOT NULL,
  message text NOT NULL,
  email_status text NOT NULL DEFAULT 'pending',
  email_error text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
)
;


ALTER TABLE corporate.contact_submissions ENABLE ROW LEVEL SECURITY
;


GRANT INSERT ON corporate.contact_submissions TO anon, authenticated
;


DROP POLICY IF EXISTS "insert_contact" ON corporate.contact_submissions
;


CREATE POLICY "insert_contact" ON corporate.contact_submissions
  FOR INSERT TO anon, authenticated WITH CHECK (true)
;



-- 3. agency_support_submissions
CREATE TABLE IF NOT EXISTS corporate.agency_support_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_name text NOT NULL,
  responsible_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  address text,
  agency_state text,
  rnt_status text,
  services text[],
  tour_types text[],
  project_description text,
  lang text,
  email_status text NOT NULL DEFAULT 'pending',
  email_error text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
)
;


ALTER TABLE corporate.agency_support_submissions ENABLE ROW LEVEL SECURITY
;


GRANT INSERT ON corporate.agency_support_submissions TO anon, authenticated
;


DROP POLICY IF EXISTS "insert_agency_support" ON corporate.agency_support_submissions
;


CREATE POLICY "insert_agency_support" ON corporate.agency_support_submissions
  FOR INSERT TO anon, authenticated WITH CHECK (true)
;



-- 4. esim_quote_submissions
CREATE TABLE IF NOT EXISTS corporate.esim_quote_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL,
  whatsapp text NOT NULL,
  destinations text NOT NULL,
  travel_date text,
  data_needed text,
  phone_model text NOT NULL,
  observations text,
  lang text,
  email_status text NOT NULL DEFAULT 'pending',
  email_error text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
)
;


ALTER TABLE corporate.esim_quote_submissions ENABLE ROW LEVEL SECURITY
;


GRANT INSERT ON corporate.esim_quote_submissions TO anon, authenticated
;


DROP POLICY IF EXISTS "insert_esim_quote" ON corporate.esim_quote_submissions
;


CREATE POLICY "insert_esim_quote" ON corporate.esim_quote_submissions
  FOR INSERT TO anon, authenticated WITH CHECK (true)
;



-- 5. exoticca_quote_submissions
CREATE TABLE IF NOT EXISTS corporate.exoticca_quote_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  trip_name text NOT NULL,
  travel_date text,
  number_of_people integer,
  additional_comments text,
  email_status text NOT NULL DEFAULT 'pending',
  email_error text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
)
;


ALTER TABLE corporate.exoticca_quote_submissions ENABLE ROW LEVEL SECURITY
;


GRANT INSERT ON corporate.exoticca_quote_submissions TO anon, authenticated
;


DROP POLICY IF EXISTS "insert_exoticca_quote" ON corporate.exoticca_quote_submissions
;


CREATE POLICY "insert_exoticca_quote" ON corporate.exoticca_quote_submissions
  FOR INSERT TO anon, authenticated WITH CHECK (true)
;



-- 6. mega_travel_quote_submissions
CREATE TABLE IF NOT EXISTS corporate.mega_travel_quote_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  destination text NOT NULL,
  tour_code text,
  travel_date text,
  number_of_people integer,
  additional_comments text,
  email_status text NOT NULL DEFAULT 'pending',
  email_error text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
)
;


ALTER TABLE corporate.mega_travel_quote_submissions ENABLE ROW LEVEL SECURITY
;


GRANT INSERT ON corporate.mega_travel_quote_submissions TO anon, authenticated
;


DROP POLICY IF EXISTS "insert_mega_travel_quote" ON corporate.mega_travel_quote_submissions
;


CREATE POLICY "insert_mega_travel_quote" ON corporate.mega_travel_quote_submissions
  FOR INSERT TO anon, authenticated WITH CHECK (true)
;



-- 7. nefertari_quote_submissions
CREATE TABLE IF NOT EXISTS corporate.nefertari_quote_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  trip_name text NOT NULL,
  travel_date text,
  number_of_people integer,
  additional_comments text,
  email_status text NOT NULL DEFAULT 'pending',
  email_error text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
)
;


ALTER TABLE corporate.nefertari_quote_submissions ENABLE ROW LEVEL SECURITY
;


GRANT INSERT ON corporate.nefertari_quote_submissions TO anon, authenticated
;


DROP POLICY IF EXISTS "insert_nefertari_quote" ON corporate.nefertari_quote_submissions
;


CREATE POLICY "insert_nefertari_quote" ON corporate.nefertari_quote_submissions
  FOR INSERT TO anon, authenticated WITH CHECK (true)
;



-- 8. rent_a_car_quote_submissions
CREATE TABLE IF NOT EXISTS corporate.rent_a_car_quote_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  pickup_location text NOT NULL,
  pickup_date text,
  return_date text,
  number_of_people integer,
  car_preference text,
  additional_comments text,
  email_status text NOT NULL DEFAULT 'pending',
  email_error text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
)
;


ALTER TABLE corporate.rent_a_car_quote_submissions ENABLE ROW LEVEL SECURITY
;


GRANT INSERT ON corporate.rent_a_car_quote_submissions TO anon, authenticated
;


DROP POLICY IF EXISTS "insert_rent_a_car_quote" ON corporate.rent_a_car_quote_submissions
;


CREATE POLICY "insert_rent_a_car_quote" ON corporate.rent_a_car_quote_submissions
  FOR INSERT TO anon, authenticated WITH CHECK (true)
;



-- 9. travel_insurance_quote_submissions
CREATE TABLE IF NOT EXISTS corporate.travel_insurance_quote_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination text NOT NULL,
  start_date text,
  end_date text,
  number_of_travelers text,
  trip_type text,
  trip_reason text,
  age text,
  medical_condition text,
  medical_details text,
  coverage text[],
  observations text,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  preferred_contact text,
  lang text,
  email_status text NOT NULL DEFAULT 'pending',
  email_error text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
)
;


ALTER TABLE corporate.travel_insurance_quote_submissions ENABLE ROW LEVEL SECURITY
;


GRANT INSERT ON corporate.travel_insurance_quote_submissions TO anon, authenticated
;


DROP POLICY IF EXISTS "insert_travel_insurance_quote" ON corporate.travel_insurance_quote_submissions
;


CREATE POLICY "insert_travel_insurance_quote" ON corporate.travel_insurance_quote_submissions
  FOR INSERT TO anon, authenticated WITH CHECK (true)
;



-- 10. traveler_services_submissions
CREATE TABLE IF NOT EXISTS corporate.traveler_services_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  preferred_contact text,
  service_type text NOT NULL,
  destinations text,
  start_date text,
  end_date text,
  number_of_travelers text,
  budget text,
  itinerary_comments text,
  include_flights text,
  hotel_category text,
  package_comments text,
  transport_types text[],
  origin text,
  destination text,
  transport_start_date text,
  transport_end_date text,
  transport_passengers text,
  transport_comments text,
  accept_contact boolean,
  accept_privacy boolean,
  lang text,
  email_status text NOT NULL DEFAULT 'pending',
  email_error text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
)
;


ALTER TABLE corporate.traveler_services_submissions ENABLE ROW LEVEL SECURITY
;


GRANT INSERT ON corporate.traveler_services_submissions TO anon, authenticated
;


DROP POLICY IF EXISTS "insert_traveler_services" ON corporate.traveler_services_submissions
;


CREATE POLICY "insert_traveler_services" ON corporate.traveler_services_submissions
  FOR INSERT TO anon, authenticated WITH CHECK (true)
;



-- 11. nature_stay_hub_submissions
CREATE TABLE IF NOT EXISTS corporate.nature_stay_hub_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_name text NOT NULL,
  host_email text NOT NULL,
  host_phone text NOT NULL,
  accommodation_name text NOT NULL,
  accommodation_type text,
  accommodation_type_other text,
  location text,
  capacity text,
  natural_environment text,
  social_links text,
  google_maps_url text,
  email_status text NOT NULL DEFAULT 'pending',
  email_error text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
)
;


ALTER TABLE corporate.nature_stay_hub_submissions ENABLE ROW LEVEL SECURITY
;


GRANT INSERT ON corporate.nature_stay_hub_submissions TO anon, authenticated
;


DROP POLICY IF EXISTS "insert_nature_stay_hub" ON corporate.nature_stay_hub_submissions
;


CREATE POLICY "insert_nature_stay_hub" ON corporate.nature_stay_hub_submissions
  FOR INSERT TO anon, authenticated WITH CHECK (true)
;
