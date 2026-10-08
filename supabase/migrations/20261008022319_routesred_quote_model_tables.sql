-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20261008022319
--   name:    routesred_quote_model_tables
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
# RoutesRed — Quote/Auction Model Tables

## Overview
Creates the core tables for the closed-auction quote model in the `routesred`
schema. Users create transport requests
;

system auto-matches providers
;


providers submit bids
;

user accepts one and pays via Stripe
;

contact
details released only after payment.

## New Tables (all in schema `routesred`)
1. quote_requests — transport request with trip type, pax, date, budget.
2. quote_request_stops — ordered itinerary with PostGIS coords.
3. quote_invites — which providers were invited to bid.
4. quote_bids — provider's quote with server-computed 15% commission.
5. quote_bid_vehicles — vehicles linked to a bid.
6. quote_events — audit log.
7. quote_payments — Stripe payment record with commission breakdown.

## Security
- RLS on all tables.
- Owner-scoped SELECT/INSERT on quote_requests
;

UPDATE via RPC only.
- Provider members can SELECT requests/bids/invites if invited.
- quote_bids: REVOKE direct writes — mutations via RPC.
- All mutation RPCs are SECURITY DEFINER, REVOKE FROM PUBLIC, anon.
*/

-- =============================================================
-- Phase 1: Create all tables (no cross-table policies yet)
-- =============================================================

CREATE TABLE routesred.quote_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_type        text NOT NULL CHECK (trip_type IN ('airport', 'intercity', 'event', 'tour', 'other')),
  vehicle_type_id  uuid REFERENCES routesred.vehicle_types(id) ON DELETE SET NULL,
  passenger_count  integer NOT NULL CHECK (passenger_count >= 1),
  service_date     timestamptz NOT NULL,
  budget_cents     bigint CHECK (budget_cents IS NULL OR budget_cents >= 0),
  currency         text NOT NULL DEFAULT 'mxn',
  notes            text,
  status           text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'open', 'closed', 'cancelled', 'expired')),
  published_at     timestamptz,
  expires_at       timestamptz,
  accepted_bid_id  uuid,
  cancel_reason    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
)
;



CREATE INDEX IF NOT EXISTS qr_user_idx ON routesred.quote_requests (user_id)
;


CREATE INDEX IF NOT EXISTS qr_status_idx ON routesred.quote_requests (status)
;


CREATE INDEX IF NOT EXISTS qr_expires_idx ON routesred.quote_requests (expires_at) WHERE status = 'open'
;



ALTER TABLE routesred.quote_requests ENABLE ROW LEVEL SECURITY
;


DROP TRIGGER IF EXISTS qr_updated_at ON routesred.quote_requests
;


CREATE TRIGGER qr_updated_at BEFORE UPDATE ON routesred.quote_requests
  FOR EACH ROW EXECUTE FUNCTION routesred.set_updated_at()
;


REVOKE UPDATE ON routesred.quote_requests FROM authenticated
;


GRANT SELECT, INSERT ON routesred.quote_requests TO authenticated
;



DROP POLICY IF EXISTS "qr_insert_owner" ON routesred.quote_requests
;


CREATE POLICY "qr_insert_owner"
  ON routesred.quote_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid())
;



-- quote_request_stops
CREATE TABLE routesred.quote_request_stops (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_request_id uuid NOT NULL REFERENCES routesred.quote_requests(id) ON DELETE CASCADE,
  stop_order       integer NOT NULL CHECK (stop_order >= 0),
  stop_type        text NOT NULL CHECK (stop_type IN ('origin', 'destination', 'stopover')),
  address          text NOT NULL,
  coordinates      extensions.geography(Point, 4326),
  scheduled_time   timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
)
;



CREATE INDEX IF NOT EXISTS qrs_request_idx ON routesred.quote_request_stops (quote_request_id)
;


CREATE INDEX IF NOT EXISTS qrs_order_idx ON routesred.quote_request_stops (quote_request_id, stop_order)
;



ALTER TABLE routesred.quote_request_stops ENABLE ROW LEVEL SECURITY
;


GRANT SELECT, INSERT, DELETE ON routesred.quote_request_stops TO authenticated
;



DROP POLICY IF EXISTS "qrs_insert_owner" ON routesred.quote_request_stops
;


CREATE POLICY "qrs_insert_owner"
  ON routesred.quote_request_stops FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM routesred.quote_requests qr
      WHERE qr.id = quote_request_id AND qr.user_id = auth.uid()
    )
  )
;



DROP POLICY IF EXISTS "qrs_delete_owner" ON routesred.quote_request_stops
;


CREATE POLICY "qrs_delete_owner"
  ON routesred.quote_request_stops FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM routesred.quote_requests qr
      WHERE qr.id = quote_request_id AND qr.user_id = auth.uid()
    )
  )
