begin;
create table messaging_private.phone_events (
 id bigint generated always as identity primary key,
 user_id uuid references public.users(id) on delete set null,
 verification_id uuid,
 event_type text not null check(event_type in ('requested','invalid','expired','blocked','verified','number_changed','simulated')),
 created_at timestamptz not null default now()
);
alter table messaging_private.phone_events enable row level security;
revoke all on messaging_private.phone_events from public,anon,authenticated;
grant select,insert,delete on messaging_private.phone_events to service_role;
grant usage,select on sequence messaging_private.phone_events_id_seq to service_role;

create function messaging_private.recent_phone_auth(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=p_user and last_sign_in_at>now()-interval '10 minutes')
 or exists(select 1 from public.sensitive_verifications where user_id=p_user and expires_at>now());
$$;
create function public.guard_phone_number_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null and new.phone_number is distinct from old.phone_number
 and public.normalizar_telefono(new.phone_number) is distinct from public.normalizar_telefono(old.phone_number)
 and old.phone_number is not null and not messaging_private.recent_phone_auth(auth.uid()) then
   raise exception 'PHONE_REAUTH_REQUIRED: vuelve a iniciar sesion para cambiar el telefono' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.guard_phone_number_change() from public,anon,authenticated;
create trigger guard_phone_number_change before update of phone_number on public.users for each row execute function public.guard_phone_number_change();

