-- Run only in the isolated toursred-external-tests / sms_phase1_full database.
-- All fixtures and configuration changes roll back. No network or real messages.
begin;
do $$
declare actor uuid; traveler uuid; v bigint; result jsonb; challenge uuid:=gen_random_uuid();
 attempt uuid; correlation text:='abcde12345abcde12345'; phone text:='+525599001122';
begin
 if current_database()<>'sms_phase1_full' then raise exception 'Use the local test database'; end if;
 select id into strict actor from public.users where role='admin' and is_active and is_super_admin limit 1;
 select id into strict traveler from public.users where role='traveler' and is_active and email_verified limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
 update public.platform_settings set mfa_required_for_admins=false,phone_verification_required=false,
  sms_habilitado=false,whatsapp_habilitado=false,sms_fallback_habilitado=false,sms_modo_prueba=false,
  sms_proveedor_otp='labsmobile',sms_proveedor_transaccional='labsmobile',sms_proveedor_recordatorios='labsmobile',
  sms_proveedor_respaldo='twilio',sms_limite_diario=1000,sms_limite_mensual=10000 where id is not null;
 update messaging_private.runtime_capabilities set processor_ready=true,otp_enforcement_ready=true where singleton;
 perform public.refresh_sms_provider_capability('labsmobile',true);
 perform public.refresh_sms_provider_capability('twilio',true);
 perform public.refresh_whatsapp_provider_capability('twilio',true);
 select sms_config_version into strict v from public.platform_settings;
 result:=public.update_sms_settings('{"whatsapp_habilitado":true,"phone_verification_required":true}',v);
 assert (result->'settings'->>'whatsapp_habilitado')::boolean;
 assert not (result->'settings'->>'sms_habilitado')::boolean;
 assert (public.phone_verification_policy(traveler,'traveler')->>'required')::boolean;
 raise notice 'ok - WhatsApp alone supports mandatory verification';

 select sms_config_version into strict v from public.platform_settings;
 begin
  perform public.update_sms_settings('{"whatsapp_habilitado":false}',v);
  raise exception 'test failed: both channels disabled with obligation';
 exception when others then
  if sqlerrm not like '%La obligatoriedad requiere%' then raise; end if;
 end;
 begin
  perform public.update_sms_settings('{"whatsapp_proveedor_otp":"labsmobile"}',v);
  raise exception 'test failed: LabsMobile allowed on WhatsApp';
 exception when others then
  if sqlerrm not like '%Proveedor WhatsApp no disponible%' then raise; end if;
 end;
 raise notice 'ok - invalid disabling and LabsMobile are rejected';

 delete from messaging_private.phone_verifications where user_id=traveler;
 delete from messaging_private.rate_limit_buckets where scope in ('otp_user','otp_phone','otp_ip','otp_failures','provider_second','sms_daily','sms_monthly');
 update auth.users set last_sign_in_at=now() where id=traveler;
 perform set_config('request.jwt.claim.sub',traveler::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',traveler,'role','authenticated','aal','aal2')::text,true);
 result:=public.issue_phone_challenge(traveler,challenge,phone,repeat('a',64),repeat('b',64),repeat('c',64),repeat('d',64),false,'sms');
 assert result->>'code'='SMS_UNAVAILABLE';
 result:=public.issue_phone_challenge(traveler,challenge,phone,repeat('a',64),repeat('b',64),repeat('c',64),repeat('d',64),false,'whatsapp');
 assert (result->>'ok')::boolean, result::text;
 assert (select channel='whatsapp' from messaging_private.phone_verifications where id=challenge);
 result:=public.begin_sms_attempt(null,challenge,null,'labsmobile',correlation,'principal',1);
 assert not (result->>'allowed')::boolean;
 result:=public.begin_sms_attempt(null,challenge,null,'twilio',correlation,'principal',1);
 assert (result->>'allowed')::boolean, result::text;
 attempt:=(result->>'attempt_id')::uuid;
 assert (select channel='whatsapp' from messaging_private.notification_attempts where id=attempt);
 assert not public.record_twilio_status(correlation,'SM'||repeat('e',32),phone,'entregado');
 assert public.record_twilio_status(correlation,'SM'||repeat('e',32),'whatsapp:'||phone,'entregado');
 result:=public.verify_phone_challenge(traveler,challenge,repeat('a',64),repeat('b',64));
 assert (result->>'ok')::boolean, result::text;
 raise notice 'ok - WhatsApp challenge, attempt, callback binding and verification';

 update messaging_private.phone_verifications set created_at=now()-interval '61 seconds',expires_at=now()+interval '8 minutes' where id=challenge;
 result:=public.issue_phone_challenge(traveler,gen_random_uuid(),phone,repeat('a',64),repeat('b',64),repeat('c',64),repeat('d',64),false,'sms');
 assert result->>'code'='SMS_UNAVAILABLE';
 select sms_config_version into strict v from public.platform_settings;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform public.update_sms_settings('{"sms_habilitado":true,"sms_fallback_habilitado":true}',v);
 challenge:=gen_random_uuid();
 result:=public.issue_phone_challenge(traveler,challenge,phone,repeat('a',64),repeat('b',64),repeat('c',64),repeat('d',64),false,'sms');
 assert (result->>'ok')::boolean, result::text;
 result:=public.issue_phone_challenge(traveler,gen_random_uuid(),phone,repeat('a',64),repeat('b',64),repeat('c',64),repeat('d',64),false,'whatsapp');
 assert result->>'code'='OTP_COOLDOWN';
 result:=public.begin_sms_attempt(null,challenge,null,'labsmobile','bbcde12345abcde12345','principal',1);
 assert (result->>'allowed')::boolean, result::text;
 perform public.finish_sms_attempt((result->>'attempt_id')::uuid,'fallido',null,'rechazo_confirmado','test');
 result:=public.begin_sms_attempt(null,challenge,null,'twilio','cbcde12345abcde12345','fallback_confirmado',1);
 assert (result->>'allowed')::boolean, result::text;
 raise notice 'ok - SMS preserves LabsMobile primary and Twilio backup';

 select sms_config_version into strict v from public.platform_settings;
 perform public.update_sms_settings('{"sms_proveedor_otp":"twilio","sms_proveedor_transaccional":"twilio","sms_proveedor_recordatorios":"twilio","sms_proveedor_respaldo":"labsmobile"}',v);
 update messaging_private.phone_verifications set created_at=now()-interval '61 seconds',expires_at=now()+interval '8 minutes' where id=challenge;
 challenge:=gen_random_uuid();
 result:=public.issue_phone_challenge(traveler,challenge,phone,repeat('a',64),repeat('b',64),repeat('c',64),repeat('d',64),false,'sms');
 assert (result->>'ok')::boolean, result::text;
 result:=public.begin_sms_attempt(null,challenge,null,'twilio','dbcde12345abcde12345','principal',1);
 assert (result->>'allowed')::boolean, result::text;
 perform public.finish_sms_attempt((result->>'attempt_id')::uuid,'fallido',null,'rechazo_confirmado','test');
 result:=public.begin_sms_attempt(null,challenge,null,'labsmobile','ebcde12345abcde12345','fallback_confirmado',1);
 assert (result->>'allowed')::boolean, result::text;
 raise notice 'ok - SMS supports Twilio primary and LabsMobile backup; cooldown spans channels';

 select sms_config_version into strict v from public.platform_settings;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform public.update_sms_settings('{"phone_verification_required":false,"sms_habilitado":false,"whatsapp_habilitado":false}',v);
 update public.users set phone_verified_at=null,phone_verified_e164=null where id=traveler;
 perform set_config('request.jwt.claim.sub',traveler::text,true);
 assert not (public.phone_verification_policy(traveler,'traveler')->>'pending')::boolean;
 assert public.phone_operation_allowed('traveler');
 assert not has_function_privilege('authenticated','public.issue_phone_challenge(uuid,uuid,text,text,text,text,text,boolean,text)','execute');
 assert not has_function_privilege('anon','public.refresh_whatsapp_provider_capability(text,boolean)','execute');
 raise notice 'ok - both channels and obligation off permit unverified numbers; service RPCs stay private';
end $$;
rollback;
