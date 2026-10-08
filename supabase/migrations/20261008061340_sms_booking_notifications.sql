-- Fase 4: notifications only. No provider calls or cron activation in migration.
begin;
-- Booking ownership determines traveler versus agency context, not the
-- collaborator's stored role. Existing ownership RLS still authorizes access.
create function public.phone_booking_operation_allowed(p_booking uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.phone_operation_allowed(case when b.user_id=auth.uid() then 'traveler' else 'agency' end) from public.bookings b where b.id=p_booking;
$$;
revoke all on function public.phone_booking_operation_allowed(uuid) from public,anon,authenticated;
grant execute on function public.phone_booking_operation_allowed(uuid) to authenticated,service_role,postgres;
do $$ declare t text; expression text; pol text;
begin
 foreach t in array array['bookings','booking_travelers','booking_optional_services','booking_supplements','booking_checkin_tokens','booking_cancellations','booking_partial_cancellations','booking_payment_plans','booking_payment_plan_installments','booking_reschedule_responses'] loop
  expression:=case when t='bookings' then 'public.phone_operation_allowed(case when user_id=auth.uid() then ''traveler'' else ''agency'' end)' else 'public.phone_booking_operation_allowed(booking_id)' end;
  execute format('alter policy phone_select_gate on public.%I using (%s)',t,expression);
  execute format('alter policy phone_insert_gate on public.%I with check (%s)',t,expression);
  execute format('alter policy phone_update_gate on public.%I using (%s) with check (%s)',t,expression,expression);
  execute format('alter policy phone_delete_gate on public.%I using (%s)',t,expression);
 end loop;
end $$;
alter table messaging_private.notification_outbox add column departure_snapshot timestamptz;
alter table messaging_private.notification_attempts add column country_code text check(country_code ~ '^[A-Z]{2}$');
alter table messaging_private.notification_attempts add column category text check(category in ('otp','reserva_confirmada','recordatorio_tour'));
update messaging_private.notification_attempts a set category=case when verification_id is not null then 'otp' else (select category from messaging_private.notification_outbox o where o.id=a.outbox_id) end;
alter table messaging_private.notification_attempts alter column category set not null;
-- Purging challenge hashes after 24h must not erase monthly delivery metrics.
alter table messaging_private.notification_attempts drop constraint notification_attempts_verification_id_fkey;
alter table messaging_private.notification_attempts add foreign key(verification_id) references messaging_private.phone_verifications(id) on delete set null;
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='messaging_private.notification_attempts'::regclass and pg_get_constraintdef(oid) like '%num_nonnulls%' loop
  execute format('alter table messaging_private.notification_attempts drop constraint %I',c.conname);
 end loop;
end $$;
alter table messaging_private.notification_attempts add constraint notification_attempts_parent check(num_nonnulls(outbox_id,verification_id)=1 or (category='otp' and num_nonnulls(outbox_id,verification_id)=0));
create function messaging_private.attempt_category() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 new.category:=case when new.verification_id is not null then 'otp' else (select category from messaging_private.notification_outbox where id=new.outbox_id) end;
 return new;
end $$;
create trigger attempt_category before insert on messaging_private.notification_attempts for each row execute function messaging_private.attempt_category();
alter table messaging_private.runtime_capabilities add column sms_enabled_since timestamptz;

create table messaging_private.notification_alerts (
 code text primary key check(code in ('queue_error','missing_schedule','low_balance','provider_unavailable','repeated_errors','unknown_results','consumption_high','otp_abuse','worker_stale')),
 active boolean not null default true,
 first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 occurrences bigint not null default 1
);
create table messaging_private.provider_health (
 provider text primary key references messaging_private.provider_capabilities(provider),
 balance_credits numeric check(balance_credits>=0),
 checked_at timestamptz not null default now(),
 balance_checked_at timestamptz,
 last_worker_at timestamptz
);
alter table messaging_private.notification_alerts enable row level security;
alter table messaging_private.provider_health enable row level security;
revoke all on messaging_private.notification_alerts,messaging_private.provider_health from public,anon,authenticated;
grant select,insert,update,delete on messaging_private.notification_alerts,messaging_private.provider_health to service_role;

create function messaging_private.alert(p_code text,p_active boolean default true) returns void
language sql security definer set search_path='' as $$
 insert into messaging_private.notification_alerts(code,active) values(p_code,p_active)
 on conflict(code) do update set active=excluded.active,last_seen_at=now(),occurrences=messaging_private.notification_alerts.occurrences+case when excluded.active then 1 else 0 end;
$$;
create function messaging_private.track_sms_activation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.sms_habilitado and not old.sms_habilitado then update messaging_private.runtime_capabilities set sms_enabled_since=now(); end if;
 return new;
end $$;
create trigger track_sms_activation after update of sms_habilitado on public.platform_settings for each row execute function messaging_private.track_sms_activation();

-- One unambiguous IANA destination zone. Never assume Mexico City for NULL.
-- Point/time: slot -> schedule -> departure point; otherwise a unique tour
-- departure point. A multi-pickup tour without a selected time is ambiguous.
create function messaging_private.booking_sms_snapshot(p_booking uuid) returns jsonb
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
 or not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) then tz:=null; end if;
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

