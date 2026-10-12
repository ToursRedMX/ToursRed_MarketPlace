-- Aviso por correo de un mensaje entrante de WhatsApp, UNO POR CONVERSACION.
--
-- POR QUE
--
-- WhatsApp solo deja contestar con texto libre durante las 24 h siguientes al
-- ULTIMO mensaje del cliente. Si nadie ve el mensaje a tiempo, solo quedan las
-- plantillas aprobadas. El correo existe para que esa ventana no se pierda en
-- silencio; no es un registro de todo lo que escribe el cliente.
--
-- QUE ES "UNA CONVERSACION"
--
-- Se avisa cuando el cliente escribe y se cumple UNA de estas:
--   1. es la primera vez que escribe ese numero;
--   2. el hilo llevaba MAS DE 4 HORAS sin actividad de nadie (ni del cliente ni
--      del equipo: `ultimo_mensaje_en` se mueve con los dos);
--   3. el aviso anterior quedo pendiente porque el correo FALLO (se reintenta).
-- Una rafaga de mensajes, o un chat en el que el equipo va contestando, es UNA
-- conversacion: un solo correo. Una pregunta nueva horas despues si avisa.
--
-- Por que no "una vez por contacto cada 24 h": un cliente que contesto ayer y
-- vuelve a escribir 23 h despues abre una ventana NUEVA que nadie sabria que
-- corre. Por que no "mientras haya mensajes sin leer": si el agente va leyendo
-- y contestando, llegaria un correo por cada mensaje del cliente.
--
-- EL FALLO DEL CORREO NO SE TRAGA: la base decide avisar y lo deja anotado en
-- `aviso_pendiente_desde`; la Edge Function manda el correo y SOLO entonces llama
-- a `whatsapp_confirmar_aviso`. Si el correo falla, el aviso sigue pendiente y se
-- reintenta con el siguiente mensaje. Mientras el correo va en vuelo (2 min de
-- gracia) otro mensaje de la misma rafaga NO lo duplica.
--
-- La decision se toma con la fila del contacto BLOQUEADA (`for update`), asi que
-- dos webhooks simultaneos del mismo numero no mandan dos correos.

alter table public.whatsapp_contactos
  add column if not exists aviso_pendiente_desde timestamptz,
  add column if not exists aviso_correo_enviado_en timestamptz;

