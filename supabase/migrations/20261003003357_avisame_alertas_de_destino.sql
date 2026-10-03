-- ============================================================================
-- "Avisame": el viajero pide que le avisemos cuando una agencia publique un
-- tour del destino que busco y no encontro.
--
-- POR QUE ES OPT-IN (y no un correo automatico a quien busco)
--
-- Buscar en el sitio no es pedir correos. Mandar mensajes comerciales a quien
-- solo busco exige su consentimiento (LFPDPPP). Por eso el aviso solo existe si
-- el viajero lo pide con un clic, y cada correo lleva un enlace para darse de
-- baja. Esta tabla NO se llena desde search_events.
--
-- COMO FUNCIONA
--   1. El viajero (con sesion) pulsa "Avisame" en la pantalla sin resultados:
--      subscribe_destination_alert(texto).
--   2. Un cron (cada 30 min) llama a la Edge Function send-destination-alerts.
--   3. La funcion pide claim_destination_alert_matches(): avisos activos con
--      tours publicados DESPUES de pedirlo que coinciden con el termino. Los
--      marca como notificados al reclamarlos (un solo correo por aviso).
--   4. Si el envio falla, release_destination_alert(id) lo deja pendiente.
--   5. El correo trae un enlace /avisos/baja?token=... que llama a
--      unsubscribe_destination_alert(token) sin necesidad de sesion.
--
-- SEGURIDAD
--   - La tabla se lee solo por su dueno (y el superadmin); nadie inserta
--     directo: la llave del termino se calcula en el servidor.
--   - claim/release: solo service_role.
--   - unsubscribe: anon y authenticated, protegido por un token uuid aleatorio.
-- ============================================================================

create table if not exists public.destination_alerts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users(id) on delete cascade,
  term_key           text not null,
  term_raw           text not null,
  unsubscribe_token  uuid not null default gen_random_uuid() unique,
  created_at         timestamptz not null default now(),
  notified_at        timestamptz,
  unsubscribed_at    timestamptz,
  constraint destination_alerts_key_valida
    check (length(term_key) between 3 and 80 and position('@' in term_key) = 0),
  constraint destination_alerts_user_term_unico unique (user_id, term_key)
);

create index if not exists idx_destination_alerts_pendientes
  on public.destination_alerts (created_at)
  where notified_at is null and unsubscribed_at is null;

alter table public.destination_alerts enable row level security;

create policy "Usuario ve sus avisos"
  on public.destination_alerts for select to authenticated
  using (user_id = auth.uid());

create policy "Superadmin ve los avisos"
  on public.destination_alerts for select to authenticated
  using (public.is_super_admin());

revoke all on public.destination_alerts from anon, authenticated;
grant select on public.destination_alerts to authenticated;

-- ---------------------------------------------------------------------------
-- Pedir el aviso
-- ---------------------------------------------------------------------------
create or replace function public.subscribe_destination_alert(p_term text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_key  text;
  v_raw  text;
begin
  if v_user is null then
    raise exception 'Se requiere sesion' using errcode = '42501';
  end if;

  v_raw := left(btrim(coalesce(p_term, '')), 80);
  v_key := public.search_term_key(v_raw);

  if length(v_key) < 3 or position('@' in v_raw) > 0
     or v_raw ~ '[0-9]{7,}' then
    raise exception 'Termino no valido' using errcode = '22023';
  end if;

  -- Tope por usuario: 20 avisos activos.
  if (select count(*) from public.destination_alerts
       where user_id = v_user and unsubscribed_at is null and notified_at is null) >= 20
     and not exists (select 1 from public.destination_alerts
                      where user_id = v_user and term_key = v_key) then
    raise exception 'Ya tienes 20 avisos activos' using errcode = '54000';
  end if;

  insert into public.destination_alerts (user_id, term_key, term_raw)
  values (v_user, v_key, v_raw)
  on conflict (user_id, term_key) do update
    set term_raw = excluded.term_raw,
        created_at = now(),
        notified_at = null,
        unsubscribed_at = null
    where destination_alerts.unsubscribed_at is not null
       or destination_alerts.notified_at is not null;

  return true;
end;
$$;

revoke all on function public.subscribe_destination_alert(text) from public, anon;
grant execute on function public.subscribe_destination_alert(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Cancelar el aviso (enlace del correo, sin sesion)
-- ---------------------------------------------------------------------------
create or replace function public.unsubscribe_destination_alert(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  update public.destination_alerts
     set unsubscribed_at = coalesce(unsubscribed_at, now())
   where unsubscribe_token = p_token
   returning id into v_id;
  return v_id is not null;
end;
$$;

revoke all on function public.unsubscribe_destination_alert(uuid) from public;
grant execute on function public.unsubscribe_destination_alert(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reclamar los avisos con tours nuevos (solo la Edge Function)
-- ---------------------------------------------------------------------------
create or replace function public.claim_destination_alert_matches(p_limit int default 100)
returns table (
  alert_id          uuid,
  unsubscribe_token uuid,
  email             text,
  first_name        text,
  term_raw          text,
  tours             jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with candidatos as (
    select a.id
      from public.destination_alerts a
      join public.users u on u.id = a.user_id
     where a.notified_at is null
       and a.unsubscribed_at is null
       and u.is_active is not false
       and u.email is not null
       and exists (
         select 1 from public.tours t
          where t.is_published is true
            and coalesce(t.published_at, t.created_at) > a.created_at
            and (
              public.search_term_key(t.destination) = a.term_key
              or (length(a.term_key) >= 4
                  and position(a.term_key in public.search_term_key(t.name)) > 0)
            )
       )
     order by a.created_at
     limit greatest(p_limit, 1)
     for update of a skip locked
  ),
  reclamados as (
    update public.destination_alerts a
       set notified_at = now()
      from candidatos c
     where a.id = c.id
     returning a.id, a.unsubscribe_token, a.user_id, a.term_key, a.term_raw, a.created_at
  )
  select r.id, r.unsubscribe_token, u.email, u.first_name, r.term_raw,
         (select coalesce(jsonb_agg(jsonb_build_object(
                    'name', x.name, 'slug', x.slug, 'destination', x.destination,
                    'agency', x.agency_name) ), '[]'::jsonb)
            from (
              select t.name, t.slug, t.destination, ag.name as agency_name
                from public.tours t
                left join public.agencies ag on ag.id = t.agency_id
               where t.is_published is true
                 and coalesce(t.published_at, t.created_at) > r.created_at
                 and (
                   public.search_term_key(t.destination) = r.term_key
                   or (length(r.term_key) >= 4
                       and position(r.term_key in public.search_term_key(t.name)) > 0)
                 )
               order by coalesce(t.published_at, t.created_at) desc
               limit 5
            ) x)
    from reclamados r
    join public.users u on u.id = r.user_id;
end;
$$;

revoke all on function public.claim_destination_alert_matches(int) from public, anon, authenticated;
grant execute on function public.claim_destination_alert_matches(int) to service_role;

create or replace function public.release_destination_alert(p_alert_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.destination_alerts set notified_at = null where id = p_alert_id;
$$;

revoke all on function public.release_destination_alert(uuid) from public, anon, authenticated;
grant execute on function public.release_destination_alert(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Cron: cada 30 minutos llama a la Edge Function.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'send-destination-alerts',
  '*/30 * * * *',
  $cron$
    select net.http_post(
      url := 'https://huzsedewwzjywcpbkjkm.supabase.co/functions/v1/send-destination-alerts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
      ),
      body := '{}'::jsonb
    )
  $cron$
);
