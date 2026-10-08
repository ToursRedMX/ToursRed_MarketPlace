-- Fase 1: base aditiva. No envíos, cron, activación ni cambios financieros.
begin;
create schema messaging_private;
revoke all on schema messaging_private from public, anon, authenticated;
grant usage on schema messaging_private to service_role;
alter default privileges in schema messaging_private revoke execute on functions from public;

create table messaging_private.runtime_capabilities (
  singleton boolean primary key default true check (singleton),
  processor_ready boolean not null default false,
  otp_enforcement_ready boolean not null default false
);
insert into messaging_private.runtime_capabilities default values;
create table messaging_private.provider_capabilities (
  provider text primary key check (provider in ('labsmobile','twilio','mock')),
  adapter_ready boolean not null default false,
  supports_otp boolean not null default false,
  supports_transactional boolean not null default false,
  configured_until timestamptz
);
insert into messaging_private.provider_capabilities(provider) values ('labsmobile'),('twilio'),('mock');

alter table public.platform_settings
  add column phone_verification_required boolean not null default false,
  add column phone_verification_travelers_required boolean not null default true,
  add column phone_verification_agencies_required boolean not null default true,
  add column sms_habilitado boolean not null default false,
  add column sms_modo_prueba boolean not null default true,
  add column sms_proveedor_otp text not null default 'labsmobile' check (sms_proveedor_otp in ('labsmobile','twilio','mock')),
  add column sms_proveedor_transaccional text not null default 'labsmobile' check (sms_proveedor_transaccional in ('labsmobile','twilio','mock')),
  add column sms_proveedor_recordatorios text not null default 'labsmobile' check (sms_proveedor_recordatorios in ('labsmobile','twilio','mock')),
  add column sms_proveedor_respaldo text check (sms_proveedor_respaldo in ('labsmobile','twilio','mock')),
  add column sms_fallback_habilitado boolean not null default false,
  add column sms_paises_permitidos text[] not null default array['MX','US','CA'],
  add column sms_hora_recordatorio_local smallint not null default 18 check (sms_hora_recordatorio_local between 8 and 20),
  add column sms_limite_diario integer not null default 100 check (sms_limite_diario between 1 and 100000),
  add column sms_limite_mensual integer not null default 1000 check (sms_limite_mensual between 1 and 3000000),
  add column sms_otp_limite_usuario_diario smallint not null default 5 check (sms_otp_limite_usuario_diario between 1 and 20),
  add column sms_otp_limite_telefono_diario smallint not null default 5 check (sms_otp_limite_telefono_diario between 1 and 20),
  add column sms_otp_limite_ip_hora smallint not null default 20 check (sms_otp_limite_ip_hora between 1 and 100),
  add column sms_umbral_saldo_creditos numeric(12,2) not null default 100 check (sms_umbral_saldo_creditos >= 0),
  add column sms_config_version bigint not null default 1;

-- Solo conserva equivalencias inequívocas del formato histórico MX. No valida
-- asignación, operador, país NANP ni posesión. Fase 2 valida E.164 con metadatos.
create function public.normalizar_telefono(p_phone text) returns text
language plpgsql immutable set search_path = '' as $$
declare n text;
begin
  if p_phone is null or btrim(p_phone) !~ '^\+?[0-9 ()\.-]+$' then return null; end if;
  n := regexp_replace(p_phone, '[^0-9]', '', 'g');
  if btrim(p_phone) like '+%' then
    if n ~ '^[1-9][0-9]{7,14}$' then return '+' || n; end if;
  elsif n ~ '^[0-9]{10}$' then return '+52' || n;
  elsif n ~ '^52[0-9]{10}$' then return '+' || n;
  end if;
  return null;
end $$;
revoke all on function public.normalizar_telefono(text) from public, anon;
grant execute on function public.normalizar_telefono(text) to authenticated, service_role;

