-- Prueba de la migracion 20261012222646_whatsapp_bandeja_permiso.sql
--
-- Cubre: quien queda autorizado por cada via (super_admin, admin con permiso,
-- agente de soporte), el default por rol que pone el TRIGGER, que un valor
-- explicito se respeta, y que RLS, las RPC del panel, el bucket y el envio
-- apliquen LA MISMA regla.
--
-- COMO CORRERLA: contra una base DESECHABLE, con las dos migraciones aplicadas en
-- orden y el mismo esquema minimo que `scripts/test-whatsapp-bandeja.sql` (mas
-- `users(role, is_active)`, `admin_permissions`, `support_agent_permissions` y el
-- enum `support_agent_role`):
--   psql -d <base> -v ON_ERROR_STOP=1 -f supabase/migrations/20261012215514_whatsapp_bandeja_entrante.sql
--   psql -d <base> -v ON_ERROR_STOP=1 -f supabase/migrations/20261012222646_whatsapp_bandeja_permiso.sql
--   psql -d <base> -f scripts/test-whatsapp-permiso.sql
--
-- LIMITES HONESTOS: esquema minimo, no la cadena completa de migraciones (patron 5
-- del CLAUDE.md). El relleno de agentes de soporte YA existentes (el UPDATE de la
-- migracion) no se puede repetir aqui porque la base ya esta migrada; se comprobo
-- aparte insertando agentes ANTES de aplicar la migracion.
\set ON_ERROR_STOP on
set client_min_messages = warning;
create or replace function pg_temp.eq(a anyelement, b anyelement, msg text) returns void language plpgsql as
$$ begin if a is distinct from b then raise exception 'FALLA %: esperaba %, obtuvo %', msg, b, a; end if; end $$;
grant usage on schema storage to authenticated; grant select on storage.objects to authenticated; -- Supabase lo concede por defecto

-- Personas ---------------------------------------------------------------
insert into public.users (id, role, is_active, is_super_admin) values
  ('00000000-0000-0000-0000-00000000000a', 'admin',    true,  true),   -- super admin
  ('00000000-0000-0000-0000-00000000000b', 'admin',    true,  false),  -- admin sin nada
  ('00000000-0000-0000-0000-00000000000c', 'admin',    true,  false),  -- admin con permiso
  ('00000000-0000-0000-0000-00000000000d', 'admin',    true,  false),  -- admin con fila en false
  ('00000000-0000-0000-0000-0000000000e1', 'admin',    true,  false),  -- soporte supervisor
  ('00000000-0000-0000-0000-0000000000e2', 'admin',    true,  false),  -- soporte agente
  ('00000000-0000-0000-0000-0000000000e3', 'admin',    true,  false),  -- soporte lectura
  ('00000000-0000-0000-0000-0000000000e4', 'admin',    true,  false),  -- soporte super_admin
  ('00000000-0000-0000-0000-0000000000e5', 'admin',    true,  false),  -- agente INACTIVO
  ('00000000-0000-0000-0000-0000000000e6', 'admin',    true,  false),  -- agente con false explicito
  ('00000000-0000-0000-0000-0000000000e7', 'admin',    true,  false),  -- lectura con true explicito
  ('00000000-0000-0000-0000-0000000000f1', 'traveler', true,  false),  -- NO admin, con fila de soporte
  ('00000000-0000-0000-0000-0000000000f2', 'admin',    false, false),  -- admin BLOQUEADO con permiso
  ('00000000-0000-0000-0000-0000000000f3', 'admin',    false, true),   -- super admin BLOQUEADO
  ('00000000-0000-0000-0000-0000000000f4', 'admin',    false, false),  -- agente de soporte BLOQUEADO
  ('00000000-0000-0000-0000-0000000000f5', 'traveler', true,  false);  -- NO admin, con fila de admin_permissions

insert into public.admin_permissions (user_id, can_manage_whatsapp) values
  ('00000000-0000-0000-0000-00000000000c', true),
  ('00000000-0000-0000-0000-00000000000d', false),
  ('00000000-0000-0000-0000-0000000000f2', true),
  ('00000000-0000-0000-0000-0000000000f5', true);

