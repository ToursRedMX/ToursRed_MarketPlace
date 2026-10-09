-- OTP channels are independent. Existing SMS routing and verified numbers are preserved.
begin;
alter table public.platform_settings
 add column whatsapp_habilitado boolean not null default false,
 add column whatsapp_proveedor_otp text not null default 'twilio',
 add column whatsapp_proveedor_respaldo text,
 add column whatsapp_fallback_habilitado boolean not null default false;
-- Separate registry: LabsMobile must never become a WhatsApp candidate.
create table messaging_private.whatsapp_providers (
 provider text primary key references messaging_private.provider_capabilities(provider),
 adapter_ready boolean not null default false,
 configured_until timestamptz
);
insert into messaging_private.whatsapp_providers(provider,adapter_ready) values ('twilio',true);
alter table messaging_private.whatsapp_providers enable row level security;
revoke all on messaging_private.whatsapp_providers from public,anon,authenticated;
alter table public.platform_settings
 add constraint whatsapp_primary_provider foreign key (whatsapp_proveedor_otp) references messaging_private.whatsapp_providers(provider),
 add constraint whatsapp_backup_provider foreign key (whatsapp_proveedor_respaldo) references messaging_private.whatsapp_providers(provider);
alter table messaging_private.phone_verifications add column channel text not null default 'sms' check(channel in ('sms','whatsapp'));
alter table messaging_private.notification_attempts add column channel text not null default 'sms' check(channel in ('sms','whatsapp'));