alter table public.users
  add column phone_verified_at timestamptz,
  add column phone_verified_e164 text,
  add constraint users_phone_verification_pair check (
    (phone_verified_at is null and phone_verified_e164 is null) or
    (phone_verified_at is not null and phone_verified_e164 is not null and
     phone_verified_e164 ~ '^\+[1-9][0-9]{7,14}$' and
     public.normalizar_telefono(phone_number) is not null and
     phone_verified_e164 = public.normalizar_telefono(phone_number))
  );
-- No backfill: los teléfonos previos NO acreditan verificación.
create unique index users_verified_phone_unique on public.users(phone_verified_e164) where phone_verified_e164 is not null;

create table messaging_private.phone_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  pepper_version smallint not null check (pepper_version > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  status text not null default 'pendiente' check (status in ('pendiente','verificado','vencido','bloqueado','invalidado')),
  is_simulated boolean not null default false,
  provider text references messaging_private.provider_capabilities(provider),
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  check (not is_simulated or status <> 'verificado')
);
create unique index phone_verifications_one_pending on messaging_private.phone_verifications(user_id) where status='pendiente';
create index phone_verifications_expiry on messaging_private.phone_verifications(expires_at);

create function public.guard_phone_verification_fields() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('anon','authenticated') then
    if TG_OP='INSERT' then
      if new.phone_verified_at is not null or new.phone_verified_e164 is not null then
        raise exception 'La verificacion telefonica solo puede acreditarla el motor OTP' using errcode='42501';
      end if;
    elsif new.phone_verified_at is distinct from old.phone_verified_at or new.phone_verified_e164 is distinct from old.phone_verified_e164 then
      raise exception 'La verificacion telefonica solo puede acreditarla el motor OTP' using errcode='42501';
    end if;
  end if;
  if TG_OP='UPDATE' and new.phone_number is distinct from old.phone_number
     and public.normalizar_telefono(new.phone_number) is distinct from old.phone_verified_e164 then
    new.phone_verified_at := null;
    new.phone_verified_e164 := null;
  end if;
  return new;
end $$;
revoke all on function public.guard_phone_verification_fields() from public, anon, authenticated;
create trigger guard_phone_verification_fields before insert or update on public.users
for each row execute function public.guard_phone_verification_fields();

create function messaging_private.invalidate_phone_challenges() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.phone_number is distinct from old.phone_number then
    update messaging_private.phone_verifications set status='invalidado'
    where user_id=new.id and status='pendiente'
      and phone_e164 is distinct from public.normalizar_telefono(new.phone_number);
  end if;
  return new;
end $$;
create trigger invalidate_phone_challenges after update of phone_number on public.users
for each row execute function messaging_private.invalidate_phone_challenges();

