-- Prueba de la migracion 20261012223925_whatsapp_aviso_por_correo.sql
--
-- La regla: se avisa por correo UNA vez por conversacion. Hay aviso cuando el cliente
-- escribe y (a) es su primer mensaje, (b) el hilo llevaba mas de 4 h sin actividad de
-- nadie, o (c) el aviso anterior quedo pendiente porque el correo fallo. Una rafaga, o
-- un chat en el que el equipo contesta, es UNA conversacion.
--
-- COMO CORRERLA: contra una base DESECHABLE con las TRES migraciones aplicadas en orden
-- (20261012215514, 20261012222646, 20261012223925) y el mismo esquema minimo que
-- `scripts/test-whatsapp-permiso.sql`:
--   psql -d <base> -f scripts/test-whatsapp-aviso.sql
--
-- LIMITES HONESTOS: esquema minimo, no la cadena completa (patron 5 del CLAUDE.md). El
-- reloj se mueve editando `ultimo_mensaje_en` / `aviso_pendiente_desde` como service_role;
-- no se espera tiempo real. La carrera de dos webhooks simultaneos del mismo numero la
-- evita el `for update` de la fila del contacto y NO se probo aqui (requiere dos sesiones).
\set ON_ERROR_STOP on
set client_min_messages = warning;
create or replace function pg_temp.eq(a anyelement, b anyelement, msg text) returns void language plpgsql as
$$ begin if a is distinct from b then raise exception 'FALLA %: esperaba %, obtuvo %', msg, b, a; end if; end $$;

-- sid determinista valido (MM + 32 hex)
create or replace function pg_temp.sid(n int) returns text language sql as $$ select 'MM' || lpad(n::text, 32, '0') $$;
-- manda un mensaje entrante y devuelve el jsonb
create or replace function pg_temp.msg(n int, tel text, cuerpo text default 'hola', nombre text default 'Cliente', media jsonb default '[]')
returns jsonb language sql as
$$ select public.whatsapp_registrar_entrante('whatsapp:' || tel, pg_temp.sid(n), cuerpo, nombre, media) $$;
create or replace function pg_temp.avisa(r jsonb) returns boolean language sql as $$ select (r->>'avisar')::boolean $$;

-- Tiempo: se edita el contacto como service_role (bypassrls)
create or replace function pg_temp.reloj(tel text, actividad interval, pendiente interval default null) returns void language sql as
$$ update public.whatsapp_contactos
      set ultimo_mensaje_en = now() - actividad,
          aviso_pendiente_desde = case when pendiente is null then aviso_pendiente_desde else now() - pendiente end
    where telefono = tel $$;

insert into public.users (id, role, is_active, is_super_admin, phone_verified_e164) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin', true, true, null),
  ('00000000-0000-0000-0000-0000000000b1', 'traveler', true, false, '+525512340001');

set role service_role;

-- 1. Primer mensaje: avisa, y deja el aviso pendiente --------------------------------
select pg_temp.eq(pg_temp.avisa(pg_temp.msg(1, '+5215500000001', 'hola, quiero info')), true, 'primer mensaje avisa');
select pg_temp.eq((select aviso_pendiente_desde is not null from public.whatsapp_contactos where telefono = '+525500000001'), true, 'queda pendiente hasta confirmar');
select pg_temp.eq((select r->'aviso'->>'preview' from (select pg_temp.msg(99, '+5215500000099', 'texto de prueba') r) t), 'texto de prueba', 'el aviso trae la vista previa');
select pg_temp.eq((select r->'aviso'->>'nombre' from (select pg_temp.msg(98, '+5215500000098', 'x', 'Maria') r) t), 'Maria', 'el aviso trae el nombre');

