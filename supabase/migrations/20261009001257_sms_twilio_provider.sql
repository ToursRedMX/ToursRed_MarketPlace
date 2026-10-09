begin;

-- Provider capabilities are certified by the backend, never by the migration.
create or replace function public.refresh_sms_provider_capability(p_provider text,p_ready boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_provider is null or p_provider not in ('labsmobile','twilio','mock') or p_ready is null then raise exception 'Proveedor invalido'; end if;
  update messaging_private.provider_capabilities set adapter_ready=true,supports_otp=true,supports_transactional=true,
    configured_until=case when p_ready then now()+interval '24 hours' else null end where provider=p_provider;
end $$;

alter table messaging_private.notification_attempts
  add column reconciled_at timestamptz,
  add column reconciliation_count integer not null default 0 check(reconciliation_count between 0 and 24);
create unique index notification_attempts_twilio_sid on messaging_private.notification_attempts(provider_message_id)
  where provider='twilio' and not is_simulated and provider_message_id is not null;
create index notification_attempts_twilio_reconcile on messaging_private.notification_attempts(reconciled_at,created_at)
  where provider='twilio' and not is_simulated and provider_message_id is not null;

-- Callback and HTTP completion may race. Bind one SID and one recipient to an
-- attempt, lock parent before attempt (same order as dispatch), preserve terminal
-- states and never allow an old primary callback to overwrite a newer fallback.
create function public.record_twilio_status(p_correlation text,p_sid text,p_destination text,p_state text,p_code text default null,p_cost numeric default null,p_unit text default null)
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
revoke all on function public.record_twilio_status(text,text,text,text,text,numeric,text) from public,anon,authenticated;
grant execute on function public.record_twilio_status(text,text,text,text,text,numeric,text) to service_role;

-- A claim only reserves a read of Twilio's API; it never queues another SMS.
create function public.claim_twilio_reconciliation(p_limit integer default 5)
returns table(correlation_id text,provider_message_id text)
language plpgsql security definer set search_path='' as $$
begin
  return query with candidates as (
    select a.id from messaging_private.notification_attempts a
    where a.provider='twilio' and not a.is_simulated and a.provider_message_id ~ '^SM[0-9a-fA-F]{32}$'
      and (a.status in ('aceptado','enviado','resultado_desconocido') or (a.status in ('entregado','fallido') and a.cost is null))
      and a.created_at>now()-interval '24 hours' and a.created_at<now()-interval '1 minute'
      and a.reconciliation_count<24 and (a.reconciled_at is null or a.reconciled_at<now()-interval '5 minutes')
    order by a.reconciled_at nulls first,a.created_at limit greatest(1,least(coalesce(p_limit,5),20)) for update skip locked
  ) update messaging_private.notification_attempts a set reconciled_at=now(),reconciliation_count=a.reconciliation_count+1
    from candidates c where a.id=c.id returning a.correlation_id,a.provider_message_id;
end $$;
revoke all on function public.claim_twilio_reconciliation(integer) from public,anon,authenticated;
grant execute on function public.claim_twilio_reconciliation(integer) to service_role;

alter table messaging_private.provider_health
  add column available boolean,
  add column balance_amount numeric,
  add column balance_unit text check(balance_unit='credits' or balance_unit ~ '^[A-Z]{3}$'),
  add constraint provider_health_balance_pair check((balance_amount is null)=(balance_unit is null));
update messaging_private.provider_health set balance_amount=balance_credits,balance_unit=case when balance_credits is not null then 'credits' end;

create function public.record_sms_provider_health(p_provider text,p_available boolean,p_balance numeric default null,p_unit text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_provider is null or p_provider not in ('labsmobile','twilio') or p_available is null or (p_balance is null)<>(p_unit is null)
    or (p_unit is not null and not (p_unit='credits' or p_unit ~ '^[A-Z]{3}$')) then raise exception 'Salud invalida'; end if;
  insert into messaging_private.provider_health(provider,available,balance_amount,balance_unit,balance_credits,balance_checked_at)
  values(p_provider,p_available,p_balance,p_unit,case when p_unit='credits' then p_balance end,case when p_balance is not null then now() end)
  on conflict(provider) do update set checked_at=now(),available=p_available,
    balance_amount=coalesce(excluded.balance_amount,messaging_private.provider_health.balance_amount),
    balance_unit=coalesce(excluded.balance_unit,messaging_private.provider_health.balance_unit),
    balance_credits=coalesce(excluded.balance_credits,messaging_private.provider_health.balance_credits),
    balance_checked_at=coalesce(excluded.balance_checked_at,messaging_private.provider_health.balance_checked_at);
end $$;
revoke all on function public.record_sms_provider_health(text,boolean,numeric,text) from public,anon,authenticated;
grant execute on function public.record_sms_provider_health(text,boolean,numeric,text) to service_role;

alter table messaging_private.runtime_capabilities add column last_worker_at timestamptz;

create or replace function public.finish_sms_attempt(p_attempt uuid,p_state text,p_provider_id text default null,p_class text default null,p_code text default null)
returns void language plpgsql security definer set search_path='' as $$
declare a messaging_private.notification_attempts;
begin
  if p_state not in ('aceptado','simulado','fallido','resultado_desconocido') or p_state is null then raise exception 'Estado invalido'; end if;
  if (p_state='fallido' and (p_class is null or p_class not in ('permanente','rechazo_confirmado'))) or (p_state<>'fallido' and p_class is not null) then raise exception 'Clasificacion invalida'; end if;
  select * into strict a from messaging_private.notification_attempts where id=p_attempt for update;
  if a.is_simulated and p_state not in ('simulado','fallido','resultado_desconocido') then raise exception 'Simulacion no acredita entrega'; end if;
  if a.provider='twilio' and not a.is_simulated and p_provider_id is not null then
    if p_provider_id !~ '^SM[0-9a-fA-F]{32}$' or (a.provider_message_id is not null and a.provider_message_id<>p_provider_id) then raise exception 'SID incompatible'; end if;
    update messaging_private.notification_attempts set provider_message_id=p_provider_id where id=a.id;
  end if;
  -- Callback can beat the HTTP response; never downgrade delivered/sent/failed.
  if a.status in ('procesando','resultado_desconocido') then
    update messaging_private.notification_attempts set status=p_state,provider_message_id=coalesce(left(p_provider_id,100),provider_message_id),failure_class=p_class,error_code=left(p_code,80),updated_at=now() where id=p_attempt;
  end if;
end $$;
revoke all on function public.finish_sms_attempt(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.finish_sms_attempt(uuid,text,text,text,text) to service_role;

create or replace function public.record_sms_health(p_credits numeric default null,p_balance_ok boolean default false,p_worker boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare s public.platform_settings; failures integer; unknowns integer; consumed bigint;
begin
 select * into strict s from public.platform_settings;
 if p_balance_ok then perform public.record_sms_provider_health('labsmobile',true,p_credits,'credits'); end if;
 if p_worker then update messaging_private.runtime_capabilities set last_worker_at=now(); end if;
 if not p_worker then
  perform messaging_private.alert('provider_unavailable',s.sms_habilitado and exists(
    select 1 from messaging_private.provider_capabilities p left join messaging_private.provider_health h using(provider)
    where p.provider in (s.sms_proveedor_otp,s.sms_proveedor_transaccional,s.sms_proveedor_recordatorios,case when s.sms_fallback_habilitado then s.sms_proveedor_respaldo end)
      and p.provider<>'mock' and (h.available is distinct from true or h.checked_at<now()-interval '2 hours')));
  perform messaging_private.alert('low_balance',exists(select 1 from messaging_private.provider_health h where h.provider='labsmobile' and h.balance_unit='credits'
    and h.balance_amount<s.sms_umbral_saldo_creditos and h.balance_checked_at>now()-interval '24 hours'));
 end if;
 select count(*) filter(where status='fallido'),count(*) filter(where status='resultado_desconocido') into failures,unknowns from messaging_private.notification_attempts where created_at>now()-interval '1 hour' and not is_simulated;
 perform messaging_private.alert('repeated_errors',failures>=5); perform messaging_private.alert('unknown_results',unknowns>0);
 select coalesce(sum(used),0) into consumed from messaging_private.rate_limit_buckets where scope='sms_daily' and window_end>now();
 perform messaging_private.alert('consumption_high',consumed>=s.sms_limite_diario*0.8);
 perform messaging_private.alert('otp_abuse',exists(select 1 from messaging_private.rate_limit_buckets where scope='otp_ip' and window_end>now() and used>=s.sms_otp_limite_ip_hora));
 perform messaging_private.alert('worker_stale',s.sms_habilitado and not exists(select 1 from messaging_private.runtime_capabilities where last_worker_at>now()-interval '5 minutes'));
end $$;
revoke all on function public.record_sms_health(numeric,boolean,boolean) from public,anon,authenticated;
grant execute on function public.record_sms_health(numeric,boolean,boolean) to service_role;



commit;