create table messaging_private.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  application text not null default 'toursred' check (application in ('toursred','nature_stay','routesred')),
  channel text not null default 'sms' check (channel in ('sms','whatsapp')),
  category text not null check (category in ('reserva_confirmada','recordatorio_tour')),
  template_version smallint not null default 1 check (template_version > 0),
  user_id uuid references public.users(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  destination_e164 text check (destination_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  scheduled_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'pendiente' check (status in ('pendiente','procesando','aceptado','enviado','entregado','fallido','resultado_desconocido','cancelado','simulado','vencido')),
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  lease_token uuid,
  lease_until timestamptz,
  claimed_count integer not null default 0 check (claimed_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application,channel,idempotency_key),
  check (expires_at > scheduled_at),
  check (destination_e164 is not null or status in ('entregado','fallido','cancelado','simulado','vencido')),
  check ((status='procesando' and lease_token is not null and lease_until is not null)
      or (status<>'procesando' and lease_token is null and lease_until is null))
);
create index notification_outbox_pending on messaging_private.notification_outbox(scheduled_at,id) where status='pendiente';
create index notification_outbox_leases on messaging_private.notification_outbox(lease_until) where status='procesando';
create index notification_outbox_booking on messaging_private.notification_outbox(booking_id);
create index notification_outbox_user on messaging_private.notification_outbox(user_id);

create table messaging_private.notification_attempts (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid references messaging_private.notification_outbox(id) on delete cascade,
  verification_id uuid references messaging_private.phone_verifications(id) on delete cascade,
  provider text not null references messaging_private.provider_capabilities(provider),
  correlation_id text not null unique check (correlation_id ~ '^[a-zA-Z0-9_-]{1,20}$'),
  provider_message_id text,
  attempt_number smallint not null check (attempt_number between 1 and 10),
  status text not null check (status in ('procesando','aceptado','enviado','entregado','fallido','resultado_desconocido','simulado')),
  failure_class text check (failure_class in ('permanente','rechazo_confirmado','desconocido')),
  error_code text check (length(error_code) <= 80),
  routing_reason text not null check (routing_reason in ('principal','fallback_confirmado')),
  segments smallint check (segments > 0),
  cost numeric(14,6) check (cost >= 0),
  cost_unit text check (length(cost_unit) <= 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(outbox_id,verification_id)=1),
  check ((cost is null) = (cost_unit is null)),
  unique(outbox_id,attempt_number),
  unique(verification_id,attempt_number)
);
create table messaging_private.notification_events (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references messaging_private.notification_attempts(id) on delete cascade,
  provider text not null references messaging_private.provider_capabilities(provider),
  deduplication_key text not null check (length(deduplication_key) between 1 and 200),
  event_type text not null check (event_type in ('aceptado','enviado','entregado','fallido','resultado_desconocido','simulado')),
  provider_code text check (length(provider_code) <= 80),
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  unique(provider,deduplication_key)
);
create index notification_events_attempt on messaging_private.notification_events(attempt_id);
create table messaging_private.notification_preferences (
  user_id uuid not null references public.users(id) on delete cascade,
  application text not null default 'toursred' check (application in ('toursred','nature_stay','routesred')),
  channel text not null default 'sms' check (channel in ('sms','whatsapp')),
  transactional_enabled boolean not null default true,
  promotional_enabled boolean not null default false check (not promotional_enabled),
  updated_at timestamptz not null default now(),
  primary key(user_id,application,channel)
);
create table messaging_private.rate_limit_buckets (
  scope text not null check (scope in ('otp_user','otp_phone','otp_ip','otp_failures','sms_daily','sms_monthly')),
  subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  window_end timestamptz not null check (window_end > window_start),
  used integer not null default 0 check (used >= 0),
  primary key(scope,subject_hash,window_start)
);

-- Secreto/PII operacional nunca disponible por PostgREST a usuarios de la app.
do $$ declare t text; begin
  foreach t in array array['runtime_capabilities','provider_capabilities','phone_verifications','notification_outbox','notification_attempts','notification_events','notification_preferences','rate_limit_buckets'] loop
    execute format('alter table messaging_private.%I enable row level security',t);
  end loop;
end $$;
revoke all on all tables in schema messaging_private from public,anon,authenticated;
revoke all on all sequences in schema messaging_private from public,anon,authenticated;
grant select,insert,update,delete on all tables in schema messaging_private to service_role;
grant usage,select on all sequences in schema messaging_private to service_role;

-- El guard de campos nuevos funciona aunque las políticas UPDATE existentes
-- sean permisivas. SECURITY INVOKER es intencional: una RPC autorizada corre
-- con su propietario; una petición directa conserva current_user authenticated.
create function public.guard_sms_settings() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare changed boolean;
begin
  select exists(select 1 from jsonb_each(to_jsonb(new)) n
    where (n.key like 'sms\_%' escape '\' or n.key like 'phone_verification\_%' escape '\')
      and (TG_OP='INSERT' or n.value is distinct from to_jsonb(old)->n.key)) into changed;
  if changed and current_user in ('anon','authenticated') then
    raise exception 'Usa update_sms_settings para cambiar la configuracion SMS' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_sms_settings() from public,anon,authenticated;
create trigger guard_sms_settings before insert or update on public.platform_settings
for each row execute function public.guard_sms_settings();

create function messaging_private.require_settings_admin() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.users u left join public.admin_permissions p on p.user_id=u.id
    where u.id=auth.uid() and u.is_active and u.role='admin'
      and (u.is_super_admin or p.can_manage_settings)
  ) then raise exception 'No autorizado para configurar SMS' using errcode='42501'; end if;
  if public.requires_aal2_check() and not public.has_aal2() then
    raise exception 'Se requiere MFA AAL2' using errcode='42501';
  end if;
end $$;

create function messaging_private.settings_json(p_row public.platform_settings) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(p_row))
  where key like 'sms\_%' escape '\' or key like 'phone_verification\_%' escape '\';