-- 2. Rafaga: el segundo mensaje, con el correo "en vuelo", NO duplica -----------------
select pg_temp.eq(pg_temp.avisa(pg_temp.msg(2, '+5215500000001', 'sigo aqui')), false, 'rafaga: el segundo mensaje no duplica el aviso');
select pg_temp.eq(pg_temp.avisa(pg_temp.msg(3, '+5215500000001', 'y otro mas')), false, 'rafaga: el tercero tampoco');
select pg_temp.eq((select count(*)::int from public.whatsapp_mensajes where telefono = '+525500000001'), 3, 'los 3 mensajes si se guardan');

-- 3. Confirmar: ya salio el correo ----------------------------------------------------------
select public.whatsapp_confirmar_aviso('+525500000001');
select pg_temp.eq((select aviso_pendiente_desde is null and aviso_correo_enviado_en is not null from public.whatsapp_contactos where telefono = '+525500000001'), true, 'confirmar limpia lo pendiente y anota la hora');
select pg_temp.eq(pg_temp.avisa(pg_temp.msg(4, '+5215500000001', 'otro')), false, 'despues de confirmar, un mensaje dentro de la conversacion no avisa');

-- 4. Pregunta nueva horas despues: nueva conversacion -------------------------------------------
select pg_temp.reloj('+525500000001', interval '5 hours');
select pg_temp.eq(pg_temp.avisa(pg_temp.msg(5, '+5215500000001', 'una duda nueva')), true, 'tras 5 h de silencio, avisa de nuevo');
select pg_temp.reloj('+525500000001', interval '3 hours 59 minutes');
select public.whatsapp_confirmar_aviso('+525500000001');
select pg_temp.eq(pg_temp.avisa(pg_temp.msg(6, '+5215500000001', 'casi')), false, 'a 3 h 59 min sigue siendo la misma conversacion');

-- 5. Chat activo: el equipo contesta y el cliente responde enseguida -> NO avisa -------------------------
reset role; set role service_role;
select pg_temp.reloj('+525500000001', interval '30 minutes');
select pg_temp.eq(pg_temp.avisa(pg_temp.msg(7, '+5215500000001', 'gracias!')), false, 'chat activo: el cliente contesta a los 30 min y no avisa');
-- la respuesta del EQUIPO tambien cuenta como actividad: contesta hoy, silencio de 5 h desde ahi
select (select r->>'ok' from (select public.whatsapp_preparar_envio('+525500000001', 'texto', 'con gusto', null, null, '00000000-0000-0000-0000-0000000000a1') r) t);
select public.whatsapp_cerrar_envio((select id from public.whatsapp_mensajes where direccion = 'saliente' order by creado_en desc limit 1), 'MM' || lpad('777', 32, '0'), 'enviando', null);
select pg_temp.eq((select ultimo_mensaje_en > now() - interval '1 minute' from public.whatsapp_contactos where telefono = '+525500000001'), true, 'la respuesta del equipo mueve la actividad');
select pg_temp.reloj('+525500000001', interval '5 hours');
select pg_temp.eq(pg_temp.avisa(pg_temp.msg(8, '+5215500000001', 'otra pregunta')), true, 'si contesto el equipo y luego hay 5 h de silencio, el siguiente mensaje avisa');

-- 6. El correo FALLO: el aviso queda pendiente y se reintenta ---------------------------------------------
select pg_temp.reloj('+525500000001', interval '1 minute', interval '3 minutes');   -- pendiente hace 3 min, sin confirmar
select pg_temp.eq(pg_temp.avisa(pg_temp.msg(9, '+5215500000001', 'ya?')), true, 'correo fallido: el siguiente mensaje lo reintenta aunque este dentro de la conversacion');
select pg_temp.reloj('+525500000001', interval '1 minute', interval '20 seconds');   -- en vuelo hace 20 s
select pg_temp.eq(pg_temp.avisa(pg_temp.msg(10, '+5215500000001', 'otro')), false, 'correo en vuelo (20 s): no se duplica');