-- ---------------------------------------------------------------------------
-- Entrada: igual que antes + la decision de avisar
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_registrar_entrante(
  p_from text, p_sid text, p_cuerpo text, p_nombre text, p_media jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_silencio constant interval := interval '4 hours';  -- inactividad que separa dos conversaciones
  c_gracia   constant interval := interval '2 minutes'; -- un correo "en vuelo" no se duplica
  v_canon text := public.whatsapp_telefono_canonico(p_from);
  v_twilio text := regexp_replace(btrim(coalesce(p_from, '')), '^whatsapp:', '');
  v_contacto public.whatsapp_contactos%rowtype;
  v_existia boolean;
  v_mensaje uuid;
  v_nuevo boolean := false;
  v_users uuid[];
  v_media jsonb := case when jsonb_typeof(p_media) = 'array' then p_media else '[]'::jsonb end;
  v_adjuntos jsonb;
  v_avisar boolean := false;
  v_reintento boolean := false;
  v_info record;
begin
  if v_canon is null or p_sid is null or p_sid !~ '^(SM|MM)[0-9a-fA-F]{32}$' then
    return jsonb_build_object('estado', 'invalido');
  end if;

  select * into v_contacto from public.whatsapp_contactos where telefono = v_canon for update;
  v_existia := found;
  if v_existia and v_contacto.bloqueado then
    update public.whatsapp_contactos set descartados_bloqueado = descartados_bloqueado + 1 where telefono = v_canon;
    return jsonb_build_object('estado', 'bloqueado');
  end if;

  if not v_existia then
    -- Enlaza con `users` solo si hay UN usuario con ese telefono verificado:
    -- con dos coincidencias es mejor no enlazar que enlazar al equivocado.
    select array_agg(id) into v_users from public.users
      where public.whatsapp_telefono_canonico(phone_verified_e164) = v_canon;
    insert into public.whatsapp_contactos (telefono, telefono_twilio, nombre_perfil, user_id)
    values (v_canon, v_twilio, nullif(btrim(p_nombre), ''), case when coalesce(cardinality(v_users), 0) = 1 then v_users[1] end)
    on conflict (telefono) do nothing;
  end if;

  insert into public.whatsapp_mensajes (telefono, direccion, tipo, twilio_sid, cuerpo, estado, num_adjuntos)
  values (
    v_canon, 'entrante',
    case when coalesce(btrim(p_cuerpo), '') = '' and jsonb_array_length(v_media) > 0 then 'media' else 'texto' end,
    p_sid, left(nullif(p_cuerpo, ''), 4096), 'recibido', least(jsonb_array_length(v_media), 10)
  )
  on conflict (twilio_sid) do nothing
  returning id into v_mensaje;
  v_nuevo := v_mensaje is not null;

  -- Un aviso que quedo pendiente (el correo fallo) se reintenta pasada la gracia.
  v_reintento := v_existia and v_contacto.aviso_pendiente_desde is not null
                 and v_contacto.aviso_pendiente_desde < now() - c_gracia;

  if not v_nuevo then
    -- Reintento de Twilio del MISMO mensaje: no cuenta como mensaje nuevo, pero si el
    -- aviso de la vez anterior no salio, aprovecha para reintentarlo.
    select id into v_mensaje from public.whatsapp_mensajes where twilio_sid = p_sid;
    v_avisar := v_reintento;
  else
    insert into public.whatsapp_adjuntos (mensaje_id, twilio_media_sid, url_origen, content_type)
    select v_mensaje, m->>'sid', m->>'url', coalesce(nullif(m->>'tipo', ''), 'application/octet-stream')
    from jsonb_array_elements(v_media) with ordinality as t(m, i)
    where i <= 10 and m->>'url' is not null
    on conflict do nothing;

    v_avisar := not v_existia
                or v_reintento
                or v_contacto.ultimo_mensaje_en is null
                or v_contacto.ultimo_mensaje_en < now() - c_silencio;

    update public.whatsapp_contactos set
      telefono_twilio = v_twilio,
      nombre_perfil = coalesce(nullif(btrim(p_nombre), ''), nombre_perfil),
      ultimo_entrante_en = now(), ultimo_mensaje_en = now(), no_leidos = no_leidos + 1,
      aviso_pendiente_desde = case when v_avisar then now() else aviso_pendiente_desde end
    where telefono = v_canon;
  end if;

  if v_avisar and not v_nuevo then
    update public.whatsapp_contactos set aviso_pendiente_desde = now() where telefono = v_canon;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'url', url_origen, 'tipo', content_type)), '[]'::jsonb)
    into v_adjuntos from public.whatsapp_adjuntos where mensaje_id = v_mensaje and estado = 'pendiente';

  select nombre_perfil, user_id into v_info from public.whatsapp_contactos where telefono = v_canon;

  return jsonb_build_object(
    'estado', case when v_nuevo then 'ok' else 'duplicado' end,
    'mensaje_id', v_mensaje, 'telefono', v_canon, 'adjuntos', v_adjuntos,
    'avisar', v_avisar,
    -- Lo que necesita el correo (la funcion de borde no vuelve a consultar la base).
    'aviso', case when v_avisar then jsonb_build_object(
      'nombre', v_info.nombre_perfil, 'es_usuario', v_info.user_id is not null,
      'preview', left(coalesce(p_cuerpo, ''), 200), 'num_adjuntos', jsonb_array_length(v_media)
    ) end
  );
end $$;

-- ---------------------------------------------------------------------------
-- La funcion de borde confirma DESPUES de que el correo salio
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_confirmar_aviso(p_telefono text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.whatsapp_contactos
     set aviso_pendiente_desde = null, aviso_correo_enviado_en = now()
   where telefono = p_telefono and aviso_pendiente_desde is not null;
$$;
revoke all on function public.whatsapp_confirmar_aviso(text) from public, anon, authenticated;
grant execute on function public.whatsapp_confirmar_aviso(text) to service_role;