$$;

create function public.get_sms_settings() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.platform_settings;
begin
  perform messaging_private.require_settings_admin();
  select * into strict s from public.platform_settings;
  return jsonb_build_object('settings', messaging_private.settings_json(s),
    'runtime',(select to_jsonb(r)-'singleton' from messaging_private.runtime_capabilities r),
    'providers',(select jsonb_agg(to_jsonb(p) || jsonb_build_object('available',p.adapter_ready and coalesce(p.configured_until>now(),false)) order by provider) from messaging_private.provider_capabilities p));
end $$;
revoke all on function public.get_sms_settings() from public,anon,authenticated;
grant execute on function public.get_sms_settings() to authenticated;

create function public.update_sms_settings(p_patch jsonb,p_expected_version bigint) returns jsonb
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
    if (v='null'::jsonb and k<>'sms_proveedor_respaldo') or
      (v<>'null'::jsonb and jsonb_typeof(v)<>case when k='sms_proveedor_respaldo' then 'string' else jsonb_typeof(expected) end) then
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
  if candidate.phone_verification_required and (
    not candidate.sms_habilitado or candidate.sms_modo_prueba or candidate.sms_proveedor_otp='mock' or
    not (select otp_enforcement_ready from messaging_private.runtime_capabilities)
  ) then raise exception 'La obligatoriedad requiere SMS real y motor OTP completo'; end if;
  update public.platform_settings set
    phone_verification_required=candidate.phone_verification_required,
    phone_verification_travelers_required=candidate.phone_verification_travelers_required,
    phone_verification_agencies_required=candidate.phone_verification_agencies_required,
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
revoke all on function public.update_sms_settings(jsonb,bigint) from public,anon,authenticated;
grant execute on function public.update_sms_settings(jsonb,bigint) to authenticated;

-- Solo backend. No sustituye autorizacion de negocio ni MFA. El endpoint
-- determina contexto; no aceptar un 'admin' enviado por el navegador.
create function public.phone_verification_policy(p_user_id uuid,p_context text) returns jsonb
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
    'pending',required and u.phone_verified_at is null,'sms_enabled',s.sms_habilitado,'simulation',s.sms_modo_prueba);
end $$;
revoke all on function public.phone_verification_policy(uuid,text) from public,anon,authenticated;
grant execute on function public.phone_verification_policy(uuid,text) to service_role;

create function public.get_my_phone_verification_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u public.users;
begin
  if auth.uid() is null then raise exception 'Sesion requerida' using errcode='42501'; end if;
  select * into strict u from public.users where id=auth.uid();
  return jsonb_build_object('traveler',public.phone_verification_policy(u.id,'traveler'),
    'agency',public.phone_verification_policy(u.id,'agency'),
    'verified_at',u.phone_verified_at,'phone_suffix',right(u.phone_verified_e164,4));
end $$;
revoke all on function public.get_my_phone_verification_status() from public,anon,authenticated;
grant execute on function public.get_my_phone_verification_status() to authenticated;