;



-- quote_invites
CREATE TABLE routesred.quote_invites (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_request_id       uuid NOT NULL REFERENCES routesred.quote_requests(id) ON DELETE CASCADE,
  transport_provider_id  uuid NOT NULL REFERENCES routesred.transport_providers(id) ON DELETE CASCADE,
  status                 text NOT NULL DEFAULT 'invited'
                         CHECK (status IN ('invited', 'participating', 'declined', 'expired')),
  decline_reason         text,
  invited_at             timestamptz NOT NULL DEFAULT now(),
  responded_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qi_unique UNIQUE (quote_request_id, transport_provider_id)
)
;



CREATE INDEX IF NOT EXISTS qi_request_idx ON routesred.quote_invites (quote_request_id)
;


CREATE INDEX IF NOT EXISTS qi_provider_idx ON routesred.quote_invites (transport_provider_id)
;


CREATE INDEX IF NOT EXISTS qi_status_idx ON routesred.quote_invites (status)
;



ALTER TABLE routesred.quote_invites ENABLE ROW LEVEL SECURITY
;


DROP TRIGGER IF EXISTS qi_updated_at ON routesred.quote_invites
;


CREATE TRIGGER qi_updated_at BEFORE UPDATE ON routesred.quote_invites
  FOR EACH ROW EXECUTE FUNCTION routesred.set_updated_at()
;


GRANT SELECT ON routesred.quote_invites TO authenticated
;



-- quote_bids
CREATE TABLE routesred.quote_bids (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_request_id       uuid NOT NULL REFERENCES routesred.quote_requests(id) ON DELETE CASCADE,
  transport_provider_id  uuid NOT NULL REFERENCES routesred.transport_providers(id) ON DELETE CASCADE,
  total_cents            bigint NOT NULL CHECK (total_cents > 0),
  commission_cents       bigint NOT NULL CHECK (commission_cents >= 0),
  net_provider_cents     bigint NOT NULL CHECK (net_provider_cents >= 0),
  currency               text NOT NULL DEFAULT 'mxn',
  estimated_time_text    text,
  terms                  text,
  valid_until            timestamptz,
  status                 text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn', 'expired')),
  vehicle_count          integer NOT NULL DEFAULT 1 CHECK (vehicle_count >= 1),
  is_combination         boolean NOT NULL DEFAULT false,
  withdrawn_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
)
;



CREATE INDEX IF NOT EXISTS qb_request_idx ON routesred.quote_bids (quote_request_id)
;


CREATE INDEX IF NOT EXISTS qb_provider_idx ON routesred.quote_bids (transport_provider_id)
;


CREATE INDEX IF NOT EXISTS qb_status_idx ON routesred.quote_bids (status)
;



ALTER TABLE routesred.quote_bids ENABLE ROW LEVEL SECURITY
;


DROP TRIGGER IF EXISTS qb_updated_at ON routesred.quote_bids
;


CREATE TRIGGER qb_updated_at BEFORE UPDATE ON routesred.quote_bids
  FOR EACH ROW EXECUTE FUNCTION routesred.set_updated_at()
;


REVOKE INSERT, UPDATE, DELETE ON routesred.quote_bids FROM authenticated
;


GRANT SELECT ON routesred.quote_bids TO authenticated
;



-- quote_bid_vehicles
CREATE TABLE routesred.quote_bid_vehicles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_bid_id uuid NOT NULL REFERENCES routesred.quote_bids(id) ON DELETE CASCADE,
  vehicle_id   uuid NOT NULL REFERENCES routesred.vehicles(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now()
)
;



CREATE INDEX IF NOT EXISTS qbv_bid_idx ON routesred.quote_bid_vehicles (quote_bid_id)
;



ALTER TABLE routesred.quote_bid_vehicles ENABLE ROW LEVEL SECURITY
;


GRANT SELECT ON routesred.quote_bid_vehicles TO authenticated
;



-- quote_events
CREATE TABLE routesred.quote_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_request_id uuid NOT NULL REFERENCES routesred.quote_requests(id) ON DELETE CASCADE,
  event_type       text NOT NULL,
  actor_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata         jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
)
;



CREATE INDEX IF NOT EXISTS qe_request_idx ON routesred.quote_events (quote_request_id)
;



ALTER TABLE routesred.quote_events ENABLE ROW LEVEL SECURITY
;


GRANT SELECT ON routesred.quote_events TO authenticated
;



-- quote_payments
CREATE TABLE routesred.quote_payments (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_request_id         uuid NOT NULL REFERENCES routesred.quote_requests(id) ON DELETE CASCADE,
  quote_bid_id             uuid NOT NULL REFERENCES routesred.quote_bids(id) ON DELETE CASCADE,
  user_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_session_id        text,
  stripe_payment_intent_id text,
  total_cents              bigint NOT NULL CHECK (total_cents > 0),
  commission_cents         bigint NOT NULL CHECK (commission_cents >= 0),
  net_provider_cents       bigint NOT NULL CHECK (net_provider_cents >= 0),
  currency                 text NOT NULL DEFAULT 'mxn',
  status                   text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
)
;



