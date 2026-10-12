-- queue-booking-reminders respondia 503 en CADA corrida (cada 15 min) desde el
-- backfill de destinations.time_zone (20261009163001). Causa medida contra la
-- base el 12-oct-2026, no inferida:
--
-- 1. Validar la zona con `exists(select 1 from pg_timezone_names where name=tz)`
--    cuesta ~55-62 ms por llamada: esa vista lee la base tz del disco y no tiene
--    indice. Mientras time_zone era NULL, el OR de booking_sms_snapshot() y el
--    `p_zone is null` de reminder_window() cortaban antes de llegar a ella; con
--    zonas reales se evalua siempre.
-- 2. queue_booking_sms_batch() llamaba a booking_sms_snapshot() unas 4 veces por
--    reserva confirmada (el lateral se aplana y cada `snap.data->>` se vuelve su
--    propia llamada, mas la del not exists) y ANTES de aplicar el filtro de fechas.
--    Con 39 reservas confirmadas y 0 en la ventana: 8.3 s en el bloque de
--    recordatorios + 2.1 s en la alerta missing_schedule. El statement_timeout de
--    authenticator (8 s) lo cancelaba siempre y la funcion devolvia 503; el costo
--    crece con TODAS las reservas confirmadas de la historia, no con las del dia.
--
-- Arreglo: validar la zona con `at time zone` dentro de un bloque exception
-- (~0.016 ms) y calcular el snapshot una vez por reserva, solo para las que caen
-- en la ventana (CTE materialized). La logica de negocio no cambia.
begin;

