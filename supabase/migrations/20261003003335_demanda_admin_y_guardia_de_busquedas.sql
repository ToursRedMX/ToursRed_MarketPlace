-- Demanda para el admin (con detalle de quien busco), union de terminos que
-- solo difieren en puntuacion, y guardia contra inflado/duplicados en search_events.
--
-- 1. search_term_key: llave de agrupacion. Quita puntuacion y espacios de mas
--    ("Sian Ka'an", "Sian Kaan" y "sian-kaan" son la misma busqueda). NO resuelve alias de
--    verdad (Teotihuacan vs San Juan Teotihuacan): eso espera volumen real.
--    No toca la columna `query_normalized` (generada y almacenada).
-- 2. agency_demand_top ahora agrupa por esa llave (mismas reglas de privacidad).
-- 3. admin_demand_terms / admin_demand_searches: solo SUPERADMIN (is_super_admin)
--    porque muestran datos de personas. Sin umbral, y la segunda trae usuario y correo de quien busco (solo cuando hubo sesion
--    iniciada y consentimiento de analitica; las busquedas anonimas no tienen
--    persona que mostrar).
-- 4. Guardia de insercion: una misma sesion no repite la misma busqueda en 5
--    minutos ni pasa de 120 busquedas por hora. Frena recargas y scripts con una
--    sesion fija. NO frena a quien rota sesiones o no manda sesion: eso pide un
--    limite por IP en una Edge Function, y queda anotado como limite conocido.

create or replace function public.search_term_key(txt text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  -- Apostrofes se quitan (Ka'an -> kaan); el resto de la puntuacion es espacio (sian-kaan -> sian kaan).
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(public.normalize_search_text(txt), E'[\'`\u2019]', '', 'g'),
      '[^a-z0-9 ]', ' ', 'g'),
    '\s+', ' ', 'g'));
$$;

-- ---------------------------------------------------------------------------
-- Reporte para agencias: misma interfaz, agrupa por llave.
-- ---------------------------------------------------------------------------
create or replace function public.agency_demand_top(
  p_days integer default 30,
  p_limit integer default 20,
  p_solo_sin_resultados boolean default false,
  p_min_busquedas integer default 3
)
returns table (
  termino text,
  busquedas bigint,
  busquedas_sin_resultados bigint,
  sesiones bigint,
  busquedas_periodo_anterior bigint,
  cubierto_por_mi boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_agency uuid;
  v_days integer := least(greatest(coalesce(p_days, 30), 7), 365);
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_min integer;
begin
  v_agency := public.agency_demand_authorized_agency();

  v_min := case
    when v_agency is null then greatest(coalesce(p_min_busquedas, 3), 1)
    else greatest(coalesce(p_min_busquedas, 3), 3)
  end;

  return query
  with actual as (
    select
      public.search_term_key(e.query_raw) as k,
      mode() within group (order by btrim(e.query_raw)) as texto,
      count(*) as n,
      count(*) filter (where e.has_results is false) as n_sin,
      count(distinct e.session_id) as ses
    from public.search_events e
    where e.surface = 'tours'
      and e.created_at >= now() - make_interval(days => v_days)
      and length(public.search_term_key(e.query_raw)) >= 2
      and e.query_normalized !~ '@'
      and e.query_normalized !~ '[0-9]{7,}'
    group by 1
  ),
  previo as (
    select public.search_term_key(e.query_raw) as k, count(*) as n
    from public.search_events e
    where e.surface = 'tours'
      and e.created_at >= now() - make_interval(days => v_days * 2)
      and e.created_at <  now() - make_interval(days => v_days)
    group by 1
  )
  select
    a.texto,
    a.n,
    a.n_sin,
    a.ses,
    coalesce(p.n, 0),
    case
      when v_agency is null then false
      else exists (
        select 1
        from public.tours t
        where t.agency_id = v_agency
          and t.is_published is true
          and (
            public.search_term_key(t.destination) = a.k
            or (length(a.k) >= 4 and position(a.k in public.search_term_key(t.name)) > 0)
          )
      )
    end
  from actual a
  left join previo p on p.k = a.k
  where case when p_solo_sin_resultados then a.n_sin else a.n end >= v_min
  order by case when p_solo_sin_resultados then a.n_sin else a.n end desc, a.texto
  limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: terminos con detalle (sin umbral) y cobertura del catalogo.
-- ---------------------------------------------------------------------------
create or replace function public.admin_demand_terms(
  p_days integer default 30,
  p_solo_sin_resultados boolean default false,
  p_limit integer default 100
)
returns table (
  termino text,
  llave text,
  busquedas bigint,
  busquedas_sin_resultados bigint,
  sesiones bigint,
  usuarios_identificados bigint,
  busquedas_periodo_anterior bigint,
  tours_coincidentes bigint,
  agencias_coincidentes bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 7), 365);
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  if not (select public.is_super_admin()) then
    raise exception 'Solo el superadministrador puede ver este reporte' using errcode = '42501';
  end if;

  return query
  with actual as (
    select
      public.search_term_key(e.query_raw) as k,
      mode() within group (order by btrim(e.query_raw)) as texto,
      count(*) as n,
      count(*) filter (where e.has_results is false) as n_sin,
      count(distinct e.session_id) as ses,
      count(distinct e.user_id) as usr
    from public.search_events e
    where e.surface = 'tours'
      and e.created_at >= now() - make_interval(days => v_days)
      and length(public.search_term_key(e.query_raw)) >= 2
    group by 1
  ),
  previo as (
    select public.search_term_key(e.query_raw) as k, count(*) as n
    from public.search_events e
    where e.surface = 'tours'
      and e.created_at >= now() - make_interval(days => v_days * 2)
      and e.created_at <  now() - make_interval(days => v_days)
    group by 1
  ),
  cobertura as (
    select a.k, count(t.id) as tours, count(distinct t.agency_id) as agencias
    from actual a
    join public.tours t
      on t.is_published is true
     and (
       public.search_term_key(t.destination) = a.k
       or (length(a.k) >= 4 and position(a.k in public.search_term_key(t.name)) > 0)
     )
    group by a.k
  )
  select
    a.texto, a.k, a.n, a.n_sin, a.ses, a.usr,
    coalesce(p.n, 0),
    coalesce(c.tours, 0),
    coalesce(c.agencias, 0)
  from actual a
  left join previo p on p.k = a.k
  left join cobertura c on c.k = a.k
  where case when p_solo_sin_resultados then a.n_sin > 0 else true end
  order by case when p_solo_sin_resultados then a.n_sin else a.n end desc, a.texto
  limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: las busquedas de un termino, con quien las hizo (si hubo sesion).
