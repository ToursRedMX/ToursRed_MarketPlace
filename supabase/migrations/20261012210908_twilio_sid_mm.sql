-- El OTP por WhatsApp quedaba en resultado_desconocido para siempre aunque el
-- mensaje llegaba y el codigo validaba. Causa, verificada contra Twilio el
-- 12-oct-2026 (no inferida): Twilio devuelve SIDs con prefijo MM -no SM- para
-- mensajes enviados con ContentSid, que es como sale el OTP de WhatsApp
-- (el del 09-oct era MM11673352...). Las tres funciones de abajo, y el
-- messageSidValid de _shared/mensajeria/proveedores/twilio.ts, exigian ^SM:
-- - al enviar, la Edge Function no reconocia el SID y lo marcaba como
--   twilio_respuesta_ambigua sin guardar provider_message_id;
-- - los dos callbacks de estado que Twilio SI mando (06:14:22 y 06:14:30 UTC)
--   se rechazaron con 400 en sms-webhook-twilio;
-- - sin SID, claim_twilio_reconciliation nunca lo podia volver a consultar.
--
-- Unico cambio: '^SM[0-9a-fA-F]{32}$' -> '^(SM|MM)[0-9a-fA-F]{32}$'. El resto
-- del cuerpo es el de 20261009052107 (record_twilio_status) y 20261009001257
-- (las otras dos), comparado por md5 contra prosrc de la base antes de editar:
-- los tres coincidian. create or replace conserva los grants.
begin;

create or replace function public.record_twilio_status(p_correlation text,p_sid text,p_destination text,p_state text,p_code text default null,p_cost numeric default null,p_unit text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare a messaging_private.notification_attempts; destination text; event_key text; inserted bigint;
begin
  if p_sid is null or p_sid !~ '^(SM|MM)[0-9a-fA-F]{32}$' or p_state is null or p_state not in ('aceptado','enviado','entregado','fallido') then raise exception 'Evento invalido'; end if;
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

create or replace function public.claim_twilio_reconciliation(p_limit integer default 5)
returns table(correlation_id text,provider_message_id text)
language plpgsql security definer set search_path='' as $$
begin
  return query with candidates as (
    select a.id from messaging_private.notification_attempts a
    where a.provider='twilio' and not a.is_simulated and a.provider_message_id ~ '^(SM|MM)[0-9a-fA-F]{32}$'
      and (a.status in ('aceptado','enviado','resultado_desconocido') or (a.status in ('entregado','fallido') and a.cost is null))
      and a.created_at>now()-interval '24 hours' and a.created_at<now()-interval '1 minute'
      and a.reconciliation_count<24 and (a.reconciled_at is null or a.reconciled_at<now()-interval '5 minutes')
    order by a.reconciled_at nulls first,a.created_at limit greatest(1,least(coalesce(p_limit,5),20)) for update skip locked
  ) update messaging_private.notification_attempts a set reconciled_at=now(),reconciliation_count=a.reconciliation_count+1
    from candidates c where a.id=c.id returning a.correlation_id,a.provider_message_id;
end $$;

create or replace function public.finish_sms_attempt(p_attempt uuid,p_state text,p_provider_id text default null,p_class text default null,p_code text default null)
returns void language plpgsql security definer set search_path='' as $$
declare a messaging_private.notification_attempts;
begin
  if p_state not in ('aceptado','simulado','fallido','resultado_desconocido') or p_state is null then raise exception 'Estado invalido'; end if;
  if (p_state='fallido' and (p_class is null or p_class not in ('permanente','rechazo_confirmado'))) or (p_state<>'fallido' and p_class is not null) then raise exception 'Clasificacion invalida'; end if;
  select * into strict a from messaging_private.notification_attempts where id=p_attempt for update;
  if a.is_simulated and p_state not in ('simulado','fallido','resultado_desconocido') then raise exception 'Simulacion no acredita entrega'; end if;
  if a.provider='twilio' and not a.is_simulated and p_provider_id is not null then
    if p_provider_id !~ '^(SM|MM)[0-9a-fA-F]{32}$' or (a.provider_message_id is not null and a.provider_message_id<>p_provider_id) then raise exception 'SID incompatible'; end if;
    update messaging_private.notification_attempts set provider_message_id=p_provider_id where id=a.id;
  end if;
  -- Callback can beat the HTTP response; never downgrade delivered/sent/failed.
  if a.status in ('procesando','resultado_desconocido') then
    update messaging_private.notification_attempts set status=p_state,provider_message_id=coalesce(left(p_provider_id,100),provider_message_id),failure_class=p_class,error_code=left(p_code,80),updated_at=now() where id=p_attempt;
  end if;
end $$;

commit;
