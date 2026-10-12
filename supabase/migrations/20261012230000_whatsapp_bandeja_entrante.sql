-- Bandeja de WhatsApp entrante ("Mensajes Entrantes de WhatsApp", panel admin).
--
-- QUE RESUELVE
--
-- Hasta hoy los mensajes que un cliente le manda al numero de WhatsApp de
-- ToursRed solo aparecian en Twilio Console: ningun endpoint nuestro los
-- recibia. Esto los guarda (texto + adjuntos), los agrupa por numero, deja
-- responder desde el panel y permite bloquear un numero.
--
-- DECISIONES
--
--   * Acceso: SOLO super_admin (`public.is_super_admin()`). Son numeros de
--     telefono y conversaciones de clientes; se abre a otros roles con un
--     permiso propio el dia que haga falta, no antes.
--   * Escritura: solo service_role (Edge Functions) y las RPC de abajo.
--     `authenticated` solo tiene SELECT; el resto de sus operaciones pasan por
--     `whatsapp_bloquear_contacto` / `whatsapp_marcar_leido`.
--   * Un numero bloqueado NO se guarda: el webhook solo incrementa
--     `descartados_bloqueado` (un contador, sin contenido).
--   * Las plantillas quedan modeladas desde ya (`whatsapp_plantillas`,
--     `tipo`/`plantilla_id`/`plantilla_variables` en los mensajes y el envio
--     por ContentSid) aunque la pantalla solo ofrezca texto libre al inicio.
--   * La ventana de 24 h de WhatsApp se decide AQUI (`now()` de la base), no en
--     el front ni en la Edge Function: es una regla de Meta y debe haber una sola
--     fuente de verdad.
--
-- LOS MOVILES DE MEXICO LLEGAN CON UN "1" DE MAS
--
-- Twilio entrega +5215513209470 donde el usuario registro +525513209470. Sin
-- normalizar, la misma persona serian dos contactos y nunca se enlazaria con
-- `users`. `whatsapp_telefono_canonico` quita ese 1 SOLO para +521 + 10 digitos
-- (movil MX); la llave del contacto es el canonico y el numero tal cual lo mando
-- Twilio se guarda aparte en `telefono_twilio` para responderle por el mismo
-- camino por el que escribio.

-- ---------------------------------------------------------------------------
-- Normalizacion de telefono
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_telefono_canonico(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when n is null then null
    when n ~ '^\+521[0-9]{10}$' then '+52' || substr(n, 5)
    when n ~ '^\+[1-9][0-9]{7,14}$' then n
    else null
  end
  from (select regexp_replace(btrim(coalesce(p_phone, '')), '^whatsapp:', '') as n) t;
$$;
revoke all on function public.whatsapp_telefono_canonico(text) from public, anon;
grant execute on function public.whatsapp_telefono_canonico(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------
create table public.whatsapp_contactos (
  telefono text primary key check (telefono ~ '^\+[1-9][0-9]{7,14}$'),
  telefono_twilio text not null check (telefono_twilio ~ '^\+[1-9][0-9]{7,14}$'),
  nombre_perfil text,
  user_id uuid references public.users(id) on delete set null,
  bloqueado boolean not null default false,
  bloqueado_en timestamptz,
  bloqueado_por uuid references public.users(id) on delete set null,
  motivo_bloqueo text,
  descartados_bloqueado integer not null default 0,
  ultimo_entrante_en timestamptz,
  ultimo_mensaje_en timestamptz,
  no_leidos integer not null default 0 check (no_leidos >= 0),
  creado_en timestamptz not null default now(),
  constraint whatsapp_contactos_bloqueo_coherente check (bloqueado = (bloqueado_en is not null))
);
create index whatsapp_contactos_ultimo_mensaje_idx on public.whatsapp_contactos (ultimo_mensaje_en desc nulls last);
create index whatsapp_contactos_user_idx on public.whatsapp_contactos (user_id) where user_id is not null;

create table public.whatsapp_plantillas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  content_sid text not null unique check (content_sid ~ '^HX[0-9a-fA-F]{32}$'),
  descripcion text,
  cuerpo_ejemplo text,
  variables smallint not null default 0 check (variables between 0 and 10),
  categoria text not null default 'utility' check (categoria in ('utility', 'marketing', 'authentication', 'service')),
  activa boolean not null default true,
  creado_en timestamptz not null default now()
);

create table public.whatsapp_mensajes (
  id uuid primary key default gen_random_uuid(),
  telefono text not null references public.whatsapp_contactos(telefono) on delete cascade,
  direccion text not null check (direccion in ('entrante', 'saliente')),
  tipo text not null default 'texto' check (tipo in ('texto', 'plantilla', 'media')),
  twilio_sid text unique check (twilio_sid ~ '^(SM|MM)[0-9a-fA-F]{32}$'),
  cuerpo text check (cuerpo is null or char_length(cuerpo) <= 4096),
  plantilla_id uuid references public.whatsapp_plantillas(id) on delete set null,
  plantilla_variables jsonb,
  estado text not null check (estado in ('recibido', 'enviando', 'enviado', 'entregado', 'leido', 'fallido', 'desconocido')),
  codigo_error text,
  enviado_por uuid references public.users(id) on delete set null,
  num_adjuntos smallint not null default 0 check (num_adjuntos between 0 and 10),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  -- Un entrante solo puede estar 'recibido' y un saliente nunca.
  constraint whatsapp_mensajes_estado_coherente check ((direccion = 'entrante') = (estado = 'recibido')),
  -- Una plantilla se manda con su variable; un texto libre no lleva plantilla.
  constraint whatsapp_mensajes_plantilla_coherente check (tipo = 'plantilla' or (plantilla_id is null and plantilla_variables is null))
);
create index whatsapp_mensajes_hilo_idx on public.whatsapp_mensajes (telefono, creado_en desc);

create table public.whatsapp_adjuntos (
  id uuid primary key default gen_random_uuid(),
  mensaje_id uuid not null references public.whatsapp_mensajes(id) on delete cascade,
  twilio_media_sid text,
  url_origen text,
  content_type text not null,
  tamano_bytes integer check (tamano_bytes is null or tamano_bytes >= 0),
  storage_path text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'guardado', 'fallido', 'omitido')),
  codigo_error text,
  creado_en timestamptz not null default now(),
  unique (mensaje_id, twilio_media_sid)
);
create index whatsapp_adjuntos_mensaje_idx on public.whatsapp_adjuntos (mensaje_id);