-- `at time zone` acepta tambien abreviaturas ('CST') y cadenas POSIX ('UTC+5'),
-- que pg_timezone_names no lista y que no siguen el horario de verano. El
-- regex deja pasar solo nombres IANA Area/Lugar (y UTC). Comparado contra la
-- version anterior el 12-oct-2026: mismo resultado en las 60 reservas de la
-- base y en las 0 zonas Area/Lugar de pg_timezone_names que ahora se
-- rechazarian. Diferencias a proposito: los alias heredados sin '/' ('Japan',
-- 'EST5EDT') ya no pasan, y 'america/mexico_city' en minusculas si (Postgres
-- la resuelve igual). Ningun destino usa ninguno de los tres.
create function messaging_private.is_valid_time_zone(p_zone text) returns boolean
language plpgsql stable set search_path='' as $$
begin
 if p_zone is null or not (p_zone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$' or p_zone='UTC') then return false; end if;
 perform now() at time zone p_zone;
 return true;
exception when invalid_parameter_value then return false;
end $$;
revoke all on function messaging_private.is_valid_time_zone(text) from public,anon,authenticated;

create or replace function messaging_private.booking_sms_snapshot(p_booking uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b public.bookings; t public.tours; sl public.tour_slots; tz text; point_name text; departure_time time; departure_date date; departure_at timestamptz; zones integer;
begin
 select * into b from public.bookings where id=p_booking;
 if b.id is null then return jsonb_build_object('eligible',false,'reason','missing_booking'); end if;
 select * into t from public.tours where id=b.tour_id;
 if b.status<>'confirmed' or b.payment_status<>'succeeded' or b.cancelled_at is not null or coalesce(t.cancelled_by_agency,false)
 or coalesce(b.has_pending_reschedule,false) or coalesce(b.has_pending_slot_reschedule,false) then
  return jsonb_build_object('eligible',false,'reason','booking_not_confirmed'); end if;
 select count(distinct d.time_zone),min(d.time_zone) into zones,tz from public.tour_destinations td join public.destinations d on d.id=td.destination_id where td.tour_id=t.id;
 if zones<>1 or exists(select 1 from public.tour_destinations td join public.destinations d on d.id=td.destination_id where td.tour_id=t.id and d.time_zone is null)
 or not messaging_private.is_valid_time_zone(tz) then tz:=null; end if;
 if b.slot_id is not null then
  select * into sl from public.tour_slots where id=b.slot_id and tour_id=b.tour_id;
  if sl.id is null or sl.status::text in ('cancelado','completado') then return jsonb_build_object('eligible',false,'reason','slot_unavailable'); end if;
  departure_date:=sl.slot_date; departure_time:=sl.departure_time;
  select dp.name into point_name from public.tour_schedules s join public.departure_points dp on dp.id=s.departure_point_id where s.id=sl.schedule_id;
 else
  departure_date:=coalesce(b.selected_date,t.start_date,b.booking_date); departure_time:=b.selected_time;
  if (select count(*) from public.tour_departure_points where tour_id=t.id)=1 then
   select coalesce(b.selected_time,tdp.departure_time),dp.name into departure_time,point_name from public.tour_departure_points tdp join public.departure_points dp on dp.id=tdp.departure_point_id where tdp.tour_id=t.id;
  end if;
 end if;
 if b.pickup_type='pickup' then point_name:=null; end if; -- Don't invent a hotel/address from a zone name.
 if tz is not null and departure_time is not null and departure_date is not null then departure_at:=(departure_date+departure_time) at time zone tz; end if;
 return jsonb_build_object('eligible',true,'user_id',b.user_id,'folio',b.booking_code,'tour',t.name,'meeting_point',coalesce(point_name,'consulta tu reserva'),
  'departure_date',departure_date,'departure_time',departure_time,'departure_at',departure_at,'time_zone',tz);
end $$;

create or replace function messaging_private.reminder_window(p_day date,p_time time,p_zone text,p_hour integer,p_now timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare due timestamptz; expiry timestamptz; departure timestamptz;
begin
 if p_day is null or p_time is null or p_zone is null or p_hour not between 8 and 20 or not messaging_private.is_valid_time_zone(p_zone) then return jsonb_build_object('allowed',false); end if;
 departure:=(p_day+p_time) at time zone p_zone;
 due:=((p_day-1)+make_time(p_hour,0,0)) at time zone p_zone;
 expiry:=least(due+interval '2 hours',((p_day-1)+time '21:00') at time zone p_zone,departure);
 return jsonb_build_object('allowed',p_now>=due and p_now<expiry,'due',due,'expiry',expiry,'departure',departure);
end $$;

-- El filtro de fechas va en un CTE materialized para que el planificador no
-- pueda evaluar el snapshot antes que el, y el snapshot se calcula una sola vez
-- por reserva. Los joins (left en recordatorios, inner con tours en la alerta)
-- se conservan tal cual estaban.
create or replace function public.queue_booking_sms_batch() returns jsonb
language plpgsql security definer set search_path='' as $$
declare b record; confirmations integer:=0; reminders integer:=0; since timestamptz; reminder_hour integer;
begin
 if not exists(select 1 from public.platform_settings where sms_habilitado) then return jsonb_build_object('disabled',true); end if;
 if not pg_try_advisory_xact_lock(hashtextextended('toursred:sms-scheduler',0)) then return jsonb_build_object('busy',true); end if;
 select sms_enabled_since into since from messaging_private.runtime_capabilities;
 select sms_hora_recordatorio_local into reminder_hour from public.platform_settings;
 for b in select id from public.bookings bk where status='confirmed' and payment_status='succeeded' and updated_at>=greatest(now()-interval '1 hour',coalesce(since,now()))
 and not exists(select 1 from messaging_private.notification_outbox where idempotency_key='reserva_confirmada:'||bk.id) order by updated_at,id limit 1000 loop
  if public.queue_booking_sms(b.id,'reserva_confirmada') is not null then confirmations:=confirmations+1; end if;
 end loop;
 for b in with c as materialized (
  select bk.id from public.bookings bk left join public.tour_slots sl on sl.id=bk.slot_id left join public.tours t on t.id=bk.tour_id
  where bk.status='confirmed' and bk.payment_status='succeeded' and coalesce(sl.slot_date,bk.selected_date,t.start_date,bk.booking_date) between current_date-1 and current_date+3
 ), s as materialized (select c.id, messaging_private.booking_sms_snapshot(c.id) as data from c)
 select s.id from s
 where coalesce((messaging_private.reminder_window((s.data->>'departure_date')::date,(s.data->>'departure_time')::time,s.data->>'time_zone',reminder_hour,now())->>'allowed')::boolean,false)
 and not exists(select 1 from messaging_private.notification_outbox o where o.booking_id=s.id and o.category='recordatorio_tour' and o.departure_snapshot is not distinct from (s.data->>'departure_at')::timestamptz)
 order by s.id limit 1000 loop
  if public.queue_booking_sms(b.id,'recordatorio_tour') is not null then reminders:=reminders+1; end if;
 end loop;
 perform messaging_private.alert('missing_schedule',exists(
  with c as materialized (
   select bk.id from public.bookings bk join public.tours t on t.id=bk.tour_id left join public.tour_slots sl on sl.id=bk.slot_id
   where bk.status='confirmed' and bk.payment_status='succeeded' and coalesce(sl.slot_date,bk.selected_date,t.start_date,bk.booking_date) between current_date-1 and current_date+3
  ) select 1 from c where (messaging_private.booking_sms_snapshot(c.id)->>'departure_at') is null));
 return jsonb_build_object('confirmation_candidates',confirmations,'reminder_candidates',reminders);
end $$;

commit;
