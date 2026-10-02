-- Reportes de demanda para agencias, a partir de public.search_events.
--
-- POR QUE
--
-- La bitacora de busquedas (20261002155309) guarda lo que el viajero escribe y
-- cuantos resultados vio. Las agencias NUNCA leen esa tabla: solo admin tiene
-- SELECT, y eso no cambia. Lo que se les ofrece son dos funciones que devuelven
-- AGREGADOS:
--
--   agency_demand_summary  totales del periodo (busquedas, con y sin resultados)
--   agency_demand_top      terminos mas buscados / buscados sin resultados
--
-- REGLAS DE PRIVACIDAD (todas dentro de la funcion, no en el front)
--
--  1. Un termino solo aparece si lo buscaron al menos 3 veces en el periodo
--     (`greatest(p_min, 3)` para agencias). El admin puede bajarlo para revisar.
--  2. Se excluyen terminos con arroba o con 7+ digitos seguidos: alguien que
--     teclea un correo o un telefono en el buscador no debe llegar a un reporte.
--  3. No se devuelve user_id, session_id, dispositivo, idioma ni origen. Solo
--     cuantas sesiones distintas hubo (conteo, sin identificar a nadie).
--  4. Acceso: dueno de la agencia (con onboarding activo), personal activo con
--     `can_view_reports`, o admin. Cualquier otro caso: error 42501.
--
-- LIMITES CONOCIDOS
--
--  - Cualquiera puede insertar en search_events (no hay rate limit), asi que un
--    tercero podria inflar un termino. El umbral de 3 lo frena poco; si esto se
--    vuelve un problema real hay que limitar la insercion, no el reporte.
--  - "cubierto_por_mi" compara contra destino y nombre de los tours PUBLICADOS
--    de la agencia, con la misma normalizacion que la bitacora.

create or replace function public.agency_demand_authorized_agency()
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_agency uuid;
begin
  -- Dueno de la agencia, con onboarding terminado.
  select a.id into v_agency
  from public.agencies a
  where a.user_id = auth.uid()
    and a.onboarding_status = 'active'
  limit 1;
  if v_agency is not null then
    return v_agency;
  end if;

  -- Personal activo con permiso de reportes.
  select s.agency_id into v_agency
  from public.agency_staff s
  join public.agency_staff_permissions p on p.staff_id = s.id
  join public.agencies a on a.id = s.agency_id
  where s.user_id = auth.uid()
    and s.is_active = true
    and p.can_view_reports = true
    and a.onboarding_status = 'active'
  limit 1;
  if v_agency is not null then
    return v_agency;
  end if;

  -- Admin: ve el mercado completo, sin agencia propia.
  if (select public.current_user_is_admin()) then
    return null;
  end if;

  raise exception 'No tienes acceso a los reportes de demanda'
    using errcode = '42501';
end;
$$;

create or replace function public.agency_demand_summary(p_days integer default 30)
returns table (
  periodo_dias integer,
  total_busquedas bigint,
  con_resultados bigint,
  sin_resultados bigint,
  busquedas_periodo_anterior bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 7), 365);
begin
  perform public.agency_demand_authorized_agency();

  return query
  select
    v_days,
    count(*) filter (where e.created_at >= now() - make_interval(days => v_days)),
    count(*) filter (where e.created_at >= now() - make_interval(days => v_days) and e.has_results is true),
    count(*) filter (where e.created_at >= now() - make_interval(days => v_days) and e.has_results is false),
    count(*) filter (where e.created_at < now() - make_interval(days => v_days))
  from public.search_events e
  where e.surface = 'tours'
    and e.created_at >= now() - make_interval(days => v_days * 2);
end;
$$;

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

  -- Las agencias nunca bajan de 3; el admin (v_agency null) puede revisar con menos.
  v_min := case
    when v_agency is null then greatest(coalesce(p_min_busquedas, 3), 1)
    else greatest(coalesce(p_min_busquedas, 3), 3)
  end;

  return query
  with actual as (
    select
      e.query_normalized as qn,
      mode() within group (order by btrim(e.query_raw)) as texto,
      count(*) as n,
      count(*) filter (where e.has_results is false) as n_sin,
      count(distinct e.session_id) as ses
    from public.search_events e
    where e.surface = 'tours'
      and e.created_at >= now() - make_interval(days => v_days)
      and length(e.query_normalized) >= 2
      and e.query_normalized !~ '@'
      and e.query_normalized !~ '[0-9]{7,}'
    group by e.query_normalized
  ),
  previo as (
    select e.query_normalized as qn, count(*) as n
    from public.search_events e
    where e.surface = 'tours'
      and e.created_at >= now() - make_interval(days => v_days * 2)
      and e.created_at <  now() - make_interval(days => v_days)
    group by e.query_normalized
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
            public.normalize_search_text(t.destination) = a.qn
            or position(a.qn in public.normalize_search_text(t.name)) > 0
          )
      )
    end
  from actual a
  left join previo p on p.qn = a.qn
  where case when p_solo_sin_resultados then a.n_sin else a.n end >= v_min
  order by case when p_solo_sin_resultados then a.n_sin else a.n end desc, a.texto
  limit v_limit;
end;
$$;

-- Solo usuarios con sesion; la funcion decide despues si tienen permiso.
revoke all on function public.agency_demand_authorized_agency() from public, anon, authenticated;
revoke all on function public.agency_demand_summary(integer) from public, anon;
revoke all on function public.agency_demand_top(integer, integer, boolean, integer) from public, anon;
grant execute on function public.agency_demand_summary(integer) to authenticated;
grant execute on function public.agency_demand_top(integer, integer, boolean, integer) to authenticated;

comment on function public.agency_demand_summary(integer) is
  'Totales de busquedas del periodo para el reporte de demanda de agencias. Solo agregados.';
comment on function public.agency_demand_top(integer, integer, boolean, integer) is
  'Terminos mas buscados o buscados sin resultados (minimo 3 busquedas para agencias). Sin identificadores.';