-- ---------------------------------------------------------------------------
create or replace function public.admin_demand_searches(
  p_llave text,
  p_days integer default 90,
  p_limit integer default 200
)
returns table (
  creada_en timestamptz,
  texto_buscado text,
  resultados integer,
  user_id uuid,
  nombre text,
  email text,
  dispositivo text,
  origen text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 90), 7), 365);
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
begin
  if not (select public.is_super_admin()) then
    raise exception 'Solo el superadministrador puede ver este reporte' using errcode = '42501';
  end if;

  return query
  select
    e.created_at,
    e.query_raw,
    e.results_count,
    e.user_id,
    nullif(btrim(concat_ws(' ', u.first_name, coalesce(u.apellido_paterno, u.last_name))), ''),
    u.email,
    e.device,
    e.source
  from public.search_events e
  left join public.users u on u.id = e.user_id
  where e.surface = 'tours'
    and e.created_at >= now() - make_interval(days => v_days)
    and public.search_term_key(e.query_raw) = public.search_term_key(p_llave)
  order by e.created_at desc
  limit v_limit;
end;
$$;

revoke all on function public.admin_demand_terms(integer, boolean, integer) from public, anon;
revoke all on function public.admin_demand_searches(text, integer, integer) from public, anon;
grant execute on function public.admin_demand_terms(integer, boolean, integer) to authenticated;
grant execute on function public.admin_demand_searches(text, integer, integer) to authenticated;

comment on function public.admin_demand_terms(integer, boolean, integer) is
  'Solo superadmin. Terminos buscados sin umbral, con usuarios distintos y cobertura del catalogo.';
comment on function public.admin_demand_searches(text, integer, integer) is
  'Solo superadmin. Busquedas de un termino con nombre y correo de quien las hizo (si hubo sesion).';

-- ---------------------------------------------------------------------------
-- Guardia de insercion en search_events.
-- ---------------------------------------------------------------------------
create index if not exists idx_search_events_session_created
  on public.search_events (session_id, created_at desc)
  where session_id is not null;

create or replace function public.search_events_guardia()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.session_id is null then
    return new;
  end if;

  -- Misma busqueda de la misma sesion en 5 minutos: se descarta en silencio.
  if exists (
    select 1
    from public.search_events e
    where e.session_id = new.session_id
      and e.surface = new.surface
      and e.created_at > now() - interval '5 minutes'
      and public.search_term_key(e.query_raw) = public.search_term_key(new.query_raw)
  ) then
    return null;
  end if;

  -- Tope por sesion y hora.
  if (
    select count(*) from public.search_events e
    where e.session_id = new.session_id
      and e.created_at > now() - interval '1 hour'
  ) >= 120 then
    return null;
  end if;

  return new;
end;
$$;

revoke all on function public.search_events_guardia() from public, anon, authenticated;

create or replace trigger trg_search_events_guardia
  before insert on public.search_events
  for each row execute function public.search_events_guardia();