-- ---------------------------------------------------------------------------
-- RLS: solo super_admin lee; nadie escribe por tabla (todo por RPC/service_role)
-- ---------------------------------------------------------------------------
alter table public.whatsapp_contactos enable row level security;
alter table public.whatsapp_plantillas enable row level security;
alter table public.whatsapp_mensajes enable row level security;
alter table public.whatsapp_adjuntos enable row level security;

revoke all on public.whatsapp_contactos, public.whatsapp_plantillas, public.whatsapp_mensajes, public.whatsapp_adjuntos from anon, authenticated;
grant select on public.whatsapp_contactos, public.whatsapp_plantillas, public.whatsapp_mensajes, public.whatsapp_adjuntos to authenticated;

create policy whatsapp_contactos_super_admin_select on public.whatsapp_contactos
  for select to authenticated using (public.is_super_admin());
create policy whatsapp_plantillas_super_admin_select on public.whatsapp_plantillas
  for select to authenticated using (public.is_super_admin());
create policy whatsapp_mensajes_super_admin_select on public.whatsapp_mensajes
  for select to authenticated using (public.is_super_admin());
create policy whatsapp_adjuntos_super_admin_select on public.whatsapp_adjuntos
  for select to authenticated using (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- Storage: bucket privado para los adjuntos entrantes
-- ---------------------------------------------------------------------------
-- 16 MB es el tope de media de WhatsApp. SVG y HTML quedan fuera a proposito:
-- el contenido lo manda cualquier persona del mundo y se abre en un panel admin.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'whatsapp-media', 'whatsapp-media', false, 16777216,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/3gpp',
    'audio/ogg', 'audio/mpeg', 'audio/amr', 'audio/aac', 'audio/mp4',
    'application/pdf', 'application/msword', 'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv', 'text/vcard'
  ]
)
on conflict (id) do nothing;

drop policy if exists whatsapp_media_super_admin_select on storage.objects;
create policy whatsapp_media_super_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'whatsapp-media' and public.is_super_admin());