create function messaging_private.reminder_window(p_day date,p_time time,p_zone text,p_hour integer,p_now timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare due timestamptz; expiry timestamptz; departure timestamptz;
begin
 if p_day is null or p_time is null or p_zone is null or p_hour not between 8 and 20 or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_zone) then return jsonb_build_object('allowed',false); end if;
 departure:=(p_day+p_time) at time zone p_zone;
 due:=((p_day-1)+make_time(p_hour,0,0)) at time zone p_zone;
 expiry:=least(due+interval '2 hours',((p_day-1)+time '21:00') at time zone p_zone,departure);
 return jsonb_build_object('allowed',p_now>=due and p_now<expiry,'due',due,'expiry',expiry,'departure',departure);
end $$;

create function public.queue_booking_sms(p_booking uuid,p_category text default 'reserva_confirmada') returns uuid
language plpgsql security definer set search_path='' as $$
declare snap jsonb; timing jsonb; u public.users; s public.platform_settings; departure timestamptz; message_id uuid; key text; expiry timestamptz;
begin
 select * into strict s from public.platform_settings;
 if not s.sms_habilitado then return null; end if;
 if p_category not in ('reserva_confirmada','recordatorio_tour') or p_category is null then raise exception 'Categoria invalida'; end if;
 snap:=messaging_private.booking_sms_snapshot(p_booking);
 if not (snap->>'eligible')::boolean then return null; end if;
 select * into u from public.users where id=(snap->>'user_id')::uuid;
 if not coalesce(u.is_active,false) or u.phone_verified_at is null or u.phone_verified_e164 is null then return null; end if;
 if exists(select 1 from messaging_private.notification_preferences where user_id=u.id and application='toursred' and channel='sms' and not transactional_enabled) then return null; end if;
 departure:=(snap->>'departure_at')::timestamptz;
 if departure<=now() or (snap->>'departure_date')::date<current_date then return null; end if;
 if p_category='recordatorio_tour' then
  if departure is null then perform messaging_private.alert('missing_schedule'); return null; end if;
  timing:=messaging_private.reminder_window((snap->>'departure_date')::date,(snap->>'departure_time')::time,snap->>'time_zone',s.sms_hora_recordatorio_local,now());
  if not coalesce((timing->>'allowed')::boolean,false) then return null; end if;
  key:='recordatorio_tour:'||p_booking||':'||to_char(departure at time zone 'UTC','YYYYMMDDHH24MISS');
  expiry:=(timing->>'expiry')::timestamptz;
 else
  key:='reserva_confirmada:'||p_booking; expiry:=least(now()+interval '1 hour',coalesce(departure,now()+interval '1 hour'));
 end if;
 -- ZZ is explicitly unknown until libphonenumber resolves it before transport.
 message_id:=public.enqueue_sms_notification(u.id,p_booking,u.phone_verified_e164,'ZZ',p_category,key,now(),expiry);
 update messaging_private.notification_outbox set departure_snapshot=departure where id=message_id and status='pendiente';
 return message_id;
end $$;
revoke all on function public.queue_booking_sms(uuid,text) from public,anon,authenticated;
grant execute on function public.queue_booking_sms(uuid,text) to service_role;

create function messaging_private.booking_sms_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='confirmed' and new.payment_status='succeeded' then
  perform public.queue_booking_sms(new.id,'reserva_confirmada');
 elsif new.status<>'confirmed' then
  update messaging_private.notification_outbox set status='cancelado',updated_at=now() where booking_id=new.id and status='pendiente';
 end if;
 return new;
exception when others then
 -- A notification failure must never undo payment, booking or email. The
 -- periodic reconciler repairs recent events. Log a code, not payment/PII.
 begin perform messaging_private.alert('queue_error'); exception when others then null; end;
 return new;
