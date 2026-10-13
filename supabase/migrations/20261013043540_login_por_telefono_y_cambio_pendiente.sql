-- Login por telefono (OTP) + cambio de telefono PENDIENTE hasta verificar el numero nuevo.
--
-- Decision de Axel (13-oct-2026): las cuentas con telefono verificado pueden entrar con un codigo por
-- SMS o WhatsApp (viajeros, agencias y administradores); y cambiar el telefono o el correo exige
-- verificar el valor nuevo antes de darlo por bueno.
--
-- 1. Login: dos funciones SOLO para service_role. La sesion NO la abre la base: la abre la Edge
--    Function `verify-login-otp` despues de que verify_phone_challenge confirme el codigo.
-- 2. Interruptor `platform_settings.phone_login_enabled` (default false): se despliega todo apagado y
--    se enciende despues de probar el canje de sesion en staging.
-- 3. Cambio pendiente: antes, issue_phone_challenge escribia el numero nuevo en users.phone_number AL
--    PEDIR el codigo, y el trigger guard_phone_verification_fields borraba la verificacion vigente:
--    una persona que solo tecleaba otro numero perdia el verificado sin haber probado el nuevo.
--    Ahora el vigente se conserva hasta que el codigo del numero nuevo se confirma.
--
-- Rollback: `alter table public.platform_settings drop column phone_login_enabled`, borrar las dos
-- funciones nuevas y volver a aplicar issue_phone_challenge(9 args) de 20261009052107 y
-- verify_phone_challenge de 20261008054539.

alter table public.platform_settings add column if not exists phone_login_enabled boolean not null default false;

create function public.find_user_for_phone_login(p_e164 text) returns uuid
language sql stable security definer set search_path='' as $$
  select id from public.users
   where phone_verified_e164 = p_e164 and phone_verified_e164 is not null
     and coalesce(is_active,false) and coalesce(email_verified,false)
   limit 1;
$$;
revoke all on function public.find_user_for_phone_login(text) from public, anon, authenticated;
grant execute on function public.find_user_for_phone_login(text) to service_role;

create function public.get_login_challenge(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('user_id',user_id,'phone',phone_e164,'pepper_version',pepper_version)
    from messaging_private.phone_verifications
   where id=p_id and status='pendiente' and expires_at>now();
$$;
revoke all on function public.get_login_challenge(uuid) from public, anon, authenticated;
grant execute on function public.get_login_challenge(uuid) to service_role;

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
 -- Cambio PENDIENTE: si ya hay un telefono verificado y el nuevo es otro, el vigente NO se toca hasta
 -- que verify_phone_challenge confirme el codigo en el numero nuevo. Sin telefono verificado no hay
 -- nada que proteger y se conserva el comportamiento de siempre (se guarda al pedir el codigo).
 if u.phone_number is distinct from p_phone and u.phone_verified_e164 is null then
  update public.users set phone_number=p_phone where id=p_user;
  insert into messaging_private.phone_events(user_id,event_type) values(p_user,'number_changed');
 end if;
 insert into messaging_private.phone_verifications(id,user_id,phone_e164,code_hash,pepper_version,expires_at,is_simulated,channel)
 values(p_id,p_user,p_phone,p_hash,1,now()+interval '10 minutes',p_simulated,p_channel);
 insert into messaging_private.phone_events(user_id,verification_id,event_type) values(p_user,p_id,case when p_simulated then 'simulated' else 'requested' end);
 return jsonb_build_object('ok',true,'challenge_id',p_id,'expires_at',now()+interval '10 minutes','simulated',p_simulated);
end $$;


create or replace function public.verify_phone_challenge(p_user uuid,p_id uuid,p_hash text,p_user_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u public.users; c messaging_private.phone_verifications; difference integer:=0; i integer; used_count integer;
 day_start timestamptz:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
begin
 select * into strict u from public.users where id=p_user for update;
 select * into c from messaging_private.phone_verifications where id=p_id and user_id=p_user for update;
 if not coalesce(u.is_active,false) or not coalesce(u.email_verified,false) or c.id is null or c.status<>'pendiente'
 or (c.phone_e164 is distinct from public.normalizar_telefono(u.phone_number) and u.phone_verified_e164 is null) then return jsonb_build_object('ok',false,'code','OTP_INVALID'); end if;
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
  if public.normalizar_telefono(u.phone_number) is distinct from c.phone_e164 then
   -- Cambio pendiente que ahora si se verifico. Dos UPDATE a proposito: guard_phone_verification_fields
   -- borra la verificacion cuando cambia phone_number, asi que la verificacion nueva va despues.
   update public.users set phone_number=c.phone_e164 where id=p_user;
   insert into messaging_private.phone_events(user_id,verification_id,event_type) values(p_user,p_id,'number_changed');
  end if;
  update public.users set phone_verified_at=now(),phone_verified_e164=c.phone_e164 where id=p_user;
 exception when unique_violation then
  update messaging_private.phone_verifications set status='invalidado' where id=p_id;
  return jsonb_build_object('ok',false,'code','PHONE_UNAVAILABLE');
 end;
 update messaging_private.phone_verifications set status='verificado' where id=p_id;
 insert into messaging_private.phone_events(user_id,verification_id,event_type) values(p_user,p_id,'verified');
 return jsonb_build_object('ok',true,'changed',u.phone_verified_e164 is not null and u.phone_verified_e164 is distinct from c.phone_e164);
end $$;


-- Un telefono YA VERIFICADO solo cambia por el motor OTP (issue/verify_phone_challenge): una escritura
-- directa a users.phone_number reemplazaria el numero sin probar el nuevo. Sin telefono verificado
-- (o editando a OTRA persona, caso administrativo) rige la regla de siempre.
create or replace function public.guard_phone_number_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null and new.phone_number is distinct from old.phone_number
 and public.normalizar_telefono(new.phone_number) is distinct from public.normalizar_telefono(old.phone_number)
 and old.phone_number is not null then
   if not messaging_private.recent_phone_auth(auth.uid()) then
     raise exception 'PHONE_REAUTH_REQUIRED: confirma tu identidad (codigo MFA o contrasena) para cambiar el telefono' using errcode='42501';
   end if;
   if auth.uid() = old.id and old.phone_verified_e164 is not null then
     raise exception 'PHONE_CHANGE_REQUIRES_OTP: el telefono verificado solo cambia verificando el numero nuevo con un codigo' using errcode='42501';
   end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_phone_number_change() from public,anon,authenticated;

revoke all on function public.issue_phone_challenge(uuid,uuid,text,text,text,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.issue_phone_challenge(uuid,uuid,text,text,text,text,text,boolean,text) to service_role;
revoke all on function public.verify_phone_challenge(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.verify_phone_challenge(uuid,uuid,text,text) to service_role;
