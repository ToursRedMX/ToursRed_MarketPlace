-- Prueba de comportamiento de la migracion 20261012230000_whatsapp_bandeja_entrante.sql
--
-- Cubre: telefono canonico (el "1" de moviles MX), deduplicacion de reintentos de
-- Twilio, enlace con `users`, bloqueo (no guarda, solo cuenta), ventana de 24 h,
-- plantillas fuera de ventana, estados que solo avanzan y permisos por rol (RLS).
--
-- COMO CORRERLA: contra una base DESECHABLE, nunca contra la de Supabase.
--   psql -d <base_desechable> -v ON_ERROR_STOP=1 -f supabase/migrations/20261012230000_whatsapp_bandeja_entrante.sql
--   psql -d <base_desechable> -f scripts/test-whatsapp-bandeja.sql
-- La base necesita los roles anon/authenticated/service_role con los privilegios por
-- defecto de Supabase sobre `public`, `public.users(id, is_super_admin,
-- phone_verified_e164)`, `public.is_super_admin()`, `auth.uid()` (aqui lee
-- `current_setting('test.uid')`), `storage.buckets/objects` y la publicacion
-- `supabase_realtime`.
--
-- LIMITE HONESTO: se ejecuto con un esquema MINIMO que imita esas dependencias, no
-- con la cadena completa de migraciones (patron 5 del CLAUDE.md: una fixture mas
-- pobre que produccion puede esconder un bug). Cubre la logica de la migracion, no
-- su interaccion con triggers de `users` ni con el resto del esquema.
-- Se verifico que cae al mutar el chequeo de bloqueo, la ventana de 24 h y el
-- avance de estados (las tres mutaciones se aplicaron y las tres fueron atrapadas).
\set ON_ERROR_STOP on
set client_min_messages = warning;
create or replace function pg_temp.eq(a anyelement, b anyelement, msg text) returns void language plpgsql as
$$ begin if a is distinct from b then raise exception 'FALLA %: esperaba %, obtuvo %', msg, b, a; end if; end $$;

-- Datos: un super_admin, un admin normal, un viajero con el telefono SIN el 1 y otro duplicado
insert into public.users values ('00000000-0000-0000-0000-0000000000a1', true,  null),
                                ('00000000-0000-0000-0000-0000000000a2', false, null),
                                ('00000000-0000-0000-0000-0000000000b1', false, '+525513209470');

select pg_temp.eq(public.whatsapp_telefono_canonico('whatsapp:+5215513209470'), '+525513209470', 'canonico quita el 1 movil MX');
select pg_temp.eq(public.whatsapp_telefono_canonico('+525513209470'), '+525513209470', 'canonico respeta sin 1');
select pg_temp.eq(public.whatsapp_telefono_canonico('whatsapp:+14155550100'), '+14155550100', 'canonico no toca otros paises');
select pg_temp.eq(public.whatsapp_telefono_canonico('basura'), null::text, 'canonico invalido es null');
select pg_temp.eq(public.whatsapp_telefono_canonico(null), null::text, 'canonico null');

set role service_role;
-- 1. entrante con adjunto; enlaza al usuario por telefono verificado
select pg_temp.eq((select r->>'estado' from (select public.whatsapp_registrar_entrante(
  'whatsapp:+5215513209470','MM11673352c9e4528429caf8313b2a0afb','Hola, tengo una duda','Axel',
  '[{"sid":"ME0000000000000000000000000000000a","url":"https://api.twilio.com/2010-04-01/Accounts/ACx/Messages/MMx/Media/MEx","tipo":"image/jpeg"}]') r) t), 'ok', 'primer entrante');
select pg_temp.eq((select user_id::text from public.whatsapp_contactos where telefono='+525513209470'), '00000000-0000-0000-0000-0000000000b1', 'enlaza usuario con numero canonico');
select pg_temp.eq((select telefono_twilio from public.whatsapp_contactos), '+5215513209470', 'conserva el numero tal como lo mando Twilio');
select pg_temp.eq((select no_leidos from public.whatsapp_contactos), 1, 'no_leidos = 1');
select pg_temp.eq((select count(*)::int from public.whatsapp_adjuntos where estado='pendiente'), 1, 'adjunto pendiente');
select pg_temp.eq((select tipo from public.whatsapp_mensajes), 'texto', 'tipo texto');