-- Los INSERT NO mencionan can_manage_whatsapp salvo en e6/e7: lo pone el trigger.
insert into public.support_agent_permissions (user_id, rol_soporte) values
  ('00000000-0000-0000-0000-0000000000e1', 'supervisor'),
  ('00000000-0000-0000-0000-0000000000e2', 'agente'),
  ('00000000-0000-0000-0000-0000000000e3', 'lectura'),
  ('00000000-0000-0000-0000-0000000000e4', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000f1', 'agente'),
  ('00000000-0000-0000-0000-0000000000f4', 'supervisor');
insert into public.support_agent_permissions (user_id, rol_soporte, activo) values
  ('00000000-0000-0000-0000-0000000000e5', 'agente', false);
insert into public.support_agent_permissions (user_id, rol_soporte, can_manage_whatsapp) values
  ('00000000-0000-0000-0000-0000000000e6', 'agente', false),
  ('00000000-0000-0000-0000-0000000000e7', 'lectura', true);

-- Default por rol (trigger) ----------------------------------------------
select pg_temp.eq((select can_manage_whatsapp from public.support_agent_permissions where rol_soporte = 'supervisor'  and user_id::text like '%e1'), true,  'supervisor: encendido por defecto');
select pg_temp.eq((select can_manage_whatsapp from public.support_agent_permissions where user_id::text like '%e2'), true,  'agente: encendido por defecto');
select pg_temp.eq((select can_manage_whatsapp from public.support_agent_permissions where user_id::text like '%e4'), true,  'rol super_admin de soporte: encendido por defecto');
select pg_temp.eq((select can_manage_whatsapp from public.support_agent_permissions where user_id::text like '%e3'), false, 'lectura: apagado por defecto');
select pg_temp.eq((select can_manage_whatsapp from public.support_agent_permissions where user_id::text like '%e6'), false, 'un false explicito se respeta aunque sea agente');
select pg_temp.eq((select can_manage_whatsapp from public.support_agent_permissions where user_id::text like '%e7'), true,  'un true explicito se respeta aunque sea lectura');

-- Quien queda autorizado ---------------------------------------------------
create or replace function pg_temp.aut(u text) returns boolean language sql as
$$ select public.whatsapp_usuario_autorizado(('00000000-0000-0000-0000-' || u)::uuid) $$;
select pg_temp.eq(pg_temp.aut('00000000000a'), true,  'super admin');
select pg_temp.eq(pg_temp.aut('00000000000b'), false, 'admin sin permiso');
select pg_temp.eq(pg_temp.aut('00000000000c'), true,  'admin con can_manage_whatsapp');
select pg_temp.eq(pg_temp.aut('00000000000d'), false, 'admin con la casilla apagada');
select pg_temp.eq(pg_temp.aut('0000000000e1'), true,  'agente supervisor');
select pg_temp.eq(pg_temp.aut('0000000000e2'), true,  'agente agente');
select pg_temp.eq(pg_temp.aut('0000000000e3'), false, 'agente lectura');
select pg_temp.eq(pg_temp.aut('0000000000e4'), true,  'agente super_admin');
select pg_temp.eq(pg_temp.aut('0000000000e5'), false, 'agente INACTIVO no pasa');
select pg_temp.eq(pg_temp.aut('0000000000e6'), false, 'agente con permiso apagado a mano');
select pg_temp.eq(pg_temp.aut('0000000000e7'), true,  'lectura con permiso encendido a mano');
select pg_temp.eq(pg_temp.aut('0000000000f1'), false, 'quien no es admin no pasa aunque tenga fila de soporte');
select pg_temp.eq(pg_temp.aut('0000000000f5'), false, 'quien no es admin no pasa aunque tenga can_manage_whatsapp en admin_permissions');
select pg_temp.eq(pg_temp.aut('0000000000f2'), false, 'admin bloqueado no pasa aunque tenga permiso');
select pg_temp.eq(pg_temp.aut('0000000000f3'), false, 'super admin bloqueado no pasa');
select pg_temp.eq(pg_temp.aut('0000000000f4'), false, 'agente de soporte bloqueado no pasa');
select pg_temp.eq(public.whatsapp_usuario_autorizado(null), false, 'NULL no autoriza');
select pg_temp.eq(public.whatsapp_usuario_autorizado(gen_random_uuid()), false, 'usuario inexistente');

-- Datos para RLS, RPC y bucket ---------------------------------------------
set role service_role;
select public.whatsapp_registrar_entrante('whatsapp:+5215500000001', 'MM11111111111111111111111111111111', 'hola', 'Cliente', '[]');
reset role;
insert into storage.objects (bucket_id, name) values ('whatsapp-media', '525500000001/x/a.jpg'), ('otro-bucket', 'y.jpg');

-- RLS ------------------------------------------------------------------------
set role authenticated;
create or replace function pg_temp.vistos(u text) returns integer language plpgsql as
$$ begin perform set_config('test.uid', '00000000-0000-0000-0000-' || u, false); return (select count(*)::int from public.whatsapp_mensajes); end $$;
select pg_temp.eq(pg_temp.vistos('0000000000e1'), 1, 'supervisor ve los mensajes');
select pg_temp.eq(pg_temp.vistos('0000000000e2'), 1, 'agente ve los mensajes');
select pg_temp.eq(pg_temp.vistos('00000000000c'), 1, 'admin con permiso ve los mensajes');
select pg_temp.eq(pg_temp.vistos('00000000000a'), 1, 'super admin ve los mensajes');
select pg_temp.eq(pg_temp.vistos('0000000000e3'), 0, 'lectura NO ve los mensajes');
select pg_temp.eq(pg_temp.vistos('00000000000b'), 0, 'admin sin permiso NO ve los mensajes');
select pg_temp.eq(pg_temp.vistos('0000000000e5'), 0, 'agente inactivo NO ve los mensajes');
select set_config('test.uid', '00000000-0000-0000-0000-0000000000e2', false);
select pg_temp.eq((select count(*)::int from public.whatsapp_contactos), 1, 'agente ve los contactos');
select pg_temp.eq((select count(*)::int from storage.objects where bucket_id = 'whatsapp-media'), 1, 'agente ve el bucket de WhatsApp');
select pg_temp.eq((select count(*)::int from storage.objects where bucket_id = 'otro-bucket'), 0, 'la politica es SOLO del bucket de WhatsApp');
select set_config('test.uid', '00000000-0000-0000-0000-0000000000e3', false);
select pg_temp.eq((select count(*)::int from storage.objects), 0, 'lectura NO ve el bucket');

-- RPC del panel ------------------------------------------------------------------
select set_config('test.uid', '00000000-0000-0000-0000-0000000000e3', false);
do $$ begin
  begin perform public.whatsapp_marcar_leido('+525500000001'); raise exception 'FALLA: lectura marco leido';
  exception when insufficient_privilege then null; end;
  begin perform public.whatsapp_bloquear_contacto('+525500000001', true, 'x'); raise exception 'FALLA: lectura bloqueo';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000e2', false);
select public.whatsapp_marcar_leido('+525500000001');
select public.whatsapp_bloquear_contacto('+525500000001', true, 'spam');
select pg_temp.eq((select bloqueado from public.whatsapp_contactos), true, 'agente puede bloquear');
select public.whatsapp_bloquear_contacto('+525500000001', false);
select pg_temp.eq(public.can_use_whatsapp_inbox(), true, 'can_use_whatsapp_inbox: agente');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.eq(public.can_use_whatsapp_inbox(), false, 'can_use_whatsapp_inbox: admin sin permiso');
do $$ begin
  begin perform public.whatsapp_usuario_autorizado('00000000-0000-0000-0000-0000000000e2'); raise exception 'FALLA: authenticated llamo a la funcion de service_role';
  exception when insufficient_privilege then null; end;
end $$;

-- Envio: la base tambien exige el permiso -------------------------------------------
reset role; set role service_role;
select pg_temp.eq((select r->>'codigo' from (select public.whatsapp_preparar_envio('+525500000001','texto','hola',null,null,'00000000-0000-0000-0000-0000000000e3') r) t), 'NO_AUTORIZADO', 'envio: lectura rechazado en la base');
select pg_temp.eq((select r->>'codigo' from (select public.whatsapp_preparar_envio('+525500000001','texto','hola',null,null,'00000000-0000-0000-0000-00000000000b') r) t), 'NO_AUTORIZADO', 'envio: admin sin permiso rechazado');
select pg_temp.eq((select r->>'ok' from (select public.whatsapp_preparar_envio('+525500000001','texto','hola',null,null,'00000000-0000-0000-0000-0000000000e1') r) t), 'true', 'envio: supervisor puede');
select pg_temp.eq((select r->>'ok' from (select public.whatsapp_preparar_envio('+525500000001','texto','hola',null,null,'00000000-0000-0000-0000-00000000000c') r) t), 'true', 'envio: admin con permiso puede');
\echo TODAS_LAS_PRUEBAS_DE_PERMISO_OK
