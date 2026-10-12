-- Permiso para usar la bandeja "Mensajes Entrantes de WhatsApp".
--
-- La bandeja (migracion 20261012215514) nacio abierta SOLO al super_admin. Axel
-- pidio que la usen tambien otros admin y los agentes de soporte, que son
-- atencion al cliente. Esta migracion cambia QUIEN puede, no QUE puede hacer.
--
-- QUIEN PUEDE (`whatsapp_usuario_autorizado`), cualquiera de estos y activo:
--   1. el super_admin (users.is_super_admin);
--   2. un admin con `admin_permissions.can_manage_whatsapp` (casilla en
--      "Usuarios del Sistema");
--   3. un agente de soporte activo con `support_agent_permissions.can_manage_whatsapp`
--      (casilla en "Agentes de Soporte").
--
-- POR DEFECTO: los roles de soporte `super_admin`, `supervisor` y `agente` lo
-- traen encendido; `lectura` no. El default lo pone un TRIGGER en el INSERT (no
-- el front) para que valga venga la fila de donde venga; despues el admin puede
-- cambiarlo agente por agente. Un cambio de rol posterior NO lo reescribe: el
-- permiso es una decision explicita, no un derivado del rol.
--
-- UNA SOLA FUENTE DE VERDAD: RLS, las RPC del panel, la Edge Function de respuesta
-- y el menu del front preguntan lo mismo (`whatsapp_usuario_autorizado` /
-- `can_use_whatsapp_inbox`). Antes cada sitio habria tenido su propia regla.
--
-- Los admin que ya existian NO reciben el permiso (default false): abrirlo es una
-- decision de Axel, caso por caso. Los agentes de soporte YA existentes se
-- rellenan con la misma regla del default (supervisor/agente/super_admin = si).

-- ---------------------------------------------------------------------------
-- Columnas
-- ---------------------------------------------------------------------------
alter table public.admin_permissions
  add column if not exists can_manage_whatsapp boolean not null default false;

alter table public.support_agent_permissions
  add column if not exists can_manage_whatsapp boolean;

update public.support_agent_permissions
   set can_manage_whatsapp = rol_soporte in ('super_admin', 'supervisor', 'agente')
 where can_manage_whatsapp is null;

alter table public.support_agent_permissions
  alter column can_manage_whatsapp set not null;

-- NOT NULL sin DEFAULT a proposito: el trigger decide el valor segun el rol.
-- (Los NOT NULL se comprueban DESPUES de los triggers BEFORE ROW.)
create or replace function public.support_agent_whatsapp_default()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.can_manage_whatsapp is null then
    new.can_manage_whatsapp := new.rol_soporte in ('super_admin', 'supervisor', 'agente');
  end if;
  return new;
end $$;

drop trigger if exists trg_support_agent_whatsapp_default on public.support_agent_permissions;
create trigger trg_support_agent_whatsapp_default
  before insert on public.support_agent_permissions
  for each row execute function public.support_agent_whatsapp_default();

-- ---------------------------------------------------------------------------
-- Quien puede usar la bandeja
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_usuario_autorizado(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_user is not null and (
    exists (
      select 1 from public.users u
       where u.id = p_user and u.is_active and u.is_super_admin
    )
    or exists (
      select 1 from public.users u
        join public.admin_permissions ap on ap.user_id = u.id
       where u.id = p_user and u.is_active and u.role in ('admin', 'super_admin') and ap.can_manage_whatsapp
    )
    or exists (
      select 1 from public.users u
        join public.support_agent_permissions sp on sp.user_id = u.id
       where u.id = p_user and u.is_active and u.role in ('admin', 'super_admin') and sp.activo and sp.can_manage_whatsapp
    )
  ), false)
$$;
revoke all on function public.whatsapp_usuario_autorizado(uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_usuario_autorizado(uuid) to service_role;

create or replace function public.can_use_whatsapp_inbox()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.whatsapp_usuario_autorizado(auth.uid())
$$;
revoke all on function public.can_use_whatsapp_inbox() from public, anon;
grant execute on function public.can_use_whatsapp_inbox() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS: de "solo super_admin" a "quien tenga el permiso"
-- ---------------------------------------------------------------------------
drop policy if exists whatsapp_contactos_super_admin_select on public.whatsapp_contactos;
drop policy if exists whatsapp_plantillas_super_admin_select on public.whatsapp_plantillas;
drop policy if exists whatsapp_mensajes_super_admin_select on public.whatsapp_mensajes;
drop policy if exists whatsapp_adjuntos_super_admin_select on public.whatsapp_adjuntos;

create policy whatsapp_contactos_autorizados_select on public.whatsapp_contactos
  for select to authenticated using ((select public.can_use_whatsapp_inbox()));
create policy whatsapp_plantillas_autorizados_select on public.whatsapp_plantillas
  for select to authenticated using ((select public.can_use_whatsapp_inbox()));
create policy whatsapp_mensajes_autorizados_select on public.whatsapp_mensajes
  for select to authenticated using ((select public.can_use_whatsapp_inbox()));
create policy whatsapp_adjuntos_autorizados_select on public.whatsapp_adjuntos
  for select to authenticated using ((select public.can_use_whatsapp_inbox()));

drop policy if exists whatsapp_media_super_admin_select on storage.objects;
drop policy if exists whatsapp_media_autorizados_select on storage.objects;
create policy whatsapp_media_autorizados_select on storage.objects
  for select to authenticated
  using (bucket_id = 'whatsapp-media' and (select public.can_use_whatsapp_inbox()));

-- ---------------------------------------------------------------------------
-- RPC del panel: mismo cuerpo que antes, con la nueva regla
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_bloquear_contacto(p_telefono text, p_bloquear boolean, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_use_whatsapp_inbox() then raise exception 'permiso_denegado' using errcode = '42501'; end if;
  update public.whatsapp_contactos set
    bloqueado = p_bloquear,
    bloqueado_en = case when p_bloquear then now() end,
    bloqueado_por = case when p_bloquear then auth.uid() end,
    motivo_bloqueo = case when p_bloquear then left(nullif(btrim(p_motivo), ''), 500) end
  where telefono = p_telefono;
  if not found then raise exception 'contacto_no_existe' using errcode = 'P0002'; end if;
end $$;

create or replace function public.whatsapp_marcar_leido(p_telefono text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_use_whatsapp_inbox() then raise exception 'permiso_denegado' using errcode = '42501'; end if;
  update public.whatsapp_contactos set no_leidos = 0 where telefono = p_telefono and no_leidos <> 0;
end $$;

-- ---------------------------------------------------------------------------
-- Envio: la base tambien exige el permiso (defensa en profundidad)
-- ---------------------------------------------------------------------------
-- La Edge Function ya lo comprueba antes de llamar; aqui se repite porque las
-- reglas del envio viven en la base y esta funcion no debe poder invocarse con
-- el id de alguien sin permiso. Mismo cuerpo que antes + la primera comprobacion.
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
  if not public.whatsapp_usuario_autorizado(p_usuario) then
    return jsonb_build_object('ok', false, 'codigo', 'NO_AUTORIZADO');
  end if;

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