-- 2. reintento de Twilio: duplicado, no suma no_leidos, devuelve el adjunto pendiente
select pg_temp.eq((select r->>'estado' from (select public.whatsapp_registrar_entrante(
  'whatsapp:+5215513209470','MM11673352c9e4528429caf8313b2a0afb','Hola, tengo una duda','Axel','[]') r) t), 'duplicado', 'reintento es duplicado');
select pg_temp.eq((select count(*)::int from public.whatsapp_mensajes), 1, 'sin mensaje duplicado');
select pg_temp.eq((select no_leidos from public.whatsapp_contactos), 1, 'duplicado no suma no_leidos');

-- 3. solo media, sin texto -> tipo media
select public.whatsapp_registrar_entrante('whatsapp:+5215513209470','SM22222222222222222222222222222222','', null,
  '[{"sid":"ME0000000000000000000000000000000b","url":"https://api.twilio.com/x","tipo":"application/pdf"}]');
select pg_temp.eq((select tipo from public.whatsapp_mensajes where twilio_sid like 'SM2%'), 'media', 'solo media => tipo media');

-- 4. invalidos
select pg_temp.eq((select r->>'estado' from (select public.whatsapp_registrar_entrante('basura','MM11673352c9e4528429caf8313b2a0afb','x',null) r) t), 'invalido', 'from invalido');
select pg_temp.eq((select r->>'estado' from (select public.whatsapp_registrar_entrante('whatsapp:+5215513209470','XX123','x',null) r) t), 'invalido', 'sid invalido');

-- 5. ventana de 24 h
select pg_temp.eq((select r->>'ok' from (select public.whatsapp_preparar_envio('+525513209470','texto','Claro, te ayudo',null,null,'00000000-0000-0000-0000-0000000000a1') r) t), 'true', 'responde dentro de la ventana');
reset role;
update public.whatsapp_contactos set ultimo_entrante_en = now() - interval '25 hours';
set role service_role;
select pg_temp.eq((select r->>'codigo' from (select public.whatsapp_preparar_envio('+525513209470','texto','tarde',null,null,'00000000-0000-0000-0000-0000000000a1') r) t), 'VENTANA_CERRADA', 'fuera de ventana');
select pg_temp.eq((select r->>'codigo' from (select public.whatsapp_preparar_envio('+525513209470','plantilla',null,gen_random_uuid(),null,'00000000-0000-0000-0000-0000000000a1') r) t), 'PLANTILLA_NO_DISPONIBLE', 'plantilla inexistente');
reset role;
insert into public.whatsapp_plantillas (id, nombre, content_sid, cuerpo_ejemplo, variables) values
  ('11111111-1111-1111-1111-111111111111','seguimiento','HX0123456789abcdef0123456789abcdef','Hola {{1}}',1);
set role service_role;
select pg_temp.eq((select r->>'codigo' from (select public.whatsapp_preparar_envio('+525513209470','plantilla',null,'11111111-1111-1111-1111-111111111111','{}','00000000-0000-0000-0000-0000000000a1') r) t), 'VARIABLES_INVALIDAS', 'plantilla sin variable');
select pg_temp.eq((select r->>'ok' from (select public.whatsapp_preparar_envio('+525513209470','plantilla',null,'11111111-1111-1111-1111-111111111111','{"1":"Axel"}','00000000-0000-0000-0000-0000000000a1') r) t), 'true', 'plantilla fuera de ventana SI se puede');

