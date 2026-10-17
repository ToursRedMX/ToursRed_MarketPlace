-- Las notificaciones de SMS de reserva (confirmacion/recordatorio) ya tenian
-- un mecanismo de preferencia completo (messaging_private.notification_preferences,
-- get_my_sms_preferences/set_my_sms_preferences, SmsPreferences.tsx) desde las
-- migraciones 20261008045859/20261008061340 -- pero quedo DEFAULT ON: sin fila
-- en la tabla, queue_booking_sms y prepare_sms_notification dejaban pasar el
-- envio igual. El componente ademas solo vivia en VerifyPhonePage.tsx, nunca
-- en los perfiles de viajero/agencia, asi que casi nadie lo habia visto.
--
-- Pedido de Axel (17-oct-2026): apagadas por default, que quien las quiera
-- las prenda desde su perfil (viajero o agencia, el mecanismo ya es agnostico
-- de rol -- se guarda por auth.uid()).
--
-- 0 filas en notification_preferences hoy (comprobado antes de escribir esto):
-- nadie la habia usado, asi que invertir el default no deja a nadie en un
-- estado intermedio -- no hace falta backfill.
--
-- El OTP (login / verificar telefono) NO pasa por notification_preferences en
-- ningun punto -- va por notification_attempts con category='otp', nunca por
-- notification_outbox/queue_booking_sms (confirmado leyendo las 4 funciones
-- que tocan transactional_enabled en todo el esquema: queue_booking_sms,
-- prepare_sms_notification, get_my_sms_preferences, set_my_sms_preferences).
-- Este cambio no lo toca.
--
-- Lo que SI queda fuera de alcance: las agencias hoy no reciben NINGUN SMS de
-- reserva (su aviso de "nueva reserva" es por correo, send-booking-confirmation,
-- un camino totalmente distinto que no pasa por mensajeria/notification_preferences).
-- Exponer el toggle en su perfil deja la preferencia lista para cuando exista
-- un envio de SMS a agencias, pero no se construye ese envio aqui -- no fue lo
-- que se pidio.

ALTER TABLE messaging_private.notification_preferences
  ALTER COLUMN transactional_enabled SET DEFAULT false;

CREATE OR REPLACE FUNCTION public.get_my_sms_preferences()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select transactional_enabled from messaging_private.notification_preferences where user_id=auth.uid() and application='toursred' and channel='sms'),false) where auth.uid() is not null;
$function$;

CREATE OR REPLACE FUNCTION public.queue_booking_sms(p_booking uuid, p_category text DEFAULT 'reserva_confirmada'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare snap jsonb; timing jsonb; u public.users; s public.platform_settings; departure timestamptz; message_id uuid; key text; expiry timestamptz;
begin
 select * into strict s from public.platform_settings;
 if not s.sms_habilitado then return null; end if;
 if p_category not in ('reserva_confirmada','recordatorio_tour') or p_category is null then raise exception 'Categoria invalida'; end if;
 snap:=messaging_private.booking_sms_snapshot(p_booking);
 if not (snap->>'eligible')::boolean then return null; end if;
 select * into u from public.users where id=(snap->>'user_id')::uuid;
 if not coalesce(u.is_active,false) or u.phone_verified_at is null or u.phone_verified_e164 is null then return null; end if;
 -- Invertido: antes "bloquear si hay fila y dice que no"; ahora "permitir SOLO
 -- si hay fila y dice que si" -- sin fila, no se manda.
 if not exists(select 1 from messaging_private.notification_preferences where user_id=u.id and application='toursred' and channel='sms' and transactional_enabled) then return null; end if;
 departure:=(snap->>'departure_at')::timestamptz;
 if departure<=now() or (snap->>'departure_date')::date<current_date then return null; end if;
 if p_category='recordatorio_tour' then
  if departure is null then perform messaging_private.alert('missing_schedule'); return null; end if;
  timing:=messaging_private.reminder_window((snap->>'departure_date')::date,(snap->>'departure_time')::time,snap->>'time_zone',s.sms_hora_recordatorio_local,now());
  if not coalesce((timing->>'allowed')::boolean,false) then return null; end if;
  key:='recordatorio_tour:'||p_booking||':'||to_char(departure at time zone 'UTC','YYYYMMDDHH24MISS');
  expiry:=(timing->>'expiry')::timestamptz;
 else
  key:='reserva_confirmada:'||p_booking; expiry:=least(now()+interval '1 hour',coalesce(departure,now()+interval '1 hour'));
 end if;
 -- ZZ is explicitly unknown until libphonenumber resolves it before transport.
 message_id:=public.enqueue_sms_notification(u.id,p_booking,u.phone_verified_e164,'ZZ',p_category,key,now(),expiry);
 update messaging_private.notification_outbox set departure_snapshot=departure where id=message_id and status='pendiente';
 return message_id;
end $function$;

CREATE OR REPLACE FUNCTION public.prepare_sms_notification(p_id uuid, p_lease uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o messaging_private.notification_outbox; snap jsonb; u public.users;
begin
 select * into o from messaging_private.notification_outbox where id=p_id for update;
 if o.id is null or o.status<>'procesando' or o.lease_token is distinct from p_lease or o.lease_until<=now() or o.expires_at<=now() then return jsonb_build_object('allowed',false); end if;
 snap:=messaging_private.booking_sms_snapshot(o.booking_id);
 if not coalesce((snap->>'eligible')::boolean,false) then return jsonb_build_object('allowed',false); end if;
 select * into u from public.users where id=o.user_id;
 -- Mismo recheck invertido que queue_booking_sms (la preferencia pudo cambiar
 -- entre encolar y despachar).
 if not coalesce(u.is_active,false) or u.phone_verified_at is null or u.phone_verified_e164 is distinct from o.destination_e164
 or not exists(select 1 from messaging_private.notification_preferences where user_id=u.id and channel='sms' and application='toursred' and transactional_enabled)
 then return jsonb_build_object('allowed',false); end if;
 if (snap->>'departure_at')::timestamptz<=now() or (snap->>'departure_date')::date<current_date then return jsonb_build_object('allowed',false); end if;
 if o.category='recordatorio_tour' and (o.departure_snapshot is null or o.departure_snapshot is distinct from (snap->>'departure_at')::timestamptz
 or extract(hour from now() at time zone (snap->>'time_zone')) not between 8 and 20) then return jsonb_build_object('allowed',false); end if;
 return snap||jsonb_build_object('allowed',true,'destination',o.destination_e164);
end $function$;
