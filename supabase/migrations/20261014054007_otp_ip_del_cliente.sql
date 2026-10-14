-- La IP del limite por hora de los OTP era la de un proxy de Supabase, no la del visitante.
--
-- request-login-otp y request-phone-otp tomaban el ULTIMO salto de x-forwarded-for. Medido el
-- 13-oct-2026: las 11 peticiones OTP del dia salieron de una sola IP (cf-connecting-ip en
-- function_edge_logs), pero rate_limit_buckets registro DOS hashes distintos en la ventana de las 01h
-- y otros dos en la de las 05h. El hash es determinista, asi que el valor hasheado no era el cliente.
-- Consecuencia: el tope de sms_otp_limite_ip_hora contaba por proxy (no frena a nadie y, con trafico
-- real, junta a desconocidos en el mismo contador). Las funciones pasan a usar extraerIpDelCliente()
-- de _shared/contextoAuditoria.ts (cf-connecting-ip primero), igual que otras 60 funciones.
--
-- Ademas, decision de Axel (13-oct-2026): guardar la IP EN CLARO de cada reto para poder rastrear,
-- como ya hacen auth_attempts, failed_login_attempts, audit_logs y user_sessions. El contador del
-- limite sigue usando el hash: ahi solo es una llave de conteo, el rastro vive en phone_verifications.
--
-- p_ip va AL FINAL y con default null: las Edge Functions desplegadas antes de este cambio llaman con
-- 9 argumentos con nombre y siguen funcionando entre la migracion y el deploy (sin IP en claro).
-- La de 9 argumentos se borra para que esas llamadas no sean ambiguas. El envoltorio de 8 argumentos
-- (20261009052107) llama con 9 posicionales y resuelve a esta.
--
-- Rollback: volver a aplicar issue_phone_challenge(9 args) de 20261013043540 (con su revoke/grant de
-- 20261009052107), borrar la de 10 y `alter table messaging_private.phone_verifications drop column ip_address`.

alter table messaging_private.phone_verifications add column if not exists ip_address inet;

drop function public.issue_phone_challenge(uuid,uuid,text,text,text,text,text,boolean,text);

create function public.issue_phone_challenge(p_user uuid,p_id uuid,p_phone text,p_hash text,p_user_hash text,p_phone_hash text,p_ip_hash text,p_simulated boolean,p_channel text,p_ip text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users; s public.platform_settings; c messaging_private.phone_verifications;
 day_start timestamptz:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 hour_start timestamptz:=date_trunc('hour',now());
 ip_cliente inet;
begin
 -- Una IP mal formada no debe impedir el envio del codigo: se guarda null.
 begin ip_cliente:=nullif(btrim(p_ip),'')::inet; exception when invalid_text_representation then ip_cliente:=null; end;
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
 insert into messaging_private.phone_verifications(id,user_id,phone_e164,code_hash,pepper_version,expires_at,is_simulated,channel,ip_address)
 values(p_id,p_user,p_phone,p_hash,1,now()+interval '10 minutes',p_simulated,p_channel,ip_cliente);
 insert into messaging_private.phone_events(user_id,verification_id,event_type) values(p_user,p_id,case when p_simulated then 'simulated' else 'requested' end);
 return jsonb_build_object('ok',true,'challenge_id',p_id,'expires_at',now()+interval '10 minutes','simulated',p_simulated);
end $$;

revoke all on function public.issue_phone_challenge(uuid,uuid,text,text,text,text,text,boolean,text,text) from public,anon,authenticated;
grant execute on function public.issue_phone_challenge(uuid,uuid,text,text,text,text,text,boolean,text,text) to service_role;