CREATE INDEX IF NOT EXISTS qp_request_idx ON routesred.quote_payments (quote_request_id)
;


CREATE INDEX IF NOT EXISTS qp_user_idx ON routesred.quote_payments (user_id)
;



ALTER TABLE routesred.quote_payments ENABLE ROW LEVEL SECURITY
;


DROP TRIGGER IF EXISTS qp_updated_at ON routesred.quote_payments
;


CREATE TRIGGER qp_updated_at BEFORE UPDATE ON routesred.quote_payments
  FOR EACH ROW EXECUTE FUNCTION routesred.set_updated_at()
;


GRANT SELECT ON routesred.quote_payments TO authenticated
;



-- =============================================================
-- Phase 2: Cross-referencing SELECT policies (all tables now exist)
-- =============================================================

-- quote_requests SELECT (references quote_invites)
DROP POLICY IF EXISTS "qr_select_owner_or_invited" ON routesred.quote_requests
;


CREATE POLICY "qr_select_owner_or_invited"
  ON routesred.quote_requests FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM routesred.quote_invites qi
      WHERE qi.quote_request_id = quote_requests.id
        AND qi.transport_provider_id IN (
          SELECT tpu.transport_provider_id
          FROM routesred.transport_provider_users tpu
          WHERE tpu.user_id = auth.uid() AND tpu.status = 'active'
        )
    )
    OR public.is_super_admin()
  )
;



-- quote_request_stops SELECT (references quote_invites)
DROP POLICY IF EXISTS "qrs_select_owner_or_invited" ON routesred.quote_request_stops
;


CREATE POLICY "qrs_select_owner_or_invited"
  ON routesred.quote_request_stops FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM routesred.quote_requests qr
      WHERE qr.id = quote_request_id
        AND (
          qr.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM routesred.quote_invites qi
            WHERE qi.quote_request_id = qr.id
              AND qi.transport_provider_id IN (
                SELECT tpu.transport_provider_id
                FROM routesred.transport_provider_users tpu
                WHERE tpu.user_id = auth.uid() AND tpu.status = 'active'
              )
          )
          OR public.is_super_admin()
        )
    )
  )
;



-- quote_invites SELECT
DROP POLICY IF EXISTS "qi_select_owner_or_member" ON routesred.quote_invites
;


CREATE POLICY "qi_select_owner_or_member"
  ON routesred.quote_invites FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM routesred.quote_requests qr
      WHERE qr.id = quote_request_id AND qr.user_id = auth.uid()
    )
    OR routesred.is_provider_member(transport_provider_id)
    OR public.is_super_admin()
  )
;



-- quote_bids SELECT
DROP POLICY IF EXISTS "qb_select_owner_or_member" ON routesred.quote_bids
;


CREATE POLICY "qb_select_owner_or_member"
  ON routesred.quote_bids FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM routesred.quote_requests qr
      WHERE qr.id = quote_request_id AND qr.user_id = auth.uid()
    )
    OR routesred.is_provider_member(transport_provider_id)
    OR public.is_super_admin()
  )
;



-- quote_bid_vehicles SELECT
DROP POLICY IF EXISTS "qbv_select_owner_or_member" ON routesred.quote_bid_vehicles
;


CREATE POLICY "qbv_select_owner_or_member"
  ON routesred.quote_bid_vehicles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM routesred.quote_bids qb
      WHERE qb.id = quote_bid_id
        AND (
          EXISTS (
            SELECT 1 FROM routesred.quote_requests qr
            WHERE qr.id = qb.quote_request_id AND qr.user_id = auth.uid()
          )
          OR routesred.is_provider_member(qb.transport_provider_id)
          OR public.is_super_admin()
        )
    )
  )
;



-- quote_events SELECT
DROP POLICY IF EXISTS "qe_select_owner" ON routesred.quote_events
;


CREATE POLICY "qe_select_owner"
  ON routesred.quote_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM routesred.quote_requests qr
      WHERE qr.id = quote_request_id AND qr.user_id = auth.uid()
    )
    OR public.is_super_admin()
  )
;



-- quote_payments SELECT
DROP POLICY IF EXISTS "qp_select_owner_or_member" ON routesred.quote_payments
;


CREATE POLICY "qp_select_owner_or_member"
  ON routesred.quote_payments FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM routesred.quote_bids qb
      WHERE qb.id = quote_bid_id
        AND routesred.is_provider_member(qb.transport_provider_id)
    )
    OR public.is_super_admin()
  )
;



;
