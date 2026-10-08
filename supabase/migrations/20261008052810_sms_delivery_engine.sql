begin;
alter table messaging_private.rate_limit_buckets drop constraint rate_limit_buckets_scope_check;
alter table messaging_private.rate_limit_buckets add constraint rate_limit_buckets_scope_check
  check(scope in ('otp_user','otp_phone','otp_ip','otp_failures','sms_daily','sms_monthly','provider_second'));
alter table messaging_private.notification_attempts add column lease_token uuid;
alter table messaging_private.notification_attempts add column is_simulated boolean not null default false;

create function public.get_sms_runtime() returns jsonb
language sql security definer set search_path='' as $$
  select jsonb_build_object('settings',messaging_private.settings_json(s),
    'platform_url',s.platform_url,'processor_ready',r.processor_ready,'otp_ready',r.otp_enforcement_ready,
    'providers',(select jsonb_agg(to_jsonb(p)||jsonb_build_object('available',p.adapter_ready and coalesce(p.configured_until>now(),false))) from messaging_private.provider_capabilities p))
  from public.platform_settings s cross join messaging_private.runtime_capabilities r;
$$;
revoke all on function public.get_sms_runtime() from public,anon,authenticated;
grant execute on function public.get_sms_runtime() to service_role;

-- Cada intento reserva consumo antes de salir a la red. No guarda el mensaje.
create function public.begin_sms_attempt(p_outbox uuid,p_verification uuid,p_lease uuid,p_provider text,p_correlation text,p_reason text,p_segments integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.platform_settings; o messaging_private.notification_outbox; c messaging_private.phone_verifications;
  a messaging_private.notification_attempts; n integer; previous messaging_private.notification_attempts;
  fingerprint text:=encode(extensions.digest('global-sms','sha256'),'hex');
begin
  if num_nonnulls(p_outbox,p_verification)<>1 or p_segments is null or p_segments not between 1 and 3 then raise exception 'Intento invalido'; end if;
  -- Share-lock settings prevents an admin change crossing budget reservation.
  select * into strict s from public.platform_settings for share;
  if not s.sms_habilitado or not (select processor_ready from messaging_private.runtime_capabilities) then return jsonb_build_object('allowed',false,'code','sms_deshabilitado'); end if;
  if not exists(select 1 from messaging_private.provider_capabilities where provider=p_provider and adapter_ready and configured_until>now()
    and case when p_verification is not null then supports_otp else supports_transactional end) or (p_provider='mock' and not s.sms_modo_prueba) then return jsonb_build_object('allowed',false,'code','proveedor_no_disponible'); end if;
  if p_outbox is not null then
    select * into strict o from messaging_private.notification_outbox where id=p_outbox for update;
    if o.status<>'procesando' or o.lease_token is distinct from p_lease or o.lease_until<=now() or o.expires_at<=now() then return jsonb_build_object('allowed',false,'code','lease_invalido'); end if;
  else
    select * into strict c from messaging_private.phone_verifications where id=p_verification for update;
    if c.status<>'pendiente' or c.expires_at<=now() or c.is_simulated is distinct from s.sms_modo_prueba then return jsonb_build_object('allowed',false,'code','desafio_invalido'); end if;
  end if;
  select * into previous from messaging_private.notification_attempts where
    (p_outbox is not null and outbox_id=p_outbox) or (p_verification is not null and verification_id=p_verification)
    order by attempt_number desc limit 1;
  n:=coalesce(previous.attempt_number,0)+1;
  if p_reason='principal' then
    if (n<>1 and (p_verification is not null or n>4 or previous.status<>'fallido' or previous.failure_class is distinct from 'rechazo_confirmado' or previous.lease_token is not distinct from p_lease)) or p_provider<>(case when p_verification is not null then s.sms_proveedor_otp
      when o.category='recordatorio_tour' then s.sms_proveedor_recordatorios else s.sms_proveedor_transaccional end) then
      return jsonb_build_object('allowed',false,'code','intento_duplicado'); end if;
  elsif p_reason='fallback_confirmado' then
    if not s.sms_fallback_habilitado or p_provider is distinct from s.sms_proveedor_respaldo or n>4 or previous.routing_reason is distinct from 'principal' or previous.lease_token is distinct from p_lease or previous.status<>'fallido'
      or previous.failure_class is distinct from 'rechazo_confirmado' or p_provider=previous.provider then
      return jsonb_build_object('allowed',false,'code','fallback_prohibido'); end if;
  else raise exception 'Enrutamiento invalido'; end if;
  -- Subtransacción: un límite rechazado revierte todas las reservas de cuota.
  begin
    if not public.consume_sms_rate_limit('provider_second',encode(extensions.digest(p_provider,'sha256'),'hex'),date_trunc('second',now()),date_trunc('second',now())+interval '1 second',5) then raise exception 'limite' using errcode='P0002'; end if;
    if not s.sms_modo_prueba then
      if not public.consume_sms_rate_limit('sms_daily',fingerprint,date_trunc('day',now() at time zone 'UTC') at time zone 'UTC',(date_trunc('day',now() at time zone 'UTC')+interval '1 day') at time zone 'UTC',s.sms_limite_diario,p_segments) then raise exception 'limite' using errcode='P0002'; end if;
      if not public.consume_sms_rate_limit('sms_monthly',fingerprint,date_trunc('month',now() at time zone 'UTC') at time zone 'UTC',(date_trunc('month',now() at time zone 'UTC')+interval '1 month') at time zone 'UTC',s.sms_limite_mensual,p_segments) then raise exception 'limite' using errcode='P0002'; end if;
    end if;
  exception when no_data_found then return jsonb_build_object('allowed',false,'code','limite_consumo'); end;
  insert into messaging_private.notification_attempts(outbox_id,verification_id,provider,correlation_id,attempt_number,status,routing_reason,segments,lease_token,is_simulated)
  values(p_outbox,p_verification,p_provider,p_correlation,n,'procesando',p_reason,p_segments,p_lease,s.sms_modo_prueba) returning * into a;
  return jsonb_build_object('allowed',true,'attempt_id',a.id,'simulation',s.sms_modo_prueba);
end $$;
revoke all on function public.begin_sms_attempt(uuid,uuid,uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.begin_sms_attempt(uuid,uuid,uuid,text,text,text,integer) to service_role;

create function public.finish_sms_attempt(p_attempt uuid,p_state text,p_provider_id text default null,p_class text default null,p_code text default null)
returns void language plpgsql security definer set search_path='' as $$
declare a messaging_private.notification_attempts;
begin
  if p_state not in ('aceptado','simulado','fallido','resultado_desconocido') or p_state is null then raise exception 'Estado invalido'; end if;
  if (p_state='fallido' and (p_class is null or p_class not in ('permanente','rechazo_confirmado'))) or (p_state<>'fallido' and p_class is not null) then raise exception 'Clasificacion invalida'; end if;
  select * into strict a from messaging_private.notification_attempts where id=p_attempt for update;
  -- Callback can beat the HTTP response; never downgrade delivered/sent/failed.
  if a.status in ('procesando','resultado_desconocido') then
    update messaging_private.notification_attempts set status=p_state,provider_message_id=left(p_provider_id,100),failure_class=p_class,error_code=left(p_code,80),updated_at=now() where id=p_attempt;
  end if;
end $$;
revoke all on function public.finish_sms_attempt(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.finish_sms_attempt(uuid,text,text,text,text) to service_role;

create function public.finish_sms_notification(p_id uuid,p_lease uuid,p_state text) returns boolean
language plpgsql security definer set search_path='' as $$
declare o messaging_private.notification_outbox; a messaging_private.notification_attempts;
begin
  select * into strict o from messaging_private.notification_outbox where id=p_id for update;
  if o.status in ('entregado','enviado','fallido') then return true; end if;
  if o.status<>'procesando' or o.lease_token is distinct from p_lease then return false; end if;
  select * into a from messaging_private.notification_attempts where outbox_id=p_id order by attempt_number desc limit 1;
  if p_state='cancelado' and a.id is null then
    update messaging_private.notification_outbox set status='cancelado',lease_token=null,lease_until=null,updated_at=now() where id=p_id;
    return true;
  end if;
  if a.id is null or a.status='procesando' then p_state:='resultado_desconocido';
  elsif a.status is distinct from p_state then p_state:=a.status; end if;
  update messaging_private.notification_outbox set status=p_state,lease_token=null,lease_until=null,updated_at=now() where id=p_id;
  return true;
end $$;
revoke all on function public.finish_sms_notification(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finish_sms_notification(uuid,uuid,text) to service_role;

create function public.record_sms_callback(p_provider text,p_correlation text,p_destination text,p_state text,p_code text,p_timestamp timestamptz,p_event_key text)
returns boolean language plpgsql security definer set search_path='' as $$
declare a messaging_private.notification_attempts; destination text; inserted bigint;
begin
  if p_state is null or p_state not in ('enviado','entregado','fallido') then raise exception 'Evento invalido'; end if;
  select * into a from messaging_private.notification_attempts where provider=p_provider and correlation_id=p_correlation;
  if a.id is null then return false; end if;
  if a.outbox_id is not null then
    select destination_e164 into destination from messaging_private.notification_outbox where id=a.outbox_id for update;
  else select phone_e164 into destination from messaging_private.phone_verifications where id=a.verification_id for update; end if;
  if destination is distinct from p_destination then return false; end if;
  select * into strict a from messaging_private.notification_attempts where id=a.id for update;
  if a.status='simulado' or a.is_simulated then return false; end if;
  insert into messaging_private.notification_events(attempt_id,provider,deduplication_key,event_type,provider_code,occurred_at)
    values(a.id,p_provider,p_event_key,p_state,left(p_code,80),p_timestamp) on conflict(provider,deduplication_key) do nothing returning id into inserted;
  if inserted is null then return true; end if;
  if a.status in ('entregado','fallido') or (a.status='enviado' and p_state='enviado') then return true; end if;
  update messaging_private.notification_attempts set status=p_state,error_code=case when p_state='fallido' then left(p_code,80) else null end,updated_at=now() where id=a.id;
  if a.outbox_id is not null then
    update messaging_private.notification_outbox set status=p_state,lease_token=null,lease_until=null,updated_at=now() where id=a.outbox_id
      and status not in ('entregado','fallido','cancelado','simulado','vencido');
  end if;
  return true;
end $$;
revoke all on function public.record_sms_callback(text,text,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.record_sms_callback(text,text,text,text,text,timestamptz,text) to service_role;

create function public.defer_sms_notification(p_id uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare o messaging_private.notification_outbox; a messaging_private.notification_attempts; delay interval;
begin
  select * into strict o from messaging_private.notification_outbox where id=p_id for update;
  if o.status<>'procesando' or o.lease_token is distinct from p_lease then return false; end if;
  select * into a from messaging_private.notification_attempts where outbox_id=p_id order by attempt_number desc limit 1;
  if a.id is not null and (a.status<>'fallido' or a.failure_class is distinct from 'rechazo_confirmado') then return false; end if;
  if o.claimed_count>=4 or coalesce(a.attempt_number,0)>=4 then
    update messaging_private.notification_outbox set status='fallido',lease_token=null,lease_until=null,updated_at=now() where id=p_id;
    return true;
  end if;
  delay:=case o.claimed_count when 1 then interval '1 minute' when 2 then interval '5 minutes' else interval '30 minutes' end;
  if now()+delay>=o.expires_at then
    update messaging_private.notification_outbox set status='vencido',lease_token=null,lease_until=null,updated_at=now() where id=p_id;
  else
    update messaging_private.notification_outbox set status='pendiente',scheduled_at=now()+delay,lease_token=null,lease_until=null,updated_at=now() where id=p_id;
  end if;
  return true;
end $$;
revoke all on function public.defer_sms_notification(uuid,uuid) from public,anon,authenticated;
grant execute on function public.defer_sms_notification(uuid,uuid) to service_role;

-- Solo la comprobación operativa de secretos/adaptador desde backend puede
-- renovar disponibilidad. La instalación no habilita procesador ni obligación.
create function public.refresh_sms_provider_capability(p_provider text,p_ready boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_provider not in ('labsmobile','mock') then raise exception 'Proveedor no implementado'; end if;
  update messaging_private.provider_capabilities set adapter_ready=true,supports_otp=true,supports_transactional=true,
    configured_until=case when p_ready then now()+interval '24 hours' else null end where provider=p_provider;
end $$;
revoke all on function public.refresh_sms_provider_capability(text,boolean) from public,anon,authenticated;
grant execute on function public.refresh_sms_provider_capability(text,boolean) to service_role;
commit;
