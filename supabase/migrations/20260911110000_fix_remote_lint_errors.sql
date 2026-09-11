-- Fixes for remote Supabase database lint findings.

ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'cobros_sin_comision';

-- The canonical featured plan table is featured_plans (not featured_tour_plans).
CREATE OR REPLACE FUNCTION public.activate_featured_slot(p_tour_id uuid, p_agency_id uuid, p_plan_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_active_count int; v_slot_id uuid; v_plan record; v_existing_slot uuid; v_is_owner boolean; v_is_admin boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.agencies WHERE id=p_agency_id AND user_id=auth.uid()) INTO v_is_owner;
  v_is_admin := public.is_admin_user();
  IF NOT v_is_owner AND NOT v_is_admin THEN RAISE EXCEPTION 'No autorizado'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('featured_slots'::text));
  SELECT count(*) INTO v_active_count FROM public.featured_tour_slots WHERE status='active' AND expires_at > now();
  IF v_active_count >= 50 THEN RAISE EXCEPTION 'Maximum of 50 active featured slots reached'; END IF;
  SELECT id INTO v_existing_slot FROM public.featured_tour_slots WHERE tour_id=p_tour_id AND status='active' AND expires_at > now() FOR UPDATE;
  IF v_existing_slot IS NOT NULL THEN RAISE EXCEPTION 'Tour already has an active featured slot'; END IF;
  SELECT * INTO v_plan FROM public.featured_plans WHERE id=p_plan_id AND is_active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found or inactive'; END IF;
  INSERT INTO public.featured_tour_slots (tour_id,agency_id,plan_id,status,starts_at,expires_at,total_amount)
  VALUES (p_tour_id,p_agency_id,p_plan_id,'active',now(),now()+(v_plan.duration_days||' days')::interval,v_plan.price)
  RETURNING id INTO v_slot_id;
  RETURN v_slot_id;
END;
$function$;

-- Correct schedule column names used by the slot generator.
CREATE OR REPLACE FUNCTION public.auto_generate_slots_for_range(p_tour_id uuid, p_start_date date, p_end_date date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_schedule record; v_current_date date; v_slot_exists boolean; v_created_count int:=0; v_tour record; v_is_owner boolean; v_is_admin boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.tours t JOIN public.agencies a ON a.id=t.agency_id WHERE t.id=p_tour_id AND a.user_id=auth.uid()) INTO v_is_owner;
  v_is_admin:=public.is_admin_user(); IF NOT v_is_owner AND NOT v_is_admin THEN RAISE EXCEPTION 'No autorizado'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_tour_id::text));
  SELECT * INTO v_tour FROM public.tours WHERE id=p_tour_id; IF NOT FOUND THEN RAISE EXCEPTION 'Tour no encontrado'; END IF;
  IF v_tour.tour_type <> 'receptivo' THEN RAISE EXCEPTION 'Solo tours receptivos soportan generacion automatica de slots'; END IF;
  FOR v_schedule IN SELECT * FROM public.tour_schedules WHERE tour_id=p_tour_id AND is_active=true LOOP
    v_current_date:=GREATEST(p_start_date,v_schedule.valid_from);
    IF v_schedule.valid_until IS NOT NULL THEN v_current_date:=GREATEST(v_current_date,CURRENT_DATE); END IF;
    WHILE v_current_date <= p_end_date AND (v_schedule.valid_until IS NULL OR v_current_date <= v_schedule.valid_until) LOOP
      SELECT EXISTS(SELECT 1 FROM public.tour_slots ts WHERE ts.tour_id=p_tour_id AND ts.schedule_id=v_schedule.id AND ts.slot_date=v_current_date AND ts.status <> 'cancelado') INTO v_slot_exists;
      IF NOT v_slot_exists THEN
        INSERT INTO public.tour_slots(tour_id,schedule_id,slot_date,departure_time,capacity,booked_count,status)
        VALUES(p_tour_id,v_schedule.id,v_current_date,v_schedule.departure_time,COALESCE(v_schedule.slot_capacity,0),0,'activo');
        v_created_count:=v_created_count+1;
      END IF;
      v_current_date:=v_current_date+INTERVAL '1 day';
    END LOOP;
  END LOOP;
  RETURN v_created_count;