create function public.refresh_whatsapp_provider_capability(p_provider text,p_ready boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 update messaging_private.whatsapp_providers set configured_until=case when p_ready then now()+interval '26 hours' else null end where provider=p_provider and adapter_ready;
end $$;
revoke all on function public.refresh_whatsapp_provider_capability(text,boolean) from public,anon,authenticated;
grant execute on function public.refresh_whatsapp_provider_capability(text,boolean) to service_role;
create or replace function public.guard_sms_settings() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare changed boolean;
begin
  select exists(select 1 from jsonb_each(to_jsonb(new)) n
    where (n.key like 'whatsapp\_%' escape '\' or n.key like 'sms\_%' escape '\' or n.key like 'phone_verification\_%' escape '\')
      and (TG_OP='INSERT' or n.value is distinct from to_jsonb(old)->n.key)) into changed;
  if changed and current_user in ('anon','authenticated') then
    raise exception 'Usa update_sms_settings para cambiar la configuracion SMS' using errcode='42501';
  end if;
  return new;
end $$;
create or replace function messaging_private.settings_json(p_row public.platform_settings) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(p_row))
  where key like 'whatsapp\_%' escape '\' or key like 'sms\_%' escape '\' or key like 'phone_verification\_%' escape '\';
$$;
create or replace function public.get_sms_settings() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.platform_settings;
begin
  perform messaging_private.require_settings_admin();
  select * into strict s from public.platform_settings;
  return jsonb_build_object('settings', messaging_private.settings_json(s),
    'runtime',(select to_jsonb(r)-'singleton' from messaging_private.runtime_capabilities r),
    'whatsapp_providers',(select jsonb_agg(to_jsonb(w)||jsonb_build_object('available',w.adapter_ready and coalesce(w.configured_until>now(),false)) order by provider) from messaging_private.whatsapp_providers w),
    'providers',(select jsonb_agg(to_jsonb(p) || jsonb_build_object('available',p.adapter_ready and coalesce(p.configured_until>now(),false)) order by provider) from messaging_private.provider_capabilities p));
end $$;
create or replace function public.update_sms_settings(p_patch jsonb,p_expected_version bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.platform_settings; candidate public.platform_settings; k text; p text; v jsonb; expected jsonb;
begin
  perform messaging_private.require_settings_admin();
  if p_patch is null or jsonb_typeof(p_patch)<>'object' or p_expected_version is null then
    raise exception 'Configuracion invalida';
  end if;
  select * into strict s from public.platform_settings for update;
  if s.sms_config_version<>p_expected_version then raise exception 'La configuracion cambio; recarga antes de guardar' using errcode='40001'; end if;
  for k,v in select * from jsonb_each(p_patch) loop
    if k='sms_config_version' or not (messaging_private.settings_json(s) ? k) then raise exception 'Campo no permitido: %',k; end if;
    expected := messaging_private.settings_json(s)->k;
    if (v='null'::jsonb and k not in ('sms_proveedor_respaldo','whatsapp_proveedor_respaldo')) or
      (v<>'null'::jsonb and jsonb_typeof(v)<>case when k in ('sms_proveedor_respaldo','whatsapp_proveedor_respaldo') then 'string' else jsonb_typeof(expected) end) then
      raise exception 'Tipo invalido: %',k;
    end if;
  end loop;
  candidate := jsonb_populate_record(s,p_patch);
  if cardinality(candidate.sms_paises_permitidos) not between 1 and 250 or
    exists(select 1 from unnest(candidate.sms_paises_permitidos) c where c is null or c !~ '^[A-Z]{2}$') or
    cardinality(candidate.sms_paises_permitidos)<>(select count(distinct c) from unnest(candidate.sms_paises_permitidos) c) then raise exception 'Paises invalidos'; end if;
  if candidate.sms_limite_diario>candidate.sms_limite_mensual then raise exception 'El limite mensual debe cubrir el diario'; end if;
  -- No se puede seleccionar un adaptador inexistente, incluso con servicio apagado.
  for k,v in select * from jsonb_each(p_patch) where key like 'sms_proveedor_%' loop
    p:=v#>>'{}';
    if p is not null and p is distinct from (to_jsonb(s)->>k) and not exists (
      select 1 from messaging_private.provider_capabilities where provider=p and adapter_ready and configured_until>now()
    ) then raise exception 'Proveedor no implementado o no configurado: %',p; end if;
  end loop;
  if candidate.sms_fallback_habilitado and (candidate.sms_proveedor_respaldo is null or candidate.sms_proveedor_respaldo in
    (candidate.sms_proveedor_otp,candidate.sms_proveedor_transaccional,candidate.sms_proveedor_recordatorios)) then raise exception 'Respaldo invalido'; end if;
  if candidate.sms_habilitado then
    if not (select processor_ready from messaging_private.runtime_capabilities) then raise exception 'Motor SMS aun no disponible'; end if;
    foreach p in array array[candidate.sms_proveedor_otp,candidate.sms_proveedor_transaccional,candidate.sms_proveedor_recordatorios,
      case when candidate.sms_fallback_habilitado then candidate.sms_proveedor_respaldo else candidate.sms_proveedor_otp end] loop
      if not exists(select 1 from messaging_private.provider_capabilities where provider=p and adapter_ready and configured_until>now()
        and (p<>candidate.sms_proveedor_otp or supports_otp)
        and (p not in (candidate.sms_proveedor_transaccional,candidate.sms_proveedor_recordatorios) or supports_transactional)
        and (not candidate.sms_fallback_habilitado or p<>candidate.sms_proveedor_respaldo or (supports_otp and supports_transactional))) then raise exception 'Proveedor no disponible: %',p; end if;
      if p='mock' and not candidate.sms_modo_prueba then raise exception 'Mock exige simulacion'; end if;
    end loop;
  end if;
  if candidate.whatsapp_fallback_habilitado and (candidate.whatsapp_proveedor_respaldo is null or candidate.whatsapp_proveedor_respaldo=candidate.whatsapp_proveedor_otp) then raise exception 'Respaldo WhatsApp invalido'; end if;
  for k,v in select * from jsonb_each(p_patch) where key like 'whatsapp_proveedor_%' loop
    p:=v#>>'{}';
    if p is not null and p is distinct from (to_jsonb(s)->>k) and not exists(select 1 from messaging_private.whatsapp_providers where provider=p and adapter_ready and configured_until>now()) then raise exception 'Proveedor WhatsApp no disponible: %',p; end if;
  end loop;
  if candidate.whatsapp_habilitado then
    if not (select processor_ready from messaging_private.runtime_capabilities) then raise exception 'Motor OTP aun no disponible'; end if;
    foreach p in array array[candidate.whatsapp_proveedor_otp,case when candidate.whatsapp_fallback_habilitado then candidate.whatsapp_proveedor_respaldo else candidate.whatsapp_proveedor_otp end] loop
      if not exists(select 1 from messaging_private.whatsapp_providers where provider=p and adapter_ready and configured_until>now()) then raise exception 'Proveedor WhatsApp no disponible: %',p; end if;
    end loop;
  end if;
  if candidate.phone_verification_required and (
    (not candidate.sms_habilitado and not candidate.whatsapp_habilitado) or candidate.sms_modo_prueba or (candidate.sms_habilitado and candidate.sms_proveedor_otp='mock') or
    not (select otp_enforcement_ready from messaging_private.runtime_capabilities)
  ) then raise exception 'La obligatoriedad requiere un canal real y motor OTP completo'; end if;
  update public.platform_settings set
    phone_verification_required=candidate.phone_verification_required,
    phone_verification_travelers_required=candidate.phone_verification_travelers_required,
    phone_verification_agencies_required=candidate.phone_verification_agencies_required,
    whatsapp_habilitado=candidate.whatsapp_habilitado,whatsapp_proveedor_otp=candidate.whatsapp_proveedor_otp,
    whatsapp_proveedor_respaldo=candidate.whatsapp_proveedor_respaldo,whatsapp_fallback_habilitado=candidate.whatsapp_fallback_habilitado,
    sms_habilitado=candidate.sms_habilitado,sms_modo_prueba=candidate.sms_modo_prueba,
    sms_proveedor_otp=candidate.sms_proveedor_otp,sms_proveedor_transaccional=candidate.sms_proveedor_transaccional,
    sms_proveedor_recordatorios=candidate.sms_proveedor_recordatorios,sms_proveedor_respaldo=candidate.sms_proveedor_respaldo,
    sms_fallback_habilitado=candidate.sms_fallback_habilitado,sms_paises_permitidos=candidate.sms_paises_permitidos,
    sms_hora_recordatorio_local=candidate.sms_hora_recordatorio_local,sms_limite_diario=candidate.sms_limite_diario,
    sms_limite_mensual=candidate.sms_limite_mensual,sms_otp_limite_usuario_diario=candidate.sms_otp_limite_usuario_diario,
    sms_otp_limite_telefono_diario=candidate.sms_otp_limite_telefono_diario,sms_otp_limite_ip_hora=candidate.sms_otp_limite_ip_hora,
    sms_umbral_saldo_creditos=candidate.sms_umbral_saldo_creditos,sms_config_version=s.sms_config_version+1
    where id=s.id;
  return public.get_sms_settings();
end $$;
create or replace function public.phone_verification_policy(p_user_id uuid,p_context text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u public.users; s public.platform_settings; required boolean;
begin
  if p_context is null or p_context not in ('traveler','agency','administrative') then raise exception 'Contexto invalido'; end if;
  select * into strict u from public.users where id=p_user_id;
  if not coalesce(u.is_active,false) then raise exception 'Usuario inactivo' using errcode='42501'; end if;
  if p_context='administrative' and u.role not in ('admin','accountant','account_executive') then raise exception 'Contexto administrativo no autorizado' using errcode='42501'; end if;
  select * into strict s from public.platform_settings;
  required := s.phone_verification_required and case p_context
    when 'traveler' then s.phone_verification_travelers_required
    when 'agency' then s.phone_verification_agencies_required else false end;
  return jsonb_build_object('required',required,'verified',u.phone_verified_at is not null,
    'pending',required and u.phone_verified_at is null,'sms_enabled',s.sms_habilitado,'whatsapp_enabled',s.whatsapp_habilitado,'simulation',s.sms_modo_prueba);
end $$;
create or replace function public.issue_phone_challenge(p_user uuid,p_id uuid,p_phone text,p_hash text,p_user_hash text,p_phone_hash text,p_ip_hash text,p_simulated boolean,p_channel text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users; s public.platform_settings; c messaging_private.phone_verifications;
 day_start timestamptz:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 hour_start timestamptz:=date_trunc('hour',now());
begin
 select * into strict u from public.users where id=p_user for update;
 select * into strict s from public.platform_settings;
 if not coalesce(u.is_active,false) or not coalesce(u.email_verified,false) then return jsonb_build_object('ok',false,'code','EMAIL_OR_ACCOUNT_REQUIRED'); end if;
 if p_channel is null or p_channel not in ('sms','whatsapp') then return jsonb_build_object('ok',false,'code','OTP_CHANNEL_INVALID'); end if;
 if (p_channel='sms' and not s.sms_habilitado) or (p_channel='whatsapp' and not s.whatsapp_habilitado) or p_simulated is distinct from s.sms_modo_prueba then return jsonb_build_object('ok',false,'code','SMS_UNAVAILABLE'); end if;
 if u.phone_number is not null and public.normalizar_telefono(u.phone_number) is distinct from p_phone and not messaging_private.recent_phone_auth(p_user) then return jsonb_build_object('ok',false,'code','PHONE_REAUTH_REQUIRED'); end if;
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
 insert into messaging_private.phone_verifications(id,user_id,phone_e164,code_hash,pepper_version,expires_at,is_simulated,channel)
 values(p_id,p_user,p_phone,p_hash,1,now()+interval '10 minutes',p_simulated,p_channel);
 insert into messaging_private.phone_events(user_id,verification_id,event_type) values(p_user,p_id,case when p_simulated then 'simulated' else 'requested' end);
 return jsonb_build_object('ok',true,'challenge_id',p_id,'expires_at',now()+interval '10 minutes','simulated',p_simulated);
end $$;

revoke all on function public.issue_phone_challenge(uuid,uuid,text,text,text,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.issue_phone_challenge(uuid,uuid,text,text,text,text,text,boolean,text) to service_role;
create or replace function public.issue_phone_challenge(p_user uuid,p_id uuid,p_phone text,p_hash text,p_user_hash text,p_phone_hash text,p_ip_hash text,p_simulated boolean) returns jsonb
language sql security definer set search_path='' as $$
 select public.issue_phone_challenge(p_user,p_id,p_phone,p_hash,p_user_hash,p_phone_hash,p_ip_hash,p_simulated,'sms');
$$;
create or replace function public.begin_sms_attempt(p_outbox uuid,p_verification uuid,p_lease uuid,p_provider text,p_correlation text,p_reason text,p_segments integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.platform_settings; o messaging_private.notification_outbox; c messaging_private.phone_verifications;
  a messaging_private.notification_attempts; n integer; previous messaging_private.notification_attempts;
  channel text:='sms'; primary_provider text; backup_provider text; fallback_enabled boolean;
  fingerprint text:=encode(extensions.digest('global-sms','sha256'),'hex');
begin
  if num_nonnulls(p_outbox,p_verification)<>1 or p_segments is null or p_segments not between 1 and 3 then raise exception 'Intento invalido'; end if;
  -- Share-lock settings prevents an admin change crossing budget reservation.
  select * into strict s from public.platform_settings for share;
  if p_verification is not null then
    select * into strict c from messaging_private.phone_verifications where id=p_verification for update;
    channel:=c.channel;
  end if;
  if (channel='sms' and not s.sms_habilitado) or (channel='whatsapp' and not s.whatsapp_habilitado) or not (select processor_ready from messaging_private.runtime_capabilities) then return jsonb_build_object('allowed',false,'code','sms_deshabilitado'); end if;
  if channel='whatsapp' then
    if not exists(select 1 from messaging_private.whatsapp_providers where provider=p_provider and adapter_ready and configured_until>now()) then return jsonb_build_object('allowed',false,'code','proveedor_no_disponible'); end if;
  else
  if not exists(select 1 from messaging_private.provider_capabilities where provider=p_provider and adapter_ready and configured_until>now()
    and case when p_verification is not null then supports_otp else supports_transactional end) or (p_provider='mock' and not s.sms_modo_prueba) then return jsonb_build_object('allowed',false,'code','proveedor_no_disponible'); end if;
  end if;
  if p_outbox is not null then
    select * into strict o from messaging_private.notification_outbox where id=p_outbox for update;
    if o.status<>'procesando' or o.lease_token is distinct from p_lease or o.lease_until<=now() or o.expires_at<=now() then return jsonb_build_object('allowed',false,'code','lease_invalido'); end if;
  else
    select * into strict c from messaging_private.phone_verifications where id=p_verification for update;
    if c.status<>'pendiente' or c.expires_at<=now() or c.is_simulated is distinct from s.sms_modo_prueba then return jsonb_build_object('allowed',false,'code','desafio_invalido'); end if;
  end if;
  primary_provider:=case when channel='whatsapp' then s.whatsapp_proveedor_otp when p_verification is not null then s.sms_proveedor_otp when o.category='recordatorio_tour' then s.sms_proveedor_recordatorios else s.sms_proveedor_transaccional end;
  backup_provider:=case when channel='whatsapp' then s.whatsapp_proveedor_respaldo else s.sms_proveedor_respaldo end;
  fallback_enabled:=case when channel='whatsapp' then s.whatsapp_fallback_habilitado else s.sms_fallback_habilitado end;
  select * into previous from messaging_private.notification_attempts where
    (p_outbox is not null and outbox_id=p_outbox) or (p_verification is not null and verification_id=p_verification)
    order by attempt_number desc limit 1;
  n:=coalesce(previous.attempt_number,0)+1;
  if p_reason='principal' then
    if (n<>1 and (p_verification is not null or n>4 or previous.status<>'fallido' or previous.failure_class is distinct from 'rechazo_confirmado' or previous.lease_token is not distinct from p_lease)) or p_provider<>primary_provider then
      return jsonb_build_object('allowed',false,'code','intento_duplicado'); end if;
  elsif p_reason='fallback_confirmado' then
    if not fallback_enabled or p_provider is distinct from backup_provider or n>4 or previous.routing_reason is distinct from 'principal' or previous.lease_token is distinct from p_lease or previous.status<>'fallido'
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
  insert into messaging_private.notification_attempts(outbox_id,verification_id,provider,correlation_id,attempt_number,status,routing_reason,segments,lease_token,is_simulated,channel)
  values(p_outbox,p_verification,p_provider,p_correlation,n,'procesando',p_reason,p_segments,p_lease,s.sms_modo_prueba,channel) returning * into a;
  return jsonb_build_object('allowed',true,'attempt_id',a.id,'simulation',s.sms_modo_prueba);
end $$;
create or replace function public.record_twilio_status(p_correlation text,p_sid text,p_destination text,p_state text,p_code text default null,p_cost numeric default null,p_unit text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare a messaging_private.notification_attempts; destination text; event_key text; inserted bigint;
begin
  if p_sid is null or p_sid !~ '^SM[0-9a-fA-F]{32}$' or p_state is null or p_state not in ('aceptado','enviado','entregado','fallido') then raise exception 'Evento invalido'; end if;
  if (p_cost is null)<>(p_unit is null) or p_cost<0 or p_cost>=100000000 or (p_unit is not null and p_unit !~ '^[A-Z]{3}$') then raise exception 'Costo invalido'; end if;
  select * into a from messaging_private.notification_attempts where provider='twilio' and correlation_id=p_correlation;
  if a.id is null then return false; end if;
  if a.outbox_id is not null then
    select destination_e164 into destination from messaging_private.notification_outbox where id=a.outbox_id for update;
  else select phone_e164 into destination from messaging_private.phone_verifications where id=a.verification_id for update; end if;
  if a.channel='whatsapp' then destination:='whatsapp:'||destination; end if;
  if destination is null or destination is distinct from p_destination then return false; end if;
  select * into strict a from messaging_private.notification_attempts where id=a.id for update;
  if a.is_simulated or a.status='simulado' or (a.provider_message_id is not null and a.provider_message_id<>p_sid) then return false; end if;
  if exists(select 1 from messaging_private.notification_attempts b where b.attempt_number>a.attempt_number and
    ((a.outbox_id is not null and b.outbox_id=a.outbox_id) or (a.verification_id is not null and b.verification_id=a.verification_id))) then return false; end if;
  -- A synchronous refusal cannot later be interpreted as accepted by a callback.
  if a.status='fallido' and a.failure_class='rechazo_confirmado' then return false; end if;
  update messaging_private.notification_attempts set provider_message_id=p_sid,
    cost=coalesce(p_cost,cost),cost_unit=coalesce(p_unit,cost_unit) where id=a.id;
  event_key:=p_sid||':'||p_state||':'||coalesce(left(p_code,80),'');
  insert into messaging_private.notification_events(attempt_id,provider,deduplication_key,event_type,provider_code,occurred_at)
    values(a.id,'twilio',event_key,p_state,left(p_code,80),now()) on conflict(provider,deduplication_key) do nothing returning id into inserted;
  if inserted is null or a.status in ('entregado','fallido') or (a.status='enviado' and p_state='aceptado') then return true; end if;
  update messaging_private.notification_attempts set status=p_state,
    failure_class=case when p_state='fallido' then 'permanente' else null end,
    error_code=case when p_state='fallido' then left(p_code,80) else null end,updated_at=now() where id=a.id;
  if a.outbox_id is not null then
    update messaging_private.notification_outbox set status=p_state,lease_token=null,lease_until=null,updated_at=now()
    where id=a.outbox_id and status not in ('entregado','fallido','cancelado','simulado','vencido');
  end if;
  return true;
end $$;
commit;
