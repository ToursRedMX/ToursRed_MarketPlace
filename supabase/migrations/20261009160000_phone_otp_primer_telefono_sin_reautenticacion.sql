-- issue_phone_challenge exigia haber iniciado sesion hace menos de 10 minutos siempre que
-- el telefono pedido fuera "distinto" del que tiene el perfil. Con un perfil SIN telefono
-- (phone_number NULL) esa comparacion da verdadero para cualquier numero:
--   normalizar_telefono(NULL) IS DISTINCT FROM '+52...'  ->  true
-- asi que la primera verificacion de alguien que llevaba mas de 10 minutos en el formulario
-- de registro social fallaba con PHONE_REAUTH_REQUIRED ("para cambiar el telefono, cierra
-- sesion..."), aunque nunca hubiera tenido un telefono que cambiar.
--
-- La proteccion es contra CAMBIAR un telefono existente (secuestro de sesion); poner el
-- primero no cambia nada. El disparador guard_phone_number_change ya lo distingue
-- (`old.phone_number is not null`); esta funcion se le habia quedado atras.
--
-- Unico cambio respecto a la version anterior: la condicion de reautenticacion exige
-- `u.phone_number is not null`. Sin cambio de firma, permisos ni dueño (CREATE OR REPLACE).
-- Rollback: volver a aplicar la funcion de 20261008054539_phone_otp_enforcement.sql.

create or replace function public.issue_phone_challenge(p_user uuid,p_id uuid,p_phone text,p_hash text,p_user_hash text,p_phone_hash text,p_ip_hash text,p_simulated boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.users; s public.platform_settings; c messaging_private.phone_verifications;
 day_start timestamptz:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 hour_start timestamptz:=date_trunc('hour',now());
begin
 select * into strict u from public.users where id=p_user for update;
 select * into strict s from public.platform_settings;
 if not coalesce(u.is_active,false) or not coalesce(u.email_verified,false) then return jsonb_build_object('ok',false,'code','EMAIL_OR_ACCOUNT_REQUIRED'); end if;
 if not s.sms_habilitado or p_simulated is distinct from s.sms_modo_prueba then return jsonb_build_object('ok',false,'code','SMS_UNAVAILABLE'); end if;
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
 insert into messaging_private.phone_verifications(id,user_id,phone_e164,code_hash,pepper_version,expires_at,is_simulated)
 values(p_id,p_user,p_phone,p_hash,1,now()+interval '10 minutes',p_simulated);
 insert into messaging_private.phone_events(user_id,verification_id,event_type) values(p_user,p_id,case when p_simulated then 'simulated' else 'requested' end);
 return jsonb_build_object('ok',true,'challenge_id',p_id,'expires_at',now()+interval '10 minutes','simulated',p_simulated);
end $$;