create function public.issue_phone_challenge(p_user uuid,p_id uuid,p_phone text,p_hash text,p_user_hash text,p_phone_hash text,p_ip_hash text,p_simulated boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users; s public.platform_settings; c messaging_private.phone_verifications;
 day_start timestamptz:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 hour_start timestamptz:=date_trunc('hour',now());
begin
 select * into strict u from public.users where id=p_user for update;
 select * into strict s from public.platform_settings;
 if not coalesce(u.is_active,false) or not coalesce(u.email_verified,false) then return jsonb_build_object('ok',false,'code','EMAIL_OR_ACCOUNT_REQUIRED'); end if;
 if not s.sms_habilitado or p_simulated is distinct from s.sms_modo_prueba then return jsonb_build_object('ok',false,'code','SMS_UNAVAILABLE'); end if;
 if public.normalizar_telefono(u.phone_number) is distinct from p_phone and not messaging_private.recent_phone_auth(p_user) then return jsonb_build_object('ok',false,'code','PHONE_REAUTH_REQUIRED'); end if;
 select * into c from messaging_private.phone_verifications where user_id=p_user order by created_at desc limit 1;
 if c.created_at>now()-interval '60 seconds' then return jsonb_build_object('ok',false,'code','OTP_COOLDOWN'); end if;
 if exists(select 1 from messaging_private.rate_limit_buckets where scope='otp_failures' and subject_hash=p_user_hash and window_end>now() and used>=5) then return jsonb_build_object('ok',false,'code','OTP_LOCKED'); end if;
 begin
  if not public.consume_sms_rate_limit('otp_user',p_user_hash,day_start,day_start+interval '1 day',s.sms_otp_limite_usuario_diario) then raise exception 'limit' using errcode='P0002'; end if;
  if not public.consume_sms_rate_limit('otp_phone',p_phone_hash,day_start,day_start+interval '1 day',s.sms_otp_limite_telefono_diario) then raise exception 'limit' using errcode='P0002'; end if;
  if not public.consume_sms_rate_limit('otp_ip',p_ip_hash,hour_start,hour_start+interval '1 hour',s.sms_otp_limite_ip_hora) then raise exception 'limit' using errcode='P0002'; end if;
 exception when no_data_found then return jsonb_build_object('ok',false,'code','OTP_RATE_LIMIT'); end;
 if exists(select 1 from public.users where id<>p_user and phone_verified_e164=p_phone) then return jsonb_build_object('ok',false,'code','PHONE_UNAVAILABLE'); end if;
 update messaging_private.phone_verifications set status='invalidado' where user_id=p_user and status='pendiente';
 if u.phone_number is distinct from p_phone then
  update public.users set phone_number=p_phone where id=p_user;
  insert into messaging_private.phone_events(user_id,event_type) values(p_user,'number_changed');
 end if;
 insert into messaging_private.phone_verifications(id,user_id,phone_e164,code_hash,pepper_version,expires_at,is_simulated)
 values(p_id,p_user,p_phone,p_hash,1,now()+interval '10 minutes',p_simulated);
 insert into messaging_private.phone_events(user_id,verification_id,event_type) values(p_user,p_id,case when p_simulated then 'simulated' else 'requested' end);
 return jsonb_build_object('ok',true,'challenge_id',p_id,'expires_at',now()+interval '10 minutes','simulated',p_simulated);
end $$;
revoke all on function public.issue_phone_challenge(uuid,uuid,text,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.issue_phone_challenge(uuid,uuid,text,text,text,text,text,boolean) to service_role;

create function public.get_phone_challenge(p_user uuid,p_id uuid) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('phone',phone_e164,'pepper_version',pepper_version) from messaging_private.phone_verifications where id=p_id and user_id=p_user;
$$;
revoke all on function public.get_phone_challenge(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_phone_challenge(uuid,uuid) to service_role;

create function public.verify_phone_challenge(p_user uuid,p_id uuid,p_hash text,p_user_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u public.users; c messaging_private.phone_verifications; difference integer:=0; i integer; used_count integer;
 day_start timestamptz:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
begin
 select * into strict u from public.users where id=p_user for update;
 select * into c from messaging_private.phone_verifications where id=p_id and user_id=p_user for update;
 if not coalesce(u.is_active,false) or not coalesce(u.email_verified,false) or c.id is null or c.status<>'pendiente'
 or c.phone_e164 is distinct from public.normalizar_telefono(u.phone_number) then return jsonb_build_object('ok',false,'code','OTP_INVALID'); end if;
 if c.expires_at<=now() then
  update messaging_private.phone_verifications set status='vencido' where id=p_id;
  insert into messaging_private.phone_events(user_id,verification_id,event_type) values(p_user,p_id,'expired');
  return jsonb_build_object('ok',false,'code','OTP_EXPIRED');
 end if;
 if c.is_simulated then return jsonb_build_object('ok',false,'code','OTP_SIMULATION'); end if;
 if not exists(select 1 from messaging_private.notification_attempts where verification_id=p_id and not is_simulated and status in ('aceptado','enviado','entregado','resultado_desconocido')) then return jsonb_build_object('ok',false,'code','OTP_NOT_SENT'); end if;
 if c.attempts>=5 or exists(select 1 from messaging_private.rate_limit_buckets where scope='otp_failures' and subject_hash=p_user_hash and window_end>now() and used>=5) then
  update messaging_private.phone_verifications set status='bloqueado' where id=p_id;
  return jsonb_build_object('ok',false,'code','OTP_LOCKED');
 end if;
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'code','OTP_INVALID'); end if;
 -- Fixed-length comparison: no early exit when a byte differs.
 for i in 0..31 loop difference:=difference | (get_byte(decode(c.code_hash,'hex'),i) # get_byte(decode(p_hash,'hex'),i)); end loop;
 update messaging_private.phone_verifications set attempts=attempts+1 where id=p_id;
 if difference<>0 then
  perform public.consume_sms_rate_limit('otp_failures',p_user_hash,day_start,day_start+interval '1 day',5);
  update messaging_private.phone_verifications set status='bloqueado' where id=p_id and attempts>=5;
  insert into messaging_private.phone_events(user_id,verification_id,event_type) values(p_user,p_id,'invalid');
  return jsonb_build_object('ok',false,'code','OTP_INVALID');
 end if;
 begin
  update public.users set phone_verified_at=now(),phone_verified_e164=c.phone_e164 where id=p_user;
 exception when unique_violation then
  update messaging_private.phone_verifications set status='invalidado' where id=p_id;
  return jsonb_build_object('ok',false,'code','PHONE_UNAVAILABLE');
 end;
 update messaging_private.phone_verifications set status='verificado' where id=p_id;
 insert into messaging_private.phone_events(user_id,verification_id,event_type) values(p_user,p_id,'verified');
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.verify_phone_challenge(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.verify_phone_challenge(uuid,uuid,text,text) to service_role;

create function public.phone_operation_allowed(p_context text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare u public.users; s public.platform_settings; context text:=p_context;
begin
 if auth.uid() is null then return true; end if; -- Existing RLS still authenticates/authorizes anonymous callers.
 select * into strict s from public.platform_settings;
 if not s.phone_verification_required then return true; end if;
 select * into u from public.users where id=auth.uid();
 if u.id is null or not coalesce(u.is_active,false) then return false; end if;
 if context='account' then context:=case when u.role='agency' then 'agency' when u.role='traveler' then 'traveler' else 'administrative' end; end if;
 if context='agency' and u.role in ('admin','accountant','account_executive') and
   not exists(select 1 from public.agencies where user_id=u.id) and not exists(select 1 from public.agency_staff where user_id=u.id and is_active) then context:='administrative'; end if;
 if context='administrative' then return u.role in ('admin','accountant','account_executive'); end if;
 if context not in ('traveler','agency') then return false; end if;
 return u.phone_verified_at is not null or not (case context when 'traveler' then s.phone_verification_travelers_required else s.phone_verification_agencies_required end);
end $$;
revoke all on function public.phone_operation_allowed(text) from public,anon,authenticated;
grant execute on function public.phone_operation_allowed(text) to authenticated,service_role;

create function messaging_private.enforce_phone_operation(p_context text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.phone_operation_allowed(p_context) then raise exception 'PHONE_VERIFICATION_REQUIRED' using errcode='42501'; end if;
end $$;

-- Authorization guards on existing SECURITY DEFINER entry points. Preserve
-- signatures, bodies and existing financial/agency authorization rules.
do $$ declare r record; definition text; rewritten text; context text;
begin
 for r in select p.oid,p.proname from pg_proc p join pg_language l on l.oid=p.prolang where p.pronamespace='public'::regnamespace
 and l.lanname='plpgsql' and p.proname=any(array[
 'create_booking_atomic_with_preventa','activate_draft_booking','save_external_sale','cancel_external_sale','assign_external_seats',
 'checkin_external_sale','generate_external_sale_qr','prepare_external_sale_email','get_agency_operations','get_agency_financial_summary',
 'get_agency_penalty_summary','get_agency_staff_for_owner','agency_demand_summary','agency_demand_top','toggle_agency_seat_block',
 'search_user_by_email_for_staff','get_tour_manifest','get_tour_manifest_v2',
 'accept_staff_invitation','activate_featured_slot','auto_generate_slots_for_range','get_reschedule_summary_for_tour','get_tour_confirmed_attendees','update_tour_slug','validate_featured_slot_discount',
 'get_or_create_points_wallet','get_points_expiring_soon','get_remaining_service_fee_exemption','reserve_seats','get_user_conversations','create_conversation_with_participants','subscribe_destination_alert','update_referral_code']) loop
   context:=case when r.proname in ('create_booking_atomic_with_preventa','activate_draft_booking','reserve_seats','get_or_create_points_wallet','get_points_expiring_soon','get_remaining_service_fee_exemption') then 'traveler' when r.proname in ('get_user_conversations','create_conversation_with_participants','subscribe_destination_alert','update_referral_code') then 'account' else 'agency' end;
   definition:=pg_get_functiondef(r.oid);
   rewritten:=regexp_replace(definition,'(\mBEGIN\M)',E'\nBEGIN\n  PERFORM messaging_private.enforce_phone_operation('||quote_literal(context)||E');\n','i');
   if rewritten=definition then raise exception 'Cannot safely add phone guard to %',r.proname; end if;
   execute rewritten;
 end loop;
end $$;

-- Restrictive policies compose with all existing permissive ownership policies.
-- This SQL SECURITY DEFINER reader bypasses RLS, so it needs its own predicate.
do $$ declare d text; rewritten text;
begin
 select pg_get_functiondef('public.get_agency_staff_for_owner(uuid)'::regprocedure) into d;
 rewritten:=replace(d,'WHERE s.agency_id = p_agency_id', 'WHERE public.phone_operation_allowed(''agency'') AND s.agency_id = p_agency_id');
 if rewritten=d then raise exception 'Cannot safely guard staff reader'; end if;
 execute rewritten;
end $$;

-- Restrictive policies compose with all existing permissive ownership policies.
-- Public catalog remains readable; writes and private operations are gated.
do $$ declare t text; context text; private_read boolean;
begin
 foreach t in array array['bookings','booking_travelers','booking_optional_services','booking_supplements','booking_checkin_tokens',
 'booking_cancellations','booking_partial_cancellations','booking_payment_plans','booking_payment_plan_installments','booking_reschedule_responses',
 'toursred_cash_wallets','toursred_points_wallets','reviews','traveler_reviews','agency_reviews',
 'tours','tour_slots','external_sales','external_sale_travelers','external_sale_financials','external_sale_events',
 'agency_staff_invitations','agency_tour_messages','agency_tour_message_recipients','agency_payouts'] loop
  if to_regclass('public.'||t) is null then raise exception 'Missing protected table %',t; end if;
  context:=case when t in ('tours','tour_slots') or t like 'external_%' or (t like 'agency_%' and t<>'agency_reviews') then 'agency' else 'account' end;
  private_read:=t not in ('tours','tour_slots','reviews','traveler_reviews','agency_reviews');
  execute format('create policy phone_insert_gate on public.%I as restrictive for insert to authenticated with check (public.phone_operation_allowed(%L))',t,context);
  execute format('create policy phone_update_gate on public.%I as restrictive for update to authenticated using (public.phone_operation_allowed(%L)) with check (public.phone_operation_allowed(%L))',t,context,context);
  execute format('create policy phone_delete_gate on public.%I as restrictive for delete to authenticated using (public.phone_operation_allowed(%L))',t,context);
  if private_read then execute format('create policy phone_select_gate on public.%I as restrictive for select to authenticated using (public.phone_operation_allowed(%L))',t,context); end if;
 end loop;
end $$;
revoke all on all functions in schema messaging_private from public,anon,authenticated;
-- Existing SECURITY DEFINER functions retain their original postgres owner.
-- Grant only the policy entry points, never private messaging table access.
grant usage on schema messaging_private to postgres;
grant execute on function messaging_private.enforce_phone_operation(text) to postgres;
grant execute on function public.phone_operation_allowed(text) to postgres;
-- Intentionally no runtime capability or global activation. Certification is
-- a separate deployment step after the entire backend/frontend matrix passes.
commit;