create function public.enqueue_sms_notification(p_user_id uuid,p_booking_id uuid,p_destination text,p_country text,
 p_category text,p_key text,p_scheduled_at timestamptz,p_expires_at timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  insert into messaging_private.notification_outbox(user_id,booking_id,destination_e164,country_code,category,idempotency_key,scheduled_at,expires_at)
    values(p_user_id,p_booking_id,p_destination,p_country,p_category,p_key,p_scheduled_at,p_expires_at)
    on conflict(application,channel,idempotency_key) do nothing returning id into result;
  if result is null then
    select id into result from messaging_private.notification_outbox where application='toursred' and channel='sms' and idempotency_key=p_key;
  end if;
  return result;
end $$;
revoke all on function public.enqueue_sms_notification(uuid,uuid,text,text,text,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.enqueue_sms_notification(uuid,uuid,text,text,text,text,timestamptz,timestamptz) to service_role;

create function public.claim_sms_notifications(p_limit integer default 20) returns setof messaging_private.notification_outbox
language plpgsql security definer set search_path = '' as $$
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Lote invalido'; end if;
  -- Un worker pudo enviar antes de perder su lease: nunca reintentar a ciegas.
  update messaging_private.notification_outbox set status='resultado_desconocido',lease_token=null,lease_until=null,updated_at=now()
    where status='procesando' and lease_until<=now();
  update messaging_private.notification_outbox set status='vencido',updated_at=now() where status='pendiente' and expires_at<=now();
  if not exists(select 1 from public.platform_settings where sms_habilitado) or
    not exists(select 1 from messaging_private.runtime_capabilities where processor_ready) then return; end if;
  return query with eligible as (
    select id from messaging_private.notification_outbox where status='pendiente' and scheduled_at<=now() and expires_at>now()
      order by scheduled_at,id for update skip locked limit p_limit
  ) update messaging_private.notification_outbox o set status='procesando',lease_token=gen_random_uuid(),
    lease_until=now()+interval '2 minutes',claimed_count=claimed_count+1,updated_at=now()
    from eligible e where o.id=e.id returning o.*;
end $$;
revoke all on function public.claim_sms_notifications(integer) from public,anon,authenticated;
grant execute on function public.claim_sms_notifications(integer) to service_role;

create function public.consume_sms_rate_limit(p_scope text,p_hash text,p_start timestamptz,p_end timestamptz,p_limit integer,p_units integer default 1) returns boolean
language plpgsql security definer set search_path = '' as $$
declare amount integer;
begin
  if p_limit is null or p_limit<1 or p_units is null or p_units<1 or p_units>p_limit
    or p_start is null or p_end is null or p_start>now() or p_end<=now() then raise exception 'Limite invalido'; end if;
  insert into messaging_private.rate_limit_buckets(scope,subject_hash,window_start,window_end,used)
    values(p_scope,p_hash,p_start,p_end,p_units)
    on conflict(scope,subject_hash,window_start) do update set used=messaging_private.rate_limit_buckets.used+excluded.used
    where messaging_private.rate_limit_buckets.used<=p_limit-excluded.used
      and messaging_private.rate_limit_buckets.window_end=excluded.window_end
    returning used into amount;
  return amount is not null;
end $$;
revoke all on function public.consume_sms_rate_limit(text,text,timestamptz,timestamptz,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_sms_rate_limit(text,text,timestamptz,timestamptz,integer,integer) to service_role;

create function public.purge_sms_private_data() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update messaging_private.phone_verifications set status='vencido' where status='pendiente' and expires_at<now();
  delete from messaging_private.phone_verifications where status<>'pendiente' and expires_at<now()-interval '24 hours';
  delete from messaging_private.notification_attempts a using messaging_private.notification_outbox o
    where a.outbox_id=o.id and o.status in ('entregado','fallido','cancelado','simulado','vencido') and o.updated_at<now()-interval '30 days';
  -- Retener identidad/idempotencia, eliminar datos de contacto y referencias.
  update messaging_private.notification_outbox set destination_e164=null,user_id=null,booking_id=null
    where status in ('entregado','fallido','cancelado','simulado','vencido') and updated_at<now()-interval '30 days';
  delete from messaging_private.rate_limit_buckets where window_end<now()-interval '24 hours';
end $$;
revoke all on function public.purge_sms_private_data() from public,anon,authenticated;
grant execute on function public.purge_sms_private_data() to service_role;
revoke all on all functions in schema messaging_private from public,anon,authenticated;
comment on schema messaging_private is 'Fase 1 SMS/OTP: datos privados; sin envios ni activacion automatica. No exponer en Data API.';
commit;