-- ---------------------------------------------------------------------------
-- RPC: mensaje entrante (solo service_role; la llama el webhook)
-- ---------------------------------------------------------------------------
-- p_media: [{"sid": "ME...", "url": "https://api.twilio.com/...", "tipo": "image/jpeg"}]
-- Devuelve {estado: ok|duplicado|bloqueado|invalido, mensaje_id, adjuntos: [{id,url,tipo}]}
-- `adjuntos` trae solo los que siguen 'pendiente': si Twilio reintenta el
-- webhook tras una descarga a medias, el reintento puede terminarla.
create or replace function public.whatsapp_registrar_entrante(
  p_from text, p_sid text, p_cuerpo text, p_nombre text, p_media jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_canon text := public.whatsapp_telefono_canonico(p_from);
  v_twilio text := regexp_replace(btrim(coalesce(p_from, '')), '^whatsapp:', '');
  v_contacto public.whatsapp_contactos%rowtype;
  v_mensaje uuid;
  v_nuevo boolean := false;
  v_users uuid[];
  v_media jsonb := case when jsonb_typeof(p_media) = 'array' then p_media else '[]'::jsonb end;
  v_adjuntos jsonb;
begin
  if v_canon is null or p_sid is null or p_sid !~ '^(SM|MM)[0-9a-fA-F]{32}$' then
    return jsonb_build_object('estado', 'invalido');
  end if;

  select * into v_contacto from public.whatsapp_contactos where telefono = v_canon for update;
  if found and v_contacto.bloqueado then
    update public.whatsapp_contactos set descartados_bloqueado = descartados_bloqueado + 1 where telefono = v_canon;
    return jsonb_build_object('estado', 'bloqueado');
  end if;

  if not found then
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

  if not v_nuevo then
    select id into v_mensaje from public.whatsapp_mensajes where twilio_sid = p_sid;
  else
    insert into public.whatsapp_adjuntos (mensaje_id, twilio_media_sid, url_origen, content_type)
    select v_mensaje, m->>'sid', m->>'url', coalesce(nullif(m->>'tipo', ''), 'application/octet-stream')
    from jsonb_array_elements(v_media) with ordinality as t(m, i)
    where i <= 10 and m->>'url' is not null
    on conflict do nothing;

    update public.whatsapp_contactos set
      telefono_twilio = v_twilio,
      nombre_perfil = coalesce(nullif(btrim(p_nombre), ''), nombre_perfil),
      ultimo_entrante_en = now(), ultimo_mensaje_en = now(), no_leidos = no_leidos + 1
    where telefono = v_canon;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'url', url_origen, 'tipo', content_type)), '[]'::jsonb)
    into v_adjuntos from public.whatsapp_adjuntos where mensaje_id = v_mensaje and estado = 'pendiente';

  return jsonb_build_object('estado', case when v_nuevo then 'ok' else 'duplicado' end, 'mensaje_id', v_mensaje, 'telefono', v_canon, 'adjuntos', v_adjuntos);
