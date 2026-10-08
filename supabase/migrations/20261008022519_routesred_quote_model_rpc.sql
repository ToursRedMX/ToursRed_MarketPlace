-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20261008022519
--   name:    routesred_quote_model_rpc
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
# RoutesRed — Quote/Auction RPC Functions

## Overview
Creates all SECURITY DEFINER RPC functions for the quote model in `routesred`.
All function names end with `_routesred` to distinguish from other platforms.

## Functions
1. create_quote_request_routesred — creates a draft quote request.
2. publish_quote_request_routesred — status→open, 72h expiry, auto-match invites.
3. accept_quote_bid_routesred — user accepts a bid, creates pending payment.
4. cancel_quote_request_routesred — user cancels with reason.
5. submit_quote_bid_routesred — provider submits bid (15% commission server-side).
6. decline_quote_invite_routesred — provider declines invite.
7. withdraw_quote_bid_routesred — provider withdraws pending bid.
8. expire_quote_requests_routesred — cron: expire past-72h requests.
9. confirm_quote_payment_routesred — webhook: mark payment paid.
10. get_user_quote_requests_routesred — user's own requests.
11. get_quote_bids_for_user_routesred — bids for a request (no contact info).
12. get_provider_quote_invites_routesred — open invites for caller's provider.
13. get_quote_detail_for_provider_routesred — request detail (no user contact).

## Security
- All: SECURITY DEFINER, SET search_path, REVOKE FROM PUBLIC/anon, GRANT TO authenticated.
- Actor = auth.uid(), never from params.
- Commission 15% computed server-side.
- Vehicle ownership validated server-side.
*/

