-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20261008061116
--   name:    20261008064000_fix_ambiguous_quote_detail_queries
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
# Fix ambiguous quote detail queries

1. Purpose
- Fixes the customer request detail and quote list queries that fail with PostgreSQL error 42702 (`column reference "id" is ambiguous`).

2. Modified functions
- `routesred.get_user_quote_requests_routesred()` now qualifies the request and vehicle type identifiers and output aliases.
- `routesred.get_quote_bids_for_user_routesred(uuid)` now qualifies the authorization lookup and bid identifier.
- No response fields or business rules are changed.

3. Security
- Both functions remain SECURITY DEFINER.
- The request list remains limited to the authenticated user's requests.
- The bid list continues to require ownership of the requested quote and excludes withdrawn bids.
- No tables, columns, rows, or RLS policies are changed.
*/

CREATE OR REPLACE FUNCTION routesred.get_user_quote_requests_routesred()
RETURNS TABLE(
  id uuid,
  trip_type text,
  passenger_count integer,
  service_date timestamptz,
  status text,
  published_at timestamptz,
  expires_at timestamptz,
  bid_count bigint,
  created_at timestamptz,
  vehicle_type_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = routesred, public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    qr.id AS id,
    qr.trip_type AS trip_type,
    qr.passenger_count AS passenger_count,
    qr.service_date AS service_date,
    qr.status AS status,
    qr.published_at AS published_at,
    qr.expires_at AS expires_at,
    (
      SELECT count(*)
      FROM routesred.quote_bids qb
      WHERE qb.quote_request_id = qr.id
        AND qb.status NOT IN ('withdrawn')
    ) AS bid_count,
    qr.created_at AS created_at,
    vt.name AS vehicle_type_name
  FROM routesred.quote_requests qr
  LEFT JOIN routesred.vehicle_types vt ON vt.id = qr.vehicle_type_id
  WHERE qr.user_id = auth.uid()
  ORDER BY qr.created_at DESC
;


END
;


$$
;



CREATE OR REPLACE FUNCTION routesred.get_quote_bids_for_user_routesred(p_quote_request_id uuid)
RETURNS TABLE(
  id uuid,
  total_cents bigint,
  commission_cents bigint,
  currency text,
  estimated_time_text text,
  terms text,
  status text,
  vehicle_count integer,
  is_combination boolean,
  created_at timestamptz,
  provider_display_name text,
  provider_rating_average numeric,
  provider_rating_count integer,
  provider_slug text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = routesred, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM routesred.quote_requests qr
    WHERE qr.id = p_quote_request_id
      AND qr.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized'
;


  END IF
;



  RETURN QUERY
  SELECT
    qb.id AS id,
    qb.total_cents AS total_cents,
    qb.commission_cents AS commission_cents,
    qb.currency AS currency,
    qb.estimated_time_text AS estimated_time_text,
    qb.terms AS terms,
    qb.status AS status,
    qb.vehicle_count AS vehicle_count,
    qb.is_combination AS is_combination,
    qb.created_at AS created_at,
    COALESCE(
      tp.trade_name,
      tp.legal_name,
      tp.first_name || ' ' || tp.last_name,
      'Proveedor'
    ) AS provider_display_name,
    tp.rating_average AS provider_rating_average,
    tp.rating_count AS provider_rating_count,
    tp.slug AS provider_slug
  FROM routesred.quote_bids qb
  INNER JOIN routesred.transport_providers tp ON tp.id = qb.transport_provider_id
  WHERE qb.quote_request_id = p_quote_request_id
    AND qb.status NOT IN ('withdrawn')
  ORDER BY qb.total_cents ASC
;


END
;


$$
;