-- 6. cerrar envio y estados que solo avanzan
select public.whatsapp_cerrar_envio((select id from public.whatsapp_mensajes where direccion='saliente' and tipo='texto'), 'SM33333333333333333333333333333333', 'enviando', null);
select pg_temp.eq(public.whatsapp_registrar_estado('SM33333333333333333333333333333333','entregado'), true, 'entregado avanza');
select pg_temp.eq(public.whatsapp_registrar_estado('SM33333333333333333333333333333333','enviado'), false, 'enviado NO retrocede');
select pg_temp.eq(public.whatsapp_registrar_estado('SM33333333333333333333333333333333','leido'), true, 'leido avanza');
select pg_temp.eq(public.whatsapp_registrar_estado('SM33333333333333333333333333333333','fallido','twilio_63016'), false, 'fallido no pisa un leido');
select pg_temp.eq(public.whatsapp_registrar_estado('SM99999999999999999999999999999999','leido'), false, 'sid desconocido');

-- 7. permisos: authenticated NO puede llamar RPCs de service_role ni escribir tablas
reset role; set role authenticated;
do $$ begin
  begin perform public.whatsapp_registrar_entrante('whatsapp:+5215500000000','MM44444444444444444444444444444444','x',null); raise exception 'FALLA: authenticated llamo registrar_entrante';
  exception when insufficient_privilege then null; end;
  begin insert into public.whatsapp_mensajes (telefono,direccion,estado) values ('+525513209470','entrante','recibido'); raise exception 'FALLA: authenticated inserto';
  exception when insufficient_privilege then null; end;
end $$;
-- admin normal (no super): ve 0 filas y no puede bloquear
select set_config('test.uid','00000000-0000-0000-0000-0000000000a2', false);
select pg_temp.eq((select count(*)::int from public.whatsapp_mensajes), 0, 'admin normal no ve mensajes (RLS)');
do $$ begin
  begin perform public.whatsapp_bloquear_contacto('+525513209470', true, 'x'); raise exception 'FALLA: admin normal bloqueo';
  exception when insufficient_privilege then null; end;
end $$;
-- super admin: ve y bloquea
select set_config('test.uid','00000000-0000-0000-0000-0000000000a1', false);
select pg_temp.eq((select count(*)::int > 0 from public.whatsapp_mensajes), true, 'super admin ve mensajes');
select public.whatsapp_marcar_leido('+525513209470');
select pg_temp.eq((select no_leidos from public.whatsapp_contactos), 0, 'marcar leido');
select public.whatsapp_bloquear_contacto('+525513209470', true, 'spam');
select pg_temp.eq((select bloqueado_por::text from public.whatsapp_contactos), '00000000-0000-0000-0000-0000000000a1', 'registra quien bloqueo');

-- 8. bloqueado: no guarda, solo cuenta; tampoco se puede responderle
reset role; set role service_role;
select pg_temp.eq((select count(*)::int from public.whatsapp_mensajes), 4, 'antes del bloqueado');
select pg_temp.eq((select r->>'estado' from (select public.whatsapp_registrar_entrante('whatsapp:+5215513209470','MM55555555555555555555555555555555','mensaje de bloqueado','Axel') r) t), 'bloqueado', 'bloqueado');
select pg_temp.eq((select count(*)::int from public.whatsapp_mensajes), 4, 'bloqueado NO guarda el mensaje');
select pg_temp.eq((select descartados_bloqueado from public.whatsapp_contactos), 1, 'cuenta el descartado');
select pg_temp.eq((select r->>'codigo' from (select public.whatsapp_preparar_envio('+525513209470','texto','hola',null,null,'00000000-0000-0000-0000-0000000000a1') r) t), 'CONTACTO_BLOQUEADO', 'no se responde a bloqueado');

-- 9. desbloquear y volver a recibir
reset role; set role authenticated; select set_config('test.uid','00000000-0000-0000-0000-0000000000a1', false);
select public.whatsapp_bloquear_contacto('+525513209470', false);
select pg_temp.eq((select bloqueado_en::text from public.whatsapp_contactos), null::text, 'desbloqueo limpia bloqueado_en');
reset role; set role service_role;
select pg_temp.eq((select r->>'estado' from (select public.whatsapp_registrar_entrante('whatsapp:+5215513209470','MM66666666666666666666666666666666','ya desbloqueado',null) r) t), 'ok', 'recibe tras desbloquear');
\echo TODAS_LAS_PRUEBAS_OK