-- =============================================================
-- 1. create_quote_request_routesred
-- =============================================================
CREATE OR REPLACE FUNCTION routesred.create_quote_request_routesred(
  p_trip_type       text,
  p_passenger_count integer,
  p_service_date    timestamptz,
  p_vehicle_type_id uuid DEFAULT NULL,
  p_budget_cents    bigint DEFAULT NULL,
  p_currency        text DEFAULT 'mxn',
  p_notes           text DEFAULT NULL,
  p_stops           jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = routesred, public
AS $$
DECLARE
  v_id uuid
;


  v_uid uuid := auth.uid()
;


  v_stop jsonb
;


  v_order int := 0
;


BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'
;

END IF
;


  IF p_trip_type NOT IN ('airport','intercity','event','tour','other') THEN
    RAISE EXCEPTION 'Invalid trip_type'
;


  END IF
;


  IF p_passenger_count IS NULL OR p_passenger_count < 1 THEN
    RAISE EXCEPTION 'passenger_count must be >= 1'
;


  END IF
;


  IF p_service_date IS NULL OR p_service_date < now() THEN
    RAISE EXCEPTION 'service_date must be in the future'
;


  END IF
;



  INSERT INTO routesred.quote_requests
    (user_id, trip_type, vehicle_type_id, passenger_count, service_date,
     budget_cents, currency, notes, status)
  VALUES
    (v_uid, p_trip_type, p_vehicle_type_id, p_passenger_count, p_service_date,
     p_budget_cents, p_currency, p_notes, 'draft')
  RETURNING id INTO v_id
;



  IF p_stops IS NOT NULL THEN
    FOR v_stop IN SELECT jsonb_array_elements(p_stops) LOOP
      INSERT INTO routesred.quote_request_stops
        (quote_request_id, stop_order, stop_type, address, coordinates, scheduled_time)
      VALUES
        (v_id, v_order,
         COALESCE(v_stop->>'stop_type', 'stopover'),
         v_stop->>'address',
         CASE WHEN v_stop ? 'lng' AND v_stop ? 'lat'
              THEN extensions.ST_MakePoint((v_stop->>'lng')::float8, (v_stop->>'lat')::float8)::extensions.geography(Point,4326)
              ELSE NULL END,
         CASE WHEN v_stop ? 'scheduled_time'
              THEN (v_stop->>'scheduled_time')::timestamptz
              ELSE NULL END)
;


      v_order := v_order + 1
;


    END LOOP
;


  END IF
;



  INSERT INTO routesred.quote_events (quote_request_id, event_type, actor_user_id)
  VALUES (v_id, 'created', v_uid)
;



  RETURN v_id
;


END
;


$$
;



REVOKE EXECUTE ON FUNCTION routesred.create_quote_request_routesred(text,integer,timestamptz,uuid,bigint,text,text,jsonb) FROM PUBLIC, anon
;


GRANT EXECUTE ON FUNCTION routesred.create_quote_request_routesred(text,integer,timestamptz,uuid,bigint,text,text,jsonb) TO authenticated
;



-- =============================================================
-- 2. publish_quote_request_routesred
-- =============================================================
CREATE OR REPLACE FUNCTION routesred.publish_quote_request_routesred(
  p_quote_request_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = routesred, public
AS $$
DECLARE
  v_uid uuid := auth.uid()
;


  v_req routesred.quote_requests%ROWTYPE
;


  v_vehicle_type_id uuid
;


  v_pax integer
;


  v_provider_id uuid
;


  v_capacity_sum integer
;


BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'
;

END IF
;



  SELECT * INTO v_req FROM routesred.quote_requests WHERE id = p_quote_request_id
;


  IF NOT FOUND THEN RAISE EXCEPTION 'Quote request not found'
;

END IF
;


  IF v_req.user_id != v_uid THEN RAISE EXCEPTION 'Not authorized'
;

END IF
;


  IF v_req.status != 'draft' THEN RAISE EXCEPTION 'Only draft requests can be published'
;

END IF
;



  UPDATE routesred.quote_requests
    SET status = 'open',
        published_at = now(),
        expires_at = now() + interval '72 hours'
    WHERE id = p_quote_request_id
;



  v_vehicle_type_id := v_req.vehicle_type_id
;


  v_pax := v_req.passenger_count
;



  IF v_vehicle_type_id IS NOT NULL THEN
    FOR v_provider_id IN
      SELECT DISTINCT v.transport_provider_id
      FROM routesred.vehicles v
      INNER JOIN routesred.transport_providers tp ON tp.id = v.transport_provider_id
      WHERE v.vehicle_type_id = v_vehicle_type_id
        AND v.status = 'active'
        AND v.active = true
        AND tp.status = 'active'
        AND tp.verification_status = 'verified'
        AND tp.active = true
    LOOP
      SELECT COALESCE(SUM(v.capacity), 0) INTO v_capacity_sum
      FROM routesred.vehicles v
      WHERE v.transport_provider_id = v_provider_id
        AND v.vehicle_type_id = v_vehicle_type_id
        AND v.status = 'active'
        AND v.active = true
;



      IF v_capacity_sum >= v_pax THEN
        INSERT INTO routesred.quote_invites (quote_request_id, transport_provider_id, status, invited_at)
        VALUES (p_quote_request_id, v_provider_id, 'invited', now())
        ON CONFLICT (quote_request_id, transport_provider_id) DO NOTHING
;


      END IF
;


    END LOOP
;


  ELSE
    FOR v_provider_id IN
      SELECT tp.id
      FROM routesred.transport_providers tp
      WHERE tp.status = 'active'
        AND tp.verification_status = 'verified'
        AND tp.active = true
    LOOP
      SELECT COALESCE(SUM(v.capacity), 0) INTO v_capacity_sum
      FROM routesred.vehicles v
      WHERE v.transport_provider_id = v_provider_id
        AND v.status = 'active'
        AND v.active = true
;



      IF v_capacity_sum >= v_pax THEN
        INSERT INTO routesred.quote_invites (quote_request_id, transport_provider_id, status, invited_at)
        VALUES (p_quote_request_id, v_provider_id, 'invited', now())
        ON CONFLICT (quote_request_id, transport_provider_id) DO NOTHING
;


      END IF
;


    END LOOP
;


  END IF
;



  INSERT INTO routesred.quote_events (quote_request_id, event_type, actor_user_id, metadata)
  VALUES (p_quote_request_id, 'published', v_uid,
          jsonb_build_object('expires_at', now() + interval '72 hours'))
;


END
;


$$
;



REVOKE EXECUTE ON FUNCTION routesred.publish_quote_request_routesred(uuid) FROM PUBLIC, anon
;


GRANT EXECUTE ON FUNCTION routesred.publish_quote_request_routesred(uuid) TO authenticated
;



-- =============================================================
-- 3. accept_quote_bid_routesred
-- =============================================================
CREATE OR REPLACE FUNCTION routesred.accept_quote_bid_routesred(
  p_quote_bid_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = routesred, public
AS $$
DECLARE
  v_uid uuid := auth.uid()
;


  v_bid routesred.quote_bids%ROWTYPE
;


  v_req routesred.quote_requests%ROWTYPE
;


  v_payment_id uuid
;


BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'
;

END IF
;



  SELECT * INTO v_bid FROM routesred.quote_bids WHERE id = p_quote_bid_id
;


  IF NOT FOUND THEN RAISE EXCEPTION 'Bid not found'
;

END IF
;



  SELECT * INTO v_req FROM routesred.quote_requests WHERE id = v_bid.quote_request_id
;


  IF NOT FOUND THEN RAISE EXCEPTION 'Quote request not found'
;

END IF
;


  IF v_req.user_id != v_uid THEN RAISE EXCEPTION 'Not authorized'
;

END IF
;


  IF v_req.status != 'open' THEN RAISE EXCEPTION 'Request is not open'
;

END IF
;


  IF v_bid.status != 'pending' THEN RAISE EXCEPTION 'Bid is no longer pending'
;

END IF
;



  UPDATE routesred.quote_bids SET status = 'accepted' WHERE id = p_quote_bid_id
;


  UPDATE routesred.quote_bids SET status = 'rejected'
    WHERE quote_request_id = v_bid.quote_request_id AND id != p_quote_bid_id AND status = 'pending'
;


  UPDATE routesred.quote_requests
    SET status = 'closed', accepted_bid_id = p_quote_bid_id
    WHERE id = v_bid.quote_request_id
;



  INSERT INTO routesred.quote_payments
    (quote_request_id, quote_bid_id, user_id, total_cents, commission_cents,
     net_provider_cents, currency, status)
  VALUES
    (v_bid.quote_request_id, p_quote_bid_id, v_uid, v_bid.total_cents,
     v_bid.commission_cents, v_bid.net_provider_cents, v_bid.currency, 'pending')
  RETURNING id INTO v_payment_id
;



  INSERT INTO routesred.quote_events (quote_request_id, event_type, actor_user_id, metadata)
  VALUES (v_bid.quote_request_id, 'bid_accepted', v_uid,
          jsonb_build_object('bid_id', p_quote_bid_id, 'payment_id', v_payment_id))
;



  RETURN v_payment_id
;


END
;


$$
;



REVOKE EXECUTE ON FUNCTION routesred.accept_quote_bid_routesred(uuid) FROM PUBLIC, anon
;


GRANT EXECUTE ON FUNCTION routesred.accept_quote_bid_routesred(uuid) TO authenticated
;



-- =============================================================
-- 4. cancel_quote_request_routesred
-- =============================================================
CREATE OR REPLACE FUNCTION routesred.cancel_quote_request_routesred(
  p_quote_request_id uuid,
  p_cancel_reason    text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = routesred, public
AS $$
DECLARE
  v_uid uuid := auth.uid()
;


  v_req routesred.quote_requests%ROWTYPE
;


BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'
;

END IF
;



  SELECT * INTO v_req FROM routesred.quote_requests WHERE id = p_quote_request_id
;


  IF NOT FOUND THEN RAISE EXCEPTION 'Quote request not found'
;

END IF
;


  IF v_req.user_id != v_uid THEN RAISE EXCEPTION 'Not authorized'
;

END IF
;


  IF v_req.status NOT IN ('draft', 'open') THEN
    RAISE EXCEPTION 'Only draft or open requests can be cancelled'
;


  END IF
;



  UPDATE routesred.quote_requests
    SET status = 'cancelled', cancel_reason = p_cancel_reason
    WHERE id = p_quote_request_id
;


  UPDATE routesred.quote_bids SET status = 'expired'
    WHERE quote_request_id = p_quote_request_id AND status = 'pending'
;



  INSERT INTO routesred.quote_events (quote_request_id, event_type, actor_user_id, metadata)
  VALUES (p_quote_request_id, 'cancelled', v_uid,
          jsonb_build_object('reason', p_cancel_reason))
;


END
;


$$
;



REVOKE EXECUTE ON FUNCTION routesred.cancel_quote_request_routesred(uuid, text) FROM PUBLIC, anon
;


GRANT EXECUTE ON FUNCTION routesred.cancel_quote_request_routesred(uuid, text) TO authenticated
;



-- =============================================================
-- 5. submit_quote_bid_routesred
-- =============================================================
CREATE OR REPLACE FUNCTION routesred.submit_quote_bid_routesred(
  p_quote_request_id    uuid,
  p_total_cents         bigint,
  p_vehicle_ids         uuid[],
  p_estimated_time_text text DEFAULT NULL,
  p_terms               text DEFAULT NULL,
  p_valid_until         timestamptz DEFAULT NULL,
  p_currency            text DEFAULT 'mxn'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = routesred, public
AS $$
DECLARE
  v_uid uuid := auth.uid()
;


  v_provider_id uuid
;


  v_req routesred.quote_requests%ROWTYPE
;


  v_invite routesred.quote_invites%ROWTYPE
;


  v_bid_id uuid
;


  v_commission bigint
;


  v_net bigint
;


  v_vehicle_count integer
;


  v_is_combination boolean
;


  v_vehicle_id uuid
;


  v_valid_until timestamptz
;


BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'
;

END IF
;


  IF p_total_cents IS NULL OR p_total_cents <= 0 THEN
    RAISE EXCEPTION 'total_cents must be > 0'
;


  END IF
;


  IF p_vehicle_ids IS NULL OR array_length(p_vehicle_ids, 1) IS NULL OR array_length(p_vehicle_ids, 1) = 0 THEN
    RAISE EXCEPTION 'At least one vehicle must be selected'
;


  END IF
;



  SELECT tpu.transport_provider_id INTO v_provider_id
  FROM routesred.transport_provider_users tpu
  WHERE tpu.user_id = v_uid AND tpu.status = 'active'
    AND tpu.role IN ('owner','administrator','operator_manager','dispatcher')
  LIMIT 1
;


  IF v_provider_id IS NULL THEN RAISE EXCEPTION 'No provider associated with this user'
;

END IF
;



  SELECT * INTO v_req FROM routesred.quote_requests WHERE id = p_quote_request_id
;


  IF NOT FOUND THEN RAISE EXCEPTION 'Quote request not found'
;

END IF
;


  IF v_req.status != 'open' THEN RAISE EXCEPTION 'Quote request is not open'
;

END IF
;



  SELECT * INTO v_invite FROM routesred.quote_invites
    WHERE quote_request_id = p_quote_request_id AND transport_provider_id = v_provider_id
;


  IF NOT FOUND THEN RAISE EXCEPTION 'Your provider was not invited to this request'
;

END IF
;


  IF v_invite.status = 'declined' THEN RAISE EXCEPTION 'You already declined this request'
;

END IF
;



  FOR v_vehicle_id IN SELECT unnest(p_vehicle_ids) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM routesred.vehicles
      WHERE id = v_vehicle_id
        AND transport_provider_id = v_provider_id
        AND status = 'active'
        AND active = true
    ) THEN
      RAISE EXCEPTION 'Vehicle % does not belong to your provider or is not active', v_vehicle_id
;


    END IF
;


  END LOOP
;



  v_commission := CEIL(p_total_cents * 0.15)
;


  v_net := p_total_cents - v_commission
;


  v_vehicle_count := array_length(p_vehicle_ids, 1)
;


  v_is_combination := v_vehicle_count > 1
;


  v_valid_until := COALESCE(p_valid_until, v_req.expires_at)
;



  INSERT INTO routesred.quote_bids
    (quote_request_id, transport_provider_id, total_cents, commission_cents,
     net_provider_cents, currency, estimated_time_text, terms, valid_until,
     status, vehicle_count, is_combination)
  VALUES
    (p_quote_request_id, v_provider_id, p_total_cents, v_commission,
     v_net, p_currency, p_estimated_time_text, p_terms, v_valid_until,
     'pending', v_vehicle_count, v_is_combination)
  RETURNING id INTO v_bid_id
;



  FOR v_vehicle_id IN SELECT unnest(p_vehicle_ids) LOOP
    INSERT INTO routesred.quote_bid_vehicles (quote_bid_id, vehicle_id)
    VALUES (v_bid_id, v_vehicle_id)
;


  END LOOP
;



  UPDATE routesred.quote_invites
    SET status = 'participating', responded_at = now()
    WHERE quote_request_id = p_quote_request_id AND transport_provider_id = v_provider_id
;



  INSERT INTO routesred.quote_events (quote_request_id, event_type, actor_user_id, metadata)
  VALUES (p_quote_request_id, 'bid_submitted', v_uid,
          jsonb_build_object('bid_id', v_bid_id, 'provider_id', v_provider_id))
;



  RETURN v_bid_id
;


END
;


$$
;



REVOKE EXECUTE ON FUNCTION routesred.submit_quote_bid_routesred(uuid,bigint,uuid[],text,text,timestamptz,text) FROM PUBLIC, anon
;


GRANT EXECUTE ON FUNCTION routesred.submit_quote_bid_routesred(uuid,bigint,uuid[],text,text,timestamptz,text) TO authenticated
;



-- =============================================================
-- 6. decline_quote_invite_routesred
-- =============================================================
CREATE OR REPLACE FUNCTION routesred.decline_quote_invite_routesred(
  p_quote_request_id uuid,
  p_decline_reason   text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = routesred, public
AS $$
DECLARE
  v_uid uuid := auth.uid()
;


  v_provider_id uuid
;


BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'
;

END IF
;



  SELECT tpu.transport_provider_id INTO v_provider_id
  FROM routesred.transport_provider_users tpu
  WHERE tpu.user_id = v_uid AND tpu.status = 'active'
    AND tpu.role IN ('owner','administrator','operator_manager','dispatcher')
  LIMIT 1
;


  IF v_provider_id IS NULL THEN RAISE EXCEPTION 'No provider associated with this user'
;

END IF
;



  UPDATE routesred.quote_invites
    SET status = 'declined', decline_reason = p_decline_reason, responded_at = now()
    WHERE quote_request_id = p_quote_request_id
      AND transport_provider_id = v_provider_id
      AND status IN ('invited', 'participating')
;



  INSERT INTO routesred.quote_events (quote_request_id, event_type, actor_user_id, metadata)
  VALUES (p_quote_request_id, 'invite_declined', v_uid,
          jsonb_build_object('provider_id', v_provider_id, 'reason', p_decline_reason))
;


END
;


$$
;



REVOKE EXECUTE ON FUNCTION routesred.decline_quote_invite_routesred(uuid, text) FROM PUBLIC, anon
;


GRANT EXECUTE ON FUNCTION routesred.decline_quote_invite_routesred(uuid, text) TO authenticated
;



-- =============================================================
-- 7. withdraw_quote_bid_routesred
-- =============================================================
CREATE OR REPLACE FUNCTION routesred.withdraw_quote_bid_routesred(
  p_quote_bid_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = routesred, public
AS $$
DECLARE
  v_uid uuid := auth.uid()
;


  v_bid routesred.quote_bids%ROWTYPE
;


BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'
;

END IF
;



  SELECT * INTO v_bid FROM routesred.quote_bids WHERE id = p_quote_bid_id
;


  IF NOT FOUND THEN RAISE EXCEPTION 'Bid not found'
;

END IF
;


  IF v_bid.status != 'pending' THEN RAISE EXCEPTION 'Only pending bids can be withdrawn'
;

END IF
;


  IF NOT routesred.is_provider_member(v_bid.transport_provider_id) THEN
    RAISE EXCEPTION 'Not authorized'
;


  END IF
;



  UPDATE routesred.quote_bids
    SET status = 'withdrawn', withdrawn_at = now()
    WHERE id = p_quote_bid_id
;



  INSERT INTO routesred.quote_events (quote_request_id, event_type, actor_user_id, metadata)
  VALUES (v_bid.quote_request_id, 'bid_withdrawn', v_uid,
          jsonb_build_object('bid_id', p_quote_bid_id))
;


END
;


$$
;



REVOKE EXECUTE ON FUNCTION routesred.withdraw_quote_bid_routesred(uuid) FROM PUBLIC, anon
;


GRANT EXECUTE ON FUNCTION routesred.withdraw_quote_bid_routesred(uuid) TO authenticated
;



-- =============================================================
-- 8. expire_quote_requests_routesred (cron, no auth check)
-- =============================================================
CREATE OR REPLACE FUNCTION routesred.expire_quote_requests_routesred()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = routesred, public
AS $$
DECLARE
  v_count integer := 0
;


BEGIN
  UPDATE routesred.quote_requests
    SET status = 'expired'
    WHERE status = 'open' AND expires_at IS NOT NULL AND expires_at < now()
;


  GET DIAGNOSTICS v_count = ROW_COUNT
;



  UPDATE routesred.quote_bids
    SET status = 'expired'
    WHERE status = 'pending' AND valid_until IS NOT NULL AND valid_until < now()
;



  UPDATE routesred.quote_invites
    SET status = 'expired'
    WHERE status IN ('invited', 'participating')
      AND quote_request_id IN (SELECT id FROM routesred.quote_requests WHERE status = 'expired')
;



  RETURN v_count
;


END
;


$$
;



REVOKE EXECUTE ON FUNCTION routesred.expire_quote_requests_routesred() FROM PUBLIC, anon
;


GRANT EXECUTE ON FUNCTION routesred.expire_quote_requests_routesred() TO authenticated
;



-- =============================================================
-- 9. confirm_quote_payment_routesred (called by Stripe webhook)
-- =============================================================
CREATE OR REPLACE FUNCTION routesred.confirm_quote_payment_routesred(
  p_payment_id               uuid,
  p_stripe_session_id        text,
  p_stripe_payment_intent_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = routesred, public
AS $$
DECLARE
  v_pay routesred.quote_payments%ROWTYPE
;


BEGIN
  SELECT * INTO v_pay FROM routesred.quote_payments WHERE id = p_payment_id
;


  IF NOT FOUND THEN RAISE EXCEPTION 'Payment record not found'
;

END IF
;


  IF v_pay.status != 'pending' THEN RAISE EXCEPTION 'Payment is not pending'
;

END IF
;



  UPDATE routesred.quote_payments
    SET status = 'paid',
        stripe_session_id = p_stripe_session_id,
        stripe_payment_intent_id = p_stripe_payment_intent_id
    WHERE id = p_payment_id
;



  INSERT INTO routesred.quote_events (quote_request_id, event_type, metadata)
  VALUES (v_pay.quote_request_id, 'payment_confirmed',
          jsonb_build_object('payment_id', p_payment_id, 'amount', v_pay.total_cents))
;


END
;


$$
;



REVOKE EXECUTE ON FUNCTION routesred.confirm_quote_payment_routesred(uuid, text, text) FROM PUBLIC, anon
;


GRANT EXECUTE ON FUNCTION routesred.confirm_quote_payment_routesred(uuid, text, text) TO authenticated
;



-- =============================================================
-- 10. get_user_quote_requests_routesred
-- =============================================================
CREATE OR REPLACE FUNCTION routesred.get_user_quote_requests_routesred()
RETURNS table (
  id uuid, trip_type text, passenger_count integer, service_date timestamptz,
  status text, published_at timestamptz, expires_at timestamptz,
  bid_count bigint, created_at timestamptz, vehicle_type_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = routesred, public
AS $$
BEGIN
  RETURN QUERY
    SELECT qr.id, qr.trip_type, qr.passenger_count, qr.service_date,
           qr.status, qr.published_at, qr.expires_at,
           (SELECT count(*) FROM routesred.quote_bids qb
             WHERE qb.quote_request_id = qr.id AND qb.status NOT IN ('withdrawn')),
           qr.created_at, vt.name
    FROM routesred.quote_requests qr
    LEFT JOIN routesred.vehicle_types vt ON vt.id = qr.vehicle_type_id
    WHERE qr.user_id = auth.uid()
    ORDER BY qr.created_at DESC
;


END
;


$$
;



REVOKE EXECUTE ON FUNCTION routesred.get_user_quote_requests_routesred() FROM PUBLIC, anon
;


GRANT EXECUTE ON FUNCTION routesred.get_user_quote_requests_routesred() TO authenticated
;



-- =============================================================
-- 11. get_quote_bids_for_user_routesred (no provider contact info)
-- =============================================================
CREATE OR REPLACE FUNCTION routesred.get_quote_bids_for_user_routesred(
  p_quote_request_id uuid
) RETURNS table (
  id uuid, total_cents bigint, commission_cents bigint, currency text,
  estimated_time_text text, terms text, status text, vehicle_count integer,
  is_combination boolean, created_at timestamptz,
  provider_display_name text, provider_rating_average numeric,
  provider_rating_count integer, provider_slug text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = routesred, public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM routesred.quote_requests WHERE id = p_quote_request_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized'
;


  END IF
;



  RETURN QUERY
    SELECT qb.id, qb.total_cents, qb.commission_cents, qb.currency,
           qb.estimated_time_text, qb.terms, qb.status,
           qb.vehicle_count, qb.is_combination, qb.created_at,
           COALESCE(tp.trade_name, tp.legal_name,
                    tp.first_name || ' ' || tp.last_name, 'Proveedor'),
           tp.rating_average, tp.rating_count, tp.slug
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



REVOKE EXECUTE ON FUNCTION routesred.get_quote_bids_for_user_routesred(uuid) FROM PUBLIC, anon
;


GRANT EXECUTE ON FUNCTION routesred.get_quote_bids_for_user_routesred(uuid) TO authenticated
;



-- =============================================================
-- 12. get_provider_quote_invites_routesred
-- =============================================================
CREATE OR REPLACE FUNCTION routesred.get_provider_quote_invites_routesred()
RETURNS table (
  quote_request_id uuid, trip_type text, passenger_count integer,
  service_date timestamptz, expires_at timestamptz, invite_status text,
  has_bid boolean, vehicle_type_name text, bid_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = routesred, public
AS $$
DECLARE
  v_provider_id uuid
;


BEGIN
  SELECT tpu.transport_provider_id INTO v_provider_id
  FROM routesred.transport_provider_users tpu
  WHERE tpu.user_id = auth.uid() AND tpu.status = 'active'
  LIMIT 1
;


  IF v_provider_id IS NULL THEN RETURN
;

END IF
;



  RETURN QUERY
    SELECT qr.id, qr.trip_type, qr.passenger_count, qr.service_date,
           qr.expires_at, qi.status,
           EXISTS(SELECT 1 FROM routesred.quote_bids qb
                  WHERE qb.quote_request_id = qr.id
                    AND qb.transport_provider_id = v_provider_id
                    AND qb.status NOT IN ('withdrawn')),
           vt.name,
           (SELECT qb2.status FROM routesred.quote_bids qb2
             WHERE qb2.quote_request_id = qr.id
               AND qb2.transport_provider_id = v_provider_id
               AND qb2.status NOT IN ('withdrawn') LIMIT 1)
    FROM routesred.quote_invites qi
    INNER JOIN routesred.quote_requests qr ON qr.id = qi.quote_request_id
    LEFT JOIN routesred.vehicle_types vt ON vt.id = qr.vehicle_type_id
    WHERE qi.transport_provider_id = v_provider_id
      AND qi.status IN ('invited', 'participating')
      AND qr.status = 'open'
    ORDER BY qr.expires_at ASC
;


END
;


$$
;



REVOKE EXECUTE ON FUNCTION routesred.get_provider_quote_invites_routesred() FROM PUBLIC, anon
;


GRANT EXECUTE ON FUNCTION routesred.get_provider_quote_invites_routesred() TO authenticated
;



-- =============================================================
-- 13. get_quote_detail_for_provider_routesred (no user contact info)
-- =============================================================
CREATE OR REPLACE FUNCTION routesred.get_quote_detail_for_provider_routesred(
  p_quote_request_id uuid
) RETURNS table (
  trip_type text, passenger_count integer, service_date timestamptz,
  expires_at timestamptz, notes text, budget_cents bigint,
  vehicle_type_name text, invite_status text,
  existing_bid_id uuid, existing_bid_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = routesred, public
AS $$
DECLARE
  v_provider_id uuid
;


BEGIN
  SELECT tpu.transport_provider_id INTO v_provider_id
  FROM routesred.transport_provider_users tpu
  WHERE tpu.user_id = auth.uid() AND tpu.status = 'active'
  LIMIT 1
;


  IF v_provider_id IS NULL THEN RETURN
;

END IF
;



  IF NOT EXISTS (
    SELECT 1 FROM routesred.quote_invites
    WHERE quote_request_id = p_quote_request_id AND transport_provider_id = v_provider_id
  ) THEN RETURN
;

END IF
;



  RETURN QUERY
    SELECT qr.trip_type, qr.passenger_count, qr.service_date,
           qr.expires_at, qr.notes, qr.budget_cents, vt.name,
           qi.status,
           (SELECT qb.id FROM routesred.quote_bids qb
             WHERE qb.quote_request_id = p_quote_request_id
               AND qb.transport_provider_id = v_provider_id
               AND qb.status NOT IN ('withdrawn') LIMIT 1),
           (SELECT qb.status FROM routesred.quote_bids qb
             WHERE qb.quote_request_id = p_quote_request_id
               AND qb.transport_provider_id = v_provider_id
               AND qb.status NOT IN ('withdrawn') LIMIT 1)
    FROM routesred.quote_requests qr
    LEFT JOIN routesred.vehicle_types vt ON vt.id = qr.vehicle_type_id
    LEFT JOIN routesred.quote_invites qi ON qi.quote_request_id = qr.id
      AND qi.transport_provider_id = v_provider_id
    WHERE qr.id = p_quote_request_id
;


END
;


$$
;



REVOKE EXECUTE ON FUNCTION routesred.get_quote_detail_for_provider_routesred(uuid) FROM PUBLIC, anon
;


GRANT EXECUTE ON FUNCTION routesred.get_quote_detail_for_provider_routesred(uuid) TO authenticated
;



;