-- 7. Reintento de Twilio del MISMO mensaje ------------------------------------------------------------------------
select public.whatsapp_confirmar_aviso('+525500000001');
select pg_temp.eq(pg_temp.avisa(pg_temp.msg(10, '+5215500000001', 'otro')), false, 'duplicado de Twilio con el aviso ya confirmado: no avisa');
select pg_temp.eq((select count(*)::int from public.whatsapp_mensajes where twilio_sid = pg_temp.sid(10)), 1, 'el duplicado no crea otro mensaje');
select pg_temp.reloj('+525500000001', interval '1 minute', interval '5 minutes');   -- quedo pendiente (el correo de ese mensaje fallo)
select pg_temp.eq(pg_temp.avisa(pg_temp.msg(10, '+5215500000001', 'otro')), true, 'duplicado de Twilio con el aviso pendiente: lo reintenta');
select pg_temp.eq((select count(*)::int from public.whatsapp_mensajes where twilio_sid = pg_temp.sid(10)), 1, 'sigue habiendo un solo mensaje con ese SID');
select pg_temp.eq((select no_leidos from public.whatsapp_contactos where telefono = '+525500000001'), (select count(*)::int from public.whatsapp_mensajes where telefono = '+525500000001' and direccion = 'entrante'), 'el duplicado no suma no_leidos');

-- 8. Contactos independientes, usuario enlazado, adjunto solo ----------------------------------------------------
select pg_temp.eq(pg_temp.avisa(pg_temp.msg(20, '+5215500000002', 'soy otro cliente')), true, 'otro numero tiene su propia conversacion');
select pg_temp.eq((select (r->'aviso'->>'es_usuario')::boolean from (select pg_temp.msg(21, '+525512340001', 'soy usuario') r) t), true, 'el aviso dice si es usuario registrado');
select pg_temp.eq((select (r->'aviso'->>'es_usuario')::boolean from (select pg_temp.msg(22, '+5215500000003', 'no soy usuario') r) t), false, 'y si no lo es');
select pg_temp.eq((select r->'aviso'->>'preview' from (select pg_temp.msg(23, '+5215500000004', '', 'Foto', '[{"sid":"ME00000000000000000000000000000001","url":"https://api.twilio.com/x","tipo":"image/jpeg"}]') r) t), '', 'solo adjunto: vista previa vacia');
select pg_temp.eq((select (r->'aviso'->>'num_adjuntos')::int from (select pg_temp.msg(24, '+5215500000005', '', 'Foto', '[{"sid":"ME00000000000000000000000000000002","url":"https://api.twilio.com/y","tipo":"image/jpeg"}]') r) t), 1, 'y cuenta el adjunto');
select pg_temp.eq(length((select r->'aviso'->>'preview' from (select pg_temp.msg(25, '+5215500000006', repeat('x', 900)) r) t)), 200, 'la vista previa se recorta a 200 caracteres');

-- 9. Bloqueado: no se guarda, no se avisa ------------------------------------------------------------------------------
reset role;
update public.whatsapp_contactos set bloqueado = true, bloqueado_en = now() where telefono = '+525500000002';
set role service_role;
select pg_temp.eq((select r->>'estado' from (select pg_temp.msg(30, '+5215500000002', 'estoy bloqueado') r) t), 'bloqueado', 'bloqueado: estado bloqueado');
select pg_temp.eq((select r ? 'avisar' from (select pg_temp.msg(31, '+5215500000002', 'sigo bloqueado') r) t), false, 'bloqueado: ni siquiera hay decision de avisar');

-- 10. Permisos: confirmar_aviso es solo del service_role ----------------------------------------------------------------
reset role; set role authenticated;
do $$ begin
  begin perform public.whatsapp_confirmar_aviso('+525500000001'); raise exception 'FALLA: authenticated llamo whatsapp_confirmar_aviso';
  exception when insufficient_privilege then null; end;
  begin perform public.whatsapp_registrar_entrante('whatsapp:+5215500000009', 'MM' || lpad('555', 32, '0'), 'x', null); raise exception 'FALLA: authenticated llamo whatsapp_registrar_entrante';
  exception when insufficient_privilege then null; end;
end $$;
\echo TODAS_LAS_PRUEBAS_DE_AVISO_OK