end $$;
revoke all on function public.whatsapp_registrar_entrante(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_registrar_entrante(text, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- RPC: callbacks de estado de los salientes (solo service_role)
-- ---------------------------------------------------------------------------
-- Solo avanza: un 'delivered' que llega antes que un 'sent' no se pisa despues.
create or replace function public.whatsapp_registrar_estado(p_sid text, p_estado text, p_codigo text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filas integer;
  v_rango constant jsonb := '{"desconocido":0,"enviando":1,"enviado":2,"entregado":3,"leido":4}';
begin
  if p_estado not in ('enviando', 'enviado', 'entregado', 'leido', 'fallido') then return false; end if;
  update public.whatsapp_mensajes set
    estado = p_estado,
    codigo_error = case when p_estado = 'fallido' then coalesce(p_codigo, 'twilio_fallo') else codigo_error end,
    actualizado_en = now()
  where twilio_sid = p_sid and direccion = 'saliente'
    and estado <> 'fallido'
    and (
      (p_estado = 'fallido' and estado in ('enviando', 'enviado', 'desconocido'))
      or (p_estado <> 'fallido' and (v_rango->>p_estado)::int > (v_rango->>estado)::int)
    );
  get diagnostics v_filas = row_count;
  return v_filas > 0;
end $$;
revoke all on function public.whatsapp_registrar_estado(text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_registrar_estado(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- RPC: preparar y cerrar un envio (solo service_role; la llama la Edge Function)
-- ---------------------------------------------------------------------------
-- Se inserta la fila ANTES de llamar a Twilio: si la llamada queda ambigua
-- (timeout) hay rastro de que se intento, en vez de un mensaje fantasma.
create or replace function public.whatsapp_preparar_envio(
  p_telefono text, p_tipo text, p_cuerpo text, p_plantilla uuid, p_variables jsonb, p_usuario uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contacto public.whatsapp_contactos%rowtype;
  v_plantilla public.whatsapp_plantillas%rowtype;
  v_mensaje uuid;
  v_i integer;
begin
  select * into v_contacto from public.whatsapp_contactos where telefono = p_telefono for update;
  if not found then return jsonb_build_object('ok', false, 'codigo', 'CONTACTO_NO_EXISTE'); end if;
  if v_contacto.bloqueado then return jsonb_build_object('ok', false, 'codigo', 'CONTACTO_BLOQUEADO'); end if;

  if p_tipo = 'texto' then
    if coalesce(btrim(p_cuerpo), '') = '' or char_length(p_cuerpo) > 4096 then
      return jsonb_build_object('ok', false, 'codigo', 'CUERPO_INVALIDO');
    end if;
    -- Ventana de servicio de 24 h de WhatsApp: fuera de ella solo plantillas.
    if v_contacto.ultimo_entrante_en is null or v_contacto.ultimo_entrante_en < now() - interval '24 hours' then
      return jsonb_build_object('ok', false, 'codigo', 'VENTANA_CERRADA');
    end if;
    insert into public.whatsapp_mensajes (telefono, direccion, tipo, cuerpo, estado, enviado_por)
    values (p_telefono, 'saliente', 'texto', p_cuerpo, 'enviando', p_usuario) returning id into v_mensaje;
    return jsonb_build_object('ok', true, 'mensaje_id', v_mensaje, 'telefono_twilio', v_contacto.telefono_twilio);
  elsif p_tipo = 'plantilla' then
    select * into v_plantilla from public.whatsapp_plantillas where id = p_plantilla and activa;
    if not found then return jsonb_build_object('ok', false, 'codigo', 'PLANTILLA_NO_DISPONIBLE'); end if;
    if v_plantilla.variables > 0 then
      if p_variables is null or jsonb_typeof(p_variables) <> 'object' then
        return jsonb_build_object('ok', false, 'codigo', 'VARIABLES_INVALIDAS');
      end if;
      for v_i in 1..v_plantilla.variables loop
        if jsonb_typeof(p_variables->(v_i::text)) is distinct from 'string'
           or coalesce(btrim(p_variables->>(v_i::text)), '') = '' or char_length(p_variables->>(v_i::text)) > 1024 then
          return jsonb_build_object('ok', false, 'codigo', 'VARIABLES_INVALIDAS');
        end if;
      end loop;
    end if;
    insert into public.whatsapp_mensajes (telefono, direccion, tipo, cuerpo, plantilla_id, plantilla_variables, estado, enviado_por)
    values (p_telefono, 'saliente', 'plantilla', v_plantilla.cuerpo_ejemplo, v_plantilla.id, p_variables, 'enviando', p_usuario)
    returning id into v_mensaje;
    return jsonb_build_object('ok', true, 'mensaje_id', v_mensaje, 'telefono_twilio', v_contacto.telefono_twilio, 'content_sid', v_plantilla.content_sid);
  end if;
  return jsonb_build_object('ok', false, 'codigo', 'TIPO_INVALIDO');
end $$;
revoke all on function public.whatsapp_preparar_envio(text, text, text, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_preparar_envio(text, text, text, uuid, jsonb, uuid) to service_role;

create or replace function public.whatsapp_cerrar_envio(p_mensaje uuid, p_sid text, p_estado text, p_codigo text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_estado not in ('enviando', 'fallido', 'desconocido') then raise exception 'estado_invalido'; end if;
  update public.whatsapp_mensajes set
    twilio_sid = coalesce(p_sid, twilio_sid), estado = p_estado, codigo_error = p_codigo, actualizado_en = now()
  where id = p_mensaje and direccion = 'saliente' and estado = 'enviando';
  if p_estado <> 'fallido' then
    update public.whatsapp_contactos set ultimo_mensaje_en = now()
    where telefono = (select telefono from public.whatsapp_mensajes where id = p_mensaje);
  end if;
end $$;
revoke all on function public.whatsapp_cerrar_envio(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_cerrar_envio(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- RPC del panel (authenticated, pero exige super_admin ADENTRO)
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_bloquear_contacto(p_telefono text, p_bloquear boolean, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then raise exception 'permiso_denegado' using errcode = '42501'; end if;
  update public.whatsapp_contactos set
    bloqueado = p_bloquear,
    bloqueado_en = case when p_bloquear then now() end,
    bloqueado_por = case when p_bloquear then auth.uid() end,
    motivo_bloqueo = case when p_bloquear then left(nullif(btrim(p_motivo), ''), 500) end
  where telefono = p_telefono;
  if not found then raise exception 'contacto_no_existe' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.whatsapp_bloquear_contacto(text, boolean, text) from public, anon;
grant execute on function public.whatsapp_bloquear_contacto(text, boolean, text) to authenticated;

create or replace function public.whatsapp_marcar_leido(p_telefono text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then raise exception 'permiso_denegado' using errcode = '42501'; end if;
  update public.whatsapp_contactos set no_leidos = 0 where telefono = p_telefono and no_leidos <> 0;
end $$;
revoke all on function public.whatsapp_marcar_leido(text) from public, anon;
grant execute on function public.whatsapp_marcar_leido(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: la bandeja se actualiza sin recargar (respeta RLS)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['whatsapp_mensajes', 'whatsapp_contactos', 'whatsapp_adjuntos'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