END;
$function$;

-- Lock rows before aggregating, since FOR UPDATE cannot be used with aggregates.
CREATE OR REPLACE FUNCTION public.reserve_seats(p_tour_id uuid,p_agency_id uuid,p_booking_id uuid,p_seat_numbers integer[],p_slot_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_conflicting integer[]; v_seat integer; v_reserved integer[]:='{}'; v_failed integer[]:='{}'; v_rows integer; v_booking_user_id uuid;
BEGIN
  SELECT b.user_id INTO v_booking_user_id FROM public.bookings b WHERE b.id=p_booking_id;
  IF v_booking_user_id IS NULL THEN RAISE EXCEPTION 'Reserva no encontrada'; END IF;
  IF v_booking_user_id <> auth.uid() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  SELECT array_agg(s.seat_number) INTO v_conflicting FROM (SELECT seat_number,status FROM public.slot_seat_status WHERE tour_id=p_tour_id AND ((p_slot_id IS NULL AND slot_id IS NULL) OR (p_slot_id IS NOT NULL AND slot_id=p_slot_id)) AND seat_number=ANY(p_seat_numbers) FOR UPDATE) s WHERE s.status <> 'disponible';
  IF v_conflicting IS NOT NULL AND array_length(v_conflicting,1)>0 THEN RETURN jsonb_build_object('success',false,'error','Algunos asientos ya no estan disponibles','conflicting_seats',v_conflicting); END IF;
  FOREACH v_seat IN ARRAY p_seat_numbers LOOP
    INSERT INTO public.slot_seat_status(tour_id,slot_id,agency_id,seat_number,status,booking_id) VALUES(p_tour_id,p_slot_id,p_agency_id,v_seat,'reservado_online',p_booking_id)
    ON CONFLICT(tour_id,slot_id,seat_number) DO UPDATE SET status='reservado_online',booking_id=p_booking_id,updated_at=now() WHERE slot_seat_status.booking_id=p_booking_id OR slot_seat_status.status='disponible';
    GET DIAGNOSTICS v_rows=ROW_COUNT; IF v_rows=0 THEN v_failed:=array_append(v_failed,v_seat); ELSE v_reserved:=array_append(v_reserved,v_seat); END IF;
  END LOOP;
  IF array_length(v_failed,1)>0 THEN RETURN jsonb_build_object('success',false,'error','Algunos asientos ya no estan disponibles','conflicting_seats',v_failed,'reserved_seats',v_reserved); END IF;
  RETURN jsonb_build_object('success',true,'reserved_seats',p_seat_numbers);
END;
$function$;

-- Fix the date type assignment in automatic rescheduling.

-- Correct output types and column names in reporting functions.
DROP FUNCTION IF EXISTS public.get_my_sessions(integer, integer);
CREATE OR REPLACE FUNCTION public.get_my_sessions(p_limit int DEFAULT 20,p_offset int DEFAULT 0)
RETURNS TABLE(id uuid,session_id text,login_at timestamptz,logout_at timestamptz,ip_masked text,browser text,browser_version text,os text,os_version text,device_type text,device_name text,country text,city text,login_method text,success boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE v_caller_id uuid:=auth.uid();
BEGIN
 IF v_caller_id IS NULL THEN RAISE EXCEPTION 'permission_denied: must be authenticated'; END IF;
 RETURN QUERY SELECT s.id,s.session_id,s.login_at,s.logout_at,s.ip_masked,s.browser,s.browser_version,s.os,s.os_version,s.device_type,s.device_name,s.country,s.city,s.login_method,s.success FROM public.user_sessions s WHERE s.user_id=v_caller_id ORDER BY s.login_at DESC LIMIT p_limit OFFSET p_offset;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_points_expiring_soon(days_threshold integer DEFAULT 30)
RETURNS TABLE(user_id uuid,email text,nombre text,points_expiring integer,earliest_expiration timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE v_caller_role text;
BEGIN
 SELECT u.role INTO v_caller_role FROM public.users u WHERE u.id=auth.uid();
 IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin','super_admin') THEN RAISE EXCEPTION 'permission_denied: solo administradores pueden consultar este reporte'; END IF;
 RETURN QUERY SELECT u.id,au.email,concat_ws(' ',u.first_name,u.last_name),sum(t.amount)::integer,min(t.expires_at)
 FROM public.toursred_points_transactions t JOIN public.users u ON u.id=t.user_id LEFT JOIN auth.users au ON au.id=u.id
 WHERE t.type='earned' AND t.expires_at IS NOT NULL AND t.expires_at>now() AND t.expires_at<=now()+make_interval(days=>days_threshold) AND t.amount>0
 GROUP BY u.id,au.email,u.first_name,u.last_name HAVING sum(t.amount)>0 ORDER BY min(t.expires_at) ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_garbage_bookings(threshold_days int DEFAULT 7)
RETURNS TABLE(id uuid,booking_code text,created_at timestamptz,status text,payment_status text,payment_method text,total_price numeric,travelers_count int,user_name text,user_email text,tour_name text,agency_name text,reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $function$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users u_auth WHERE u_auth.id=auth.uid() AND u_auth.role IN ('admin','super_admin')) THEN RAISE EXCEPTION 'Acceso denegado: se requiere rol de administrador'; END IF;
 RETURN QUERY SELECT b.id,b.booking_code,b.created_at,b.status,b.payment_status,b.payment_method,b.total_price,b.travelers_count,coalesce(nullif(trim(concat(u.first_name,' ',u.last_name)),''),'—'),coalesce(u.email,'—'),coalesce(t.name,'—'),coalesce(a.name,'—'),CASE WHEN b.payment_status='pending' THEN 'abandoned' WHEN b.payment_status='processing' AND b.payment_method='Transferencia Bancaria' THEN 'unconfirmed_transfer' WHEN b.payment_status='processing' THEN 'expired_processing' ELSE 'other' END
 FROM public.bookings b LEFT JOIN public.users u ON u.id=b.user_id LEFT JOIN public.tours t ON t.id=b.tour_id LEFT JOIN public.agencies a ON a.id=b.agency_id
 WHERE b.status IN('pending','cancelled') AND ((b.payment_status='pending' AND b.created_at<now()-(threshold_days||' days')::interval) OR (b.payment_status='processing' AND b.payment_method='Transferencia Bancaria' AND b.created_at<now()-(threshold_days||' days')::interval) OR (b.payment_status='processing' AND b.payment_method<>'Transferencia Bancaria' AND b.created_at<now()-interval '3 days')) ORDER BY b.created_at ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_seat_map_availability(p_tour_id uuid,p_slot_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(seat_number integer,status text,booking_id uuid,block_note text,traveler_name text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $function$
BEGIN
 RETURN QUERY SELECT sss.seat_number,sss.status,sss.booking_id,sss.block_note,CASE WHEN sss.status='reservado_online' AND sss.booking_id IS NOT NULL THEN coalesce((SELECT concat_ws(' ',u.first_name,u.last_name) FROM public.users u JOIN public.bookings b ON b.user_id=u.id WHERE b.id=sss.booking_id LIMIT 1),'Viajero') WHEN sss.status='bloqueado_agencia' THEN coalesce(sss.block_note,'Bloqueado') ELSE NULL END FROM public.slot_seat_status sss WHERE sss.tour_id=p_tour_id AND ((p_slot_id IS NULL AND sss.slot_id IS NULL) OR (p_slot_id IS NOT NULL AND sss.slot_id=p_slot_id));
END;
$function$;

-- Keep the legacy messaging overload, with explicit casts to avoid unknown-argument resolution.
CREATE OR REPLACE FUNCTION public.create_conversation_with_participants(p_title text,p_type text,p_booking_id uuid DEFAULT NULL,p_tour_id uuid DEFAULT NULL,p_participant_ids uuid[] DEFAULT '{}'::uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE v_conversation_id uuid; v_participant_id uuid;
BEGIN
 INSERT INTO public.conversations(title,type,booking_id,tour_id,status,created_by) VALUES(p_title,p_type,p_booking_id,p_tour_id,'active',auth.uid()) RETURNING id INTO v_conversation_id;
 INSERT INTO public.message_participants(conversation_id,user_id,role,is_active) VALUES(v_conversation_id,auth.uid(),'moderator',true);
 IF p_participant_ids IS NOT NULL AND array_length(p_participant_ids,1)>0 THEN FOREACH v_participant_id IN ARRAY p_participant_ids LOOP IF v_participant_id<>auth.uid() THEN INSERT INTO public.message_participants(conversation_id,user_id,role,is_active) VALUES(v_conversation_id,v_participant_id,'participant',true); END IF; END LOOP; END IF;
 RETURN v_conversation_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.create_conversation_with_participants(p_title text,p_participant_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
BEGIN RETURN public.create_conversation_with_participants(p_title,'general'::text,NULL::uuid,NULL::uuid,p_participant_ids); END;
$function$;

-- These helpers have no application callers and reference tables absent from the deployed schema.
DROP FUNCTION IF EXISTS public.increment_geocoding_cache_usage(text);
DROP FUNCTION IF EXISTS public.get_departure_location_suggestions(text, integer);
DROP FUNCTION IF EXISTS public.search_featured_pois(text, integer);
DROP FUNCTION IF EXISTS public.redeem_checkin_token_atomic(text, timestamptz);

CREATE OR REPLACE FUNCTION public.auto_accept_expired_slot_reschedules()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request record
;


  v_response record
;


  v_target_slot record
;


  v_booking record
;


  v_processed_requests integer := 0
;


  v_moved_bookings integer := 0
;


  v_refunded_bookings integer := 0
;


  v_result jsonb
;


  v_confirmed_travelers integer
;


  v_available_spots integer
;


  v_travelers_this_booking integer
;


  v_refund_amount numeric
;


  v_now timestamptz
;


BEGIN
  v_now := now()
;



  FOR v_request IN
    SELECT srr.*
    FROM slot_reschedule_requests srr
    WHERE srr.status = 'pending_responses'
    AND srr.response_deadline < v_now
  LOOP
    SELECT * INTO v_target_slot
    FROM tour_slots
    WHERE id = v_request.target_slot_id
;



    IF v_target_slot IS NULL THEN
      UPDATE slot_reschedule_requests
      SET status = 'completed', completed_at = v_now
      WHERE id = v_request.id
;


      CONTINUE
;


    END IF
;



    v_available_spots := COALESCE(v_request.available_spots_in_target, v_target_slot.capacity - v_target_slot.booked_count)
;



    SELECT COALESCE(SUM(b.travelers_count), 0)
    INTO v_confirmed_travelers
    FROM slot_reschedule_responses srr2
    JOIN bookings b ON b.id = srr2.booking_id
    WHERE srr2.request_id = v_request.id
    AND srr2.confirmed_spot = true
    AND b.status IN ('confirmed', 'pending')
;



    FOR v_response IN
      SELECT srr2.*, b.travelers_count, b.deposit_amount, b.toursred_cash_used,
             b.user_id AS booking_user_id, b.status AS booking_status
      FROM slot_reschedule_responses srr2
      JOIN bookings b ON b.id = srr2.booking_id
      WHERE srr2.request_id = v_request.id
      AND srr2.response = 'pending'
      AND b.status IN ('confirmed', 'pending')
      ORDER BY srr2.booking_created_at ASC NULLS LAST, srr2.created_at ASC
    LOOP
      v_travelers_this_booking := COALESCE(v_response.travelers_count, 1)
;



      IF (v_available_spots - v_confirmed_travelers) >= v_travelers_this_booking THEN
        UPDATE slot_reschedule_responses
        SET response = 'auto_accepted',
            responded_at = v_now,
            confirmed_spot = true
        WHERE id = v_response.id
;



        UPDATE bookings
        SET has_pending_slot_reschedule = false,
            slot_reschedule_response = 'auto_accepted',
            slot_reschedule_responded_at = v_now,
            selected_date = v_target_slot.slot_date,
            selected_time = v_target_slot.departure_time,
            slot_id = v_target_slot.id
        WHERE id = v_response.booking_id
;



        v_confirmed_travelers := v_confirmed_travelers + v_travelers_this_booking
;


        v_moved_bookings := v_moved_bookings + 1
;



        INSERT INTO notifications (user_id, type, title, message, data)
        VALUES (
          v_response.booking_user_id,
          'slot_reschedule_auto_accepted',
          'Reagendamiento aceptado automaticamente',
          'Tu reserva fue movida automaticamente al nuevo horario ya que no respondiste a tiempo.',
          jsonb_build_object(
            'request_id', v_request.id,
            'booking_id', v_response.booking_id,
            'new_slot_date', v_target_slot.slot_date,
            'new_departure_time', v_target_slot.departure_time
          )
        )
;



      ELSE
        v_refund_amount := COALESCE(v_response.deposit_amount, 0) + COALESCE(v_response.toursred_cash_used, 0)
;



        UPDATE slot_reschedule_responses
        SET response = 'auto_accepted_no_availability',
            responded_at = v_now,
            confirmed_spot = false,
            refund_processed = true,
            refund_amount = v_refund_amount
        WHERE id = v_response.id
;



        UPDATE bookings
        SET status = 'cancelled',
            cancelled_at = v_now,
            cancellation_type = 'slot_reschedule_no_availability',
            cancellation_refund_amount = v_refund_amount,
            has_pending_slot_reschedule = false,
            slot_reschedule_response = 'auto_accepted_no_availability',
            slot_reschedule_responded_at = v_now
        WHERE id = v_response.booking_id
;



        IF v_refund_amount > 0 THEN
          PERFORM update_wallet_balance(
            v_response.booking_user_id,
            v_refund_amount,
            'refund',
            'Reembolso automatico: sin cupo disponible en reagendado de slot',
            v_response.booking_id,
            'slot_reschedule_no_availability'
          )
;


        END IF
;



        v_refunded_bookings := v_refunded_bookings + 1
;



        INSERT INTO notifications (user_id, type, title, message, data)
        VALUES (
          v_response.booking_user_id,
          'slot_reschedule_no_availability',
          'Sin cupo disponible - Reembolso procesado',
          'No habia cupo disponible en el nuevo horario para tu reserva. Se ha procesado un reembolso del 100% a tu ToursRed Cash.',
          jsonb_build_object(
            'request_id', v_request.id,
            'booking_id', v_response.booking_id,
            'refund_amount', v_refund_amount,
            'original_slot_date', (SELECT slot_date FROM tour_slots WHERE id = v_request.original_slot_id),
            'original_departure_time', (SELECT departure_time FROM tour_slots WHERE id = v_request.original_slot_id)
          )
        )
;


      END IF
;


    END LOOP
;



    UPDATE tour_slots
    SET booked_count = (
      SELECT COALESCE(SUM(b.travelers_count), 0)
      FROM slot_reschedule_responses srr2
      JOIN bookings b ON b.id = srr2.booking_id
      WHERE srr2.request_id = v_request.id
      AND srr2.confirmed_spot = true
      AND b.status IN ('confirmed', 'pending')
    )
    WHERE id = v_request.target_slot_id
    AND (
      SELECT COALESCE(SUM(b.travelers_count), 0)
      FROM slot_reschedule_responses srr2
      JOIN bookings b ON b.id = srr2.booking_id
      WHERE srr2.request_id = v_request.id
      AND srr2.confirmed_spot = true
      AND b.status IN ('confirmed', 'pending')
    ) > 0
;



    UPDATE tour_slots
    SET status = 'cancelado',
        cancellation_reason = 'Reagendado: ' || v_request.reason,
        cancelled_at = v_now
    WHERE id = v_request.original_slot_id
;



    UPDATE slot_reschedule_requests
    SET status = 'completed',
        completed_at = v_now,
        auto_accepted_count = (
          SELECT COUNT(*) FROM slot_reschedule_responses
          WHERE request_id = v_request.id AND response = 'auto_accepted'
        ),
        accepted_count = (
          SELECT COUNT(*) FROM slot_reschedule_responses
          WHERE request_id = v_request.id AND response = 'accepted'
        ),
        rejected_count = (
          SELECT COUNT(*) FROM slot_reschedule_responses
          WHERE request_id = v_request.id AND response IN ('rejected', 'auto_accepted_no_availability', 'accepted_no_availability')
        ),
        no_availability_count = (
          SELECT COUNT(*) FROM slot_reschedule_responses
          WHERE request_id = v_request.id AND response IN ('auto_accepted_no_availability', 'accepted_no_availability')
        )
    WHERE id = v_request.id
;



    v_processed_requests := v_processed_requests + 1
;


  END LOOP
;



  FOR v_request IN
    SELECT srr.*
    FROM slot_reschedule_requests srr
    WHERE srr.status = 'pending_responses'
    AND NOT EXISTS (
      SELECT 1 FROM slot_reschedule_responses r
      WHERE r.request_id = srr.id
      AND r.response = 'pending'
    )
  LOOP
    SELECT * INTO v_target_slot
    FROM tour_slots
    WHERE id = v_request.target_slot_id
;



    IF v_target_slot IS NOT NULL THEN
      UPDATE tour_slots
      SET booked_count = (
        SELECT COALESCE(SUM(b.travelers_count), 0)
        FROM slot_reschedule_responses srr2
        JOIN bookings b ON b.id = srr2.booking_id
        WHERE srr2.request_id = v_request.id
        AND srr2.confirmed_spot = true
        AND b.status IN ('confirmed', 'pending')
      )
      WHERE id = v_request.target_slot_id
      AND (
        SELECT COALESCE(SUM(b.travelers_count), 0)
        FROM slot_reschedule_responses srr2
        JOIN bookings b ON b.id = srr2.booking_id
        WHERE srr2.request_id = v_request.id
        AND srr2.confirmed_spot = true
        AND b.status IN ('confirmed', 'pending')
      ) > 0
;



      IF NOT EXISTS (
        SELECT 1 FROM bookings b
        JOIN slot_reschedule_responses srr2 ON srr2.booking_id = b.id
        WHERE srr2.request_id = v_request.id
        AND b.status IN ('confirmed', 'pending')
        AND b.selected_date = (SELECT slot_date FROM tour_slots WHERE id = v_request.original_slot_id)
      ) THEN
        UPDATE tour_slots
        SET status = 'cancelado',
            cancellation_reason = 'Reagendado: ' || v_request.reason,
            cancelled_at = v_now
        WHERE id = v_request.original_slot_id
;


      END IF
;


    END IF
;



    UPDATE slot_reschedule_requests
    SET status = 'completed',
        completed_at = v_now,
        accepted_count = (
          SELECT COUNT(*) FROM slot_reschedule_responses
          WHERE request_id = v_request.id AND response IN ('accepted')
        ),
        rejected_count = (
          SELECT COUNT(*) FROM slot_reschedule_responses
          WHERE request_id = v_request.id AND response IN ('rejected', 'auto_accepted_no_availability', 'accepted_no_availability')
        ),
        no_availability_count = (
          SELECT COUNT(*) FROM slot_reschedule_responses
          WHERE request_id = v_request.id AND response IN ('auto_accepted_no_availability', 'accepted_no_availability')
        )
    WHERE id = v_request.id
;



    v_processed_requests := v_processed_requests + 1
;


  END LOOP
;



  v_result := jsonb_build_object(
    'processed_requests', v_processed_requests,
    'moved_bookings', v_moved_bookings,
    'refunded_bookings', v_refunded_bookings
  )
;



  RETURN v_result
;


END
;


$$
;




