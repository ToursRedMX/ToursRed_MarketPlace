-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20261008055332
--   name:    20261008024000_grant_routesred_api_usage
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
# Allow authenticated API access to the RoutesRed schema

1. Purpose
- Fixes the `permission denied for schema routesred` error shown when an authenticated user registers as a transport provider.
- Allows Supabase's browser API client to resolve functions and public catalog tables in the `routesred` schema.

2. Schema access
- Grants USAGE on `routesred` to `anon` and `authenticated`.
- Schema usage does not grant access to private provider or user records by itself.

3. Function access
- The existing `routesred.create_provider` function remains restricted to authenticated users.
- The function remains SECURITY DEFINER and validates the caller with `auth.uid()`.

4. Table access
- Grants SELECT only on intentionally public catalog tables used by the frontend: airports, amenities, document_types, and vehicle_types.
- Provider, membership, quote, and user tables are not made directly readable by this change
;

their existing RLS and RPC controls remain in force.
*/

GRANT USAGE ON SCHEMA routesred TO anon, authenticated
;



GRANT SELECT ON TABLE
  routesred.airports,
  routesred.amenities,
  routesred.document_types,
  routesred.vehicle_types
TO anon, authenticated
;