end $$;
create trigger booking_sms_event after insert or update of status,payment_status on public.bookings for each row execute function messaging_private.booking_sms_event();

create function public.queue_booking_sms_batch() returns jsonb
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
 for b in select bk.id from public.bookings bk left join public.tour_slots sl on sl.id=bk.slot_id left join public.tours t on t.id=bk.tour_id
 cross join lateral (select messaging_private.booking_sms_snapshot(bk.id) as data) snap
 where bk.status='confirmed' and bk.payment_status='succeeded' and coalesce(sl.slot_date,bk.selected_date,t.start_date,bk.booking_date) between current_date-1 and current_date+3
 and coalesce((messaging_private.reminder_window((snap.data->>'departure_date')::date,(snap.data->>'departure_time')::time,snap.data->>'time_zone',reminder_hour,now())->>'allowed')::boolean,false)
 and not exists(select 1 from messaging_private.notification_outbox o where o.booking_id=bk.id and o.category='recordatorio_tour' and o.departure_snapshot is not distinct from (messaging_private.booking_sms_snapshot(bk.id)->>'departure_at')::timestamptz)
 order by bk.id limit 1000 loop
  if public.queue_booking_sms(b.id,'recordatorio_tour') is not null then reminders:=reminders+1; end if;
 end loop;
 perform messaging_private.alert('missing_schedule',exists(select 1 from public.bookings bk join public.tours t on t.id=bk.tour_id left join public.tour_slots sl on sl.id=bk.slot_id where bk.status='confirmed' and bk.payment_status='succeeded' and coalesce(sl.slot_date,bk.selected_date,t.start_date,bk.booking_date) between current_date-1 and current_date+3 and (messaging_private.booking_sms_snapshot(bk.id)->>'departure_at') is null));
 return jsonb_build_object('confirmation_candidates',confirmations,'reminder_candidates',reminders);
end $$;
revoke all on function public.queue_booking_sms_batch() from public,anon,authenticated;
grant execute on function public.queue_booking_sms_batch() to service_role;

create function public.prepare_sms_notification(p_id uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o messaging_private.notification_outbox; snap jsonb; u public.users;
begin
 select * into o from messaging_private.notification_outbox where id=p_id for update;
 if o.id is null or o.status<>'procesando' or o.lease_token is distinct from p_lease or o.lease_until<=now() or o.expires_at<=now() then return jsonb_build_object('allowed',false); end if;
 snap:=messaging_private.booking_sms_snapshot(o.booking_id);
 if not coalesce((snap->>'eligible')::boolean,false) then return jsonb_build_object('allowed',false); end if;
 select * into u from public.users where id=o.user_id;
 if not coalesce(u.is_active,false) or u.phone_verified_at is null or u.phone_verified_e164 is distinct from o.destination_e164
 or exists(select 1 from messaging_private.notification_preferences where user_id=u.id and channel='sms' and application='toursred' and not transactional_enabled)
 then return jsonb_build_object('allowed',false); end if;
 if (snap->>'departure_at')::timestamptz<=now() or (snap->>'departure_date')::date<current_date then return jsonb_build_object('allowed',false); end if;
 if o.category='recordatorio_tour' and (o.departure_snapshot is null or o.departure_snapshot is distinct from (snap->>'departure_at')::timestamptz
 or extract(hour from now() at time zone (snap->>'time_zone')) not between 8 and 20) then return jsonb_build_object('allowed',false); end if;
 return snap||jsonb_build_object('allowed',true,'destination',o.destination_e164);
end $$;
revoke all on function public.prepare_sms_notification(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_sms_notification(uuid,uuid) to service_role;

-- Revalidate once more when reserving the attempt, including a fallback attempt.
do $$ declare d text; rewritten text; marker text:='  select * into previous from messaging_private.notification_attempts where';
begin
 select pg_get_functiondef('public.begin_sms_attempt(uuid,uuid,uuid,text,text,text,integer)'::regprocedure) into d;
 rewritten:=replace(d,marker,E'  if p_outbox is not null and o.booking_id is not null and not coalesce((public.prepare_sms_notification(p_outbox,p_lease)->>''allowed'')::boolean,false) then return jsonb_build_object(''allowed'',false,''code'',''reserva_no_vigente''); end if;\n'||marker);
 if rewritten=d then raise exception 'Cannot safely add dispatch revalidation'; end if;
 execute rewritten;
 select pg_get_functiondef('public.finish_sms_notification(uuid,uuid,text)'::regprocedure) into d;
 rewritten:=replace(d,'if p_state=''cancelado'' and a.id is null then','if p_state in (''cancelado'',''fallido'') and a.id is null then');
 rewritten:=replace(rewritten,'set status=''cancelado'',lease_token=null','set status=p_state,lease_token=null');
 if rewritten=d then raise exception 'Cannot safely classify unsent job'; end if;
 execute rewritten;
end $$;

create function public.record_sms_country(p_outbox uuid,p_attempt uuid,p_country text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_country is null or p_country !~ '^[A-Z]{2}$' then raise exception 'Pais invalido'; end if;
 if p_outbox is not null then update messaging_private.notification_outbox set country_code=p_country where id=p_outbox; end if;
 if p_attempt is not null then update messaging_private.notification_attempts set country_code=p_country where id=p_attempt; end if;
end $$;
revoke all on function public.record_sms_country(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.record_sms_country(uuid,uuid,text) to service_role;

create function public.get_my_sms_preferences() returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select transactional_enabled from messaging_private.notification_preferences where user_id=auth.uid() and application='toursred' and channel='sms'),true) where auth.uid() is not null;
$$;
create function public.set_my_sms_preferences(p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or p_enabled is null then raise exception 'Sesion requerida'; end if;
 insert into messaging_private.notification_preferences(user_id,transactional_enabled) values(auth.uid(),p_enabled)
 on conflict(user_id,application,channel) do update set transactional_enabled=excluded.transactional_enabled,updated_at=now();
end $$;
revoke all on function public.get_my_sms_preferences(),public.set_my_sms_preferences(boolean) from public,anon,authenticated;
grant execute on function public.get_my_sms_preferences(),public.set_my_sms_preferences(boolean) to authenticated;

create function public.record_sms_health(p_credits numeric default null,p_balance_ok boolean default false,p_worker boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare s public.platform_settings; failures integer; unknowns integer; consumed bigint;
begin
 select * into strict s from public.platform_settings;
 insert into messaging_private.provider_health(provider,balance_credits,balance_checked_at,last_worker_at)
 values('labsmobile',case when p_balance_ok then p_credits end,case when p_balance_ok then now() end,case when p_worker then now() end)
 on conflict(provider) do update set checked_at=now(),balance_credits=case when p_balance_ok then excluded.balance_credits else messaging_private.provider_health.balance_credits end,
 balance_checked_at=coalesce(excluded.balance_checked_at,messaging_private.provider_health.balance_checked_at),last_worker_at=coalesce(excluded.last_worker_at,messaging_private.provider_health.last_worker_at);
 if not p_worker then
  perform messaging_private.alert('provider_unavailable',not p_balance_ok);
  if p_balance_ok then perform messaging_private.alert('low_balance',p_credits<s.sms_umbral_saldo_creditos); end if;
 end if;
 select count(*) filter(where status='fallido'),count(*) filter(where status='resultado_desconocido') into failures,unknowns from messaging_private.notification_attempts where created_at>now()-interval '1 hour' and not is_simulated;
 perform messaging_private.alert('repeated_errors',failures>=5); perform messaging_private.alert('unknown_results',unknowns>0);
 select coalesce(sum(used),0) into consumed from messaging_private.rate_limit_buckets where scope='sms_daily' and window_end>now();
 perform messaging_private.alert('consumption_high',consumed>=s.sms_limite_diario*0.8);
 perform messaging_private.alert('otp_abuse',exists(select 1 from messaging_private.rate_limit_buckets where scope='otp_ip' and window_end>now() and used>=s.sms_otp_limite_ip_hora));
 perform messaging_private.alert('worker_stale',s.sms_habilitado and not exists(select 1 from messaging_private.provider_health where last_worker_at>now()-interval '5 minutes'));
end $$;
revoke all on function public.record_sms_health(numeric,boolean,boolean) from public,anon,authenticated;
grant execute on function public.record_sms_health(numeric,boolean,boolean) to service_role;

create function public.get_sms_metrics() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform messaging_private.require_settings_admin();
 return jsonb_build_object(
 'period','ultimos_30_dias',
 'messages',(select coalesce(jsonb_agg(x),'[]') from (select category,status,country_code,count(*) as total from messaging_private.notification_outbox where created_at>now()-interval '30 days' group by category,status,country_code) x),
 'attempts',(select coalesce(jsonb_agg(x),'[]') from (select category,provider,status,is_simulated,coalesce(country_code,'ZZ') as country_code,count(*) as total,sum(segments) as segments,count(*) filter(where routing_reason='fallback_confirmado') as fallback,count(*) filter(where attempt_number>1) as retries,sum(cost) as known_cost,min(cost_unit) as cost_unit from messaging_private.notification_attempts where created_at>now()-interval '30 days' group by category,provider,status,is_simulated,country_code,cost_unit) x),
 'otp',(select jsonb_build_object('requested',count(*) filter(where event_type='requested'),'verified',count(*) filter(where event_type='verified'),'simulated',count(*) filter(where event_type='simulated'),'invalid',count(*) filter(where event_type='invalid')) from messaging_private.phone_events where created_at>now()-interval '30 days'),
 'consumption',(select coalesce(jsonb_agg(x),'[]') from (select scope,window_start,sum(used) as segments from messaging_private.rate_limit_buckets where scope in ('sms_daily','sms_monthly') and window_end>now() group by scope,window_start) x),
 'health',(select coalesce(jsonb_agg(to_jsonb(h)),'[]') from messaging_private.provider_health h),
 'alerts',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from messaging_private.notification_alerts a where active));
end $$;
revoke all on function public.get_sms_metrics() from public,anon,authenticated;
grant execute on function public.get_sms_metrics() to authenticated;

-- Deployment certification is service-only, separate from business switches.
-- Called only by a deployed health handler with explicit certification secrets.
create function public.certify_sms_runtime(p_processor boolean,p_otp boolean) returns void
language sql security definer set search_path='' as $$
 update messaging_private.runtime_capabilities set processor_ready=p_processor,otp_enforcement_ready=p_otp;
$$;
revoke all on function public.certify_sms_runtime(boolean,boolean) from public,anon,authenticated;
grant execute on function public.certify_sms_runtime(boolean,boolean) to service_role;

create or replace function public.purge_sms_private_data() returns void
language plpgsql security definer set search_path='' as $$
begin
 update messaging_private.phone_verifications set status='vencido' where status='pendiente' and expires_at<now();
 delete from messaging_private.phone_verifications where status<>'pendiente' and expires_at<now()-interval '24 hours';
 -- Accepted/unknown messages also have a bounded lifetime. Keep idempotency.
 delete from messaging_private.notification_attempts where updated_at<now()-interval '90 days';
 update messaging_private.notification_outbox set destination_e164=null,user_id=null,booking_id=null where updated_at<now()-interval '90 days';
 delete from messaging_private.phone_events where created_at<now()-interval '90 days';
 delete from messaging_private.rate_limit_buckets where window_end<now()-interval '32 days';
end $$;

-- This function installs/removes cron jobs ONLY when explicitly invoked after
-- authorized deployment. Migration itself does not schedule any HTTP request.
create function public.configure_sms_jobs(p_base_url text,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
declare job text; endpoint text; schedule text; command text;
begin
 if p_base_url is null or p_base_url !~ '^https://[a-z0-9]{20}\.supabase\.co$' then raise exception 'URL de proyecto invalida'; end if;
 if not exists(select 1 from pg_extension where extname='pg_cron') then raise exception 'pg_cron no instalado'; end if;
 foreach job in array array['sms-outbox','sms-scheduler','sms-health','sms-retention'] loop
  if exists(select 1 from cron.job where jobname=job) then perform cron.unschedule(job); end if;
  if p_enabled then
   if job='sms-retention' then perform cron.schedule(job,'25 4 * * *','select public.purge_sms_private_data()');
   else
    endpoint:=case job when 'sms-outbox' then 'process-notification-outbox' when 'sms-scheduler' then 'queue-booking-reminders' else 'monitor-sms-health' end;
    schedule:=case job when 'sms-outbox' then '* * * * *' when 'sms-scheduler' then '*/15 * * * *' else '5 * * * *' end;
    command:=format('select net.http_post(url := %L, headers := jsonb_build_object(''Content-Type'',''application/json'',''apikey'',(select decrypted_secret from vault.decrypted_secrets where name=''service_role_key'')), body := ''{}''::jsonb)',p_base_url||'/functions/v1/'||endpoint);
    perform cron.schedule(job,schedule,command);
   end if;
  end if;
 end loop;
end $$;
revoke all on function public.configure_sms_jobs(text,boolean) from public,anon,authenticated;
grant execute on function public.configure_sms_jobs(text,boolean) to service_role;
revoke all on all functions in schema messaging_private from public,anon,authenticated;
commit;
