-- Alias de busquedas: "sian kan", "Sian Kaan" y "sian ka an" son el mismo destino.
--
-- POR QUE
--
-- search_term_key solo une diferencias de puntuacion y mayusculas. Los viajeros
-- escriben los nombres mayas y otros de pronunciacion rara de muchas formas
-- ("sian kan" / "Sian Kaan", "kabah" / "kabá", "tulum" / "tulun"), y cada
-- variante quedaba como un termino aparte, sin llegar al minimo de 3 busquedas
-- que se le exige a las agencias.
--
-- COMO FUNCIONA
--
--   * search_term_aliases: variante -> forma canonica. Un solo nivel (una
--     variante apunta directo a la canonica, nunca a otra variante).
--   * search_term_canonical(texto) = llave canonica de un texto buscado. Todo
--     el reporte (agencias y admin) y el aviso "Avisame" agrupan/comparan por
--     esa llave, asi que un alias aplica tambien a lo ya registrado.
--   * El admin ve SUGERENCIAS por parecido (pg_trgm + distancia de edicion)
--     contra el catalogo y contra otros terminos buscados, y las aprueba o
--     descarta. Nada se une solo: una union equivocada mezclaria destinos.
--   * Las agencias siguen sin ver quien busco ni los alias; solo ven el total
--     unido bajo la forma canonica.
--
-- Todo lo que escribe es solo superadmin y pasa por funciones.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists fuzzystrmatch with schema extensions;

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------
create table if not exists public.search_term_aliases (
  alias_key       text primary key,
  canonical_key   text not null,
  canonical_label text not null,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.users(id) on delete set null,
  constraint search_term_aliases_distintas check (alias_key <> canonical_key),
  constraint search_term_aliases_largo check (length(alias_key) between 2 and 80 and length(canonical_key) between 2 and 80)
);

create index if not exists idx_search_term_aliases_canonical
  on public.search_term_aliases (canonical_key);

create table if not exists public.search_alias_dismissed (
  alias_key     text not null,
  candidate_key text not null,
  created_at    timestamptz not null default now(),
  primary key (alias_key, candidate_key)
);

alter table public.search_term_aliases enable row level security;
alter table public.search_alias_dismissed enable row level security;

create policy "Superadmin ve los alias"
  on public.search_term_aliases for select to authenticated
  using (public.is_super_admin());

create policy "Superadmin ve los descartes"
  on public.search_alias_dismissed for select to authenticated
  using (public.is_super_admin());

revoke all on public.search_term_aliases from anon, authenticated;
revoke all on public.search_alias_dismissed from anon, authenticated;
grant select on public.search_term_aliases to authenticated;
grant select on public.search_alias_dismissed to authenticated;

-- ---------------------------------------------------------------------------
-- Llave canonica
-- ---------------------------------------------------------------------------
create or replace function public.search_key_canonical(k text)
returns text
language sql
stable
set search_path to 'public'
as $$
  select coalesce(
    (select a.canonical_key from public.search_term_aliases a where a.alias_key = k),
    k);
$$;

create or replace function public.search_term_canonical(txt text)
returns text
language sql
stable
set search_path to 'public'
as $$
  select public.search_key_canonical(public.search_term_key(txt));
$$;

-- ---------------------------------------------------------------------------
-- Reporte de agencias: agrupa por llave canonica.
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
      public.search_term_canonical(e.query_raw) as k,
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
    select public.search_term_canonical(e.query_raw) as k, count(*) as n
    from public.search_events e
    where e.surface = 'tours'
      and e.created_at >= now() - make_interval(days => v_days * 2)
      and e.created_at <  now() - make_interval(days => v_days)
    group by 1
  )
  select
    coalesce(
      (select x.canonical_label from public.search_term_aliases x where x.canonical_key = a.k limit 1),
      a.texto),
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
            public.search_term_canonical(t.destination) = a.k
            or (length(a.k) >= 4 and position(a.k in public.search_term_key(t.name)) > 0)
          )
      )
    end
  from actual a
  left join previo p on p.k = a.k
  where case when p_solo_sin_resultados then a.n_sin else a.n end >= v_min
  order by case when p_solo_sin_resultados then a.n_sin else a.n end desc, 1
  limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: terminos (misma firma), agrupados por llave canonica.
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
      public.search_term_canonical(e.query_raw) as k,
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
    select public.search_term_canonical(e.query_raw) as k, count(*) as n
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
       public.search_term_canonical(t.destination) = a.k
       or (length(a.k) >= 4 and position(a.k in public.search_term_key(t.name)) > 0)
     )
    group by a.k
  )
  select
    coalesce(
      (select x.canonical_label from public.search_term_aliases x where x.canonical_key = a.k limit 1),
      a.texto),
    a.k, a.n, a.n_sin, a.ses, a.usr,
    coalesce(p.n, 0),
    coalesce(c.tours, 0),
    coalesce(c.agencias, 0)
  from actual a
  left join previo p on p.k = a.k
  left join cobertura c on c.k = a.k
  where case when p_solo_sin_resultados then a.n_sin > 0 else true end
  order by case when p_solo_sin_resultados then a.n_sin else a.n end desc, 1
  limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: las busquedas de un termino (incluye las de sus variantes).
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
  v_k text;
begin
  if not (select public.is_super_admin()) then
    raise exception 'Solo el superadministrador puede ver este reporte' using errcode = '42501';
  end if;

  v_k := public.search_term_canonical(p_llave);

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
    and public.search_term_canonical(e.query_raw) = v_k
  order by e.created_at desc
  limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Avisame: el tour coincide por la llave canonica (los alias aplican a avisos
-- ya pedidos).
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
              public.search_term_canonical(t.destination) = public.search_key_canonical(a.term_key)
              or (length(public.search_key_canonical(a.term_key)) >= 4
                  and position(public.search_key_canonical(a.term_key) in public.search_term_key(t.name)) > 0)
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
                   public.search_term_canonical(t.destination) = public.search_key_canonical(r.term_key)
                   or (length(public.search_key_canonical(r.term_key)) >= 4
                       and position(public.search_key_canonical(r.term_key) in public.search_term_key(t.name)) > 0)
                 )
               order by coalesce(t.published_at, t.created_at) desc
               limit 5
            ) x)
    from reclamados r
    join public.users u on u.id = r.user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: gestionar alias.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_search_alias(p_alias text, p_canonical text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_alias_k text;
  v_can_k   text;
  v_label   text;
begin
  if not (select public.is_super_admin()) then
    raise exception 'Solo el superadministrador puede administrar alias' using errcode = '42501';
  end if;

  v_alias_k := public.search_term_key(p_alias);
  v_can_k   := public.search_term_canonical(p_canonical);

  if length(v_alias_k) < 2 or length(v_can_k) < 2 or v_alias_k = v_can_k then
    raise exception 'Alias no valido' using errcode = '22023';
  end if;

  -- Si la forma canonica elegida ya es alias de otra, se usa la de esa; el
  -- nombre que se muestra es el que ya tenia.
  select a.canonical_label into v_label
    from public.search_term_aliases a
   where a.alias_key = public.search_term_key(p_canonical);
  v_label := coalesce(v_label, left(btrim(coalesce(p_canonical, '')), 80));

  insert into public.search_term_aliases (alias_key, canonical_key, canonical_label, created_by)
  values (v_alias_k, v_can_k, v_label, auth.uid())
  on conflict (alias_key) do update
    set canonical_key = excluded.canonical_key,
        canonical_label = excluded.canonical_label,
        created_by = excluded.created_by,
        created_at = now();

  -- Lo que apuntaba a la variante ahora apunta a la canonica (un solo nivel).
  update public.search_term_aliases
     set canonical_key = v_can_k, canonical_label = v_label
   where canonical_key = v_alias_k;
end;
$$;

create or replace function public.admin_remove_search_alias(p_alias_key text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (select public.is_super_admin()) then
    raise exception 'Solo el superadministrador puede administrar alias' using errcode = '42501';
  end if;
  delete from public.search_term_aliases where alias_key = p_alias_key;
end;
$$;

create or replace function public.admin_dismiss_alias_suggestion(p_alias_key text, p_candidate_key text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (select public.is_super_admin()) then
    raise exception 'Solo el superadministrador puede administrar alias' using errcode = '42501';
  end if;
  insert into public.search_alias_dismissed (alias_key, candidate_key)
  values (p_alias_key, p_candidate_key)
  on conflict do nothing;
end;
$$;

create or replace function public.admin_search_aliases()
returns table (
  alias_key text,
  canonical_key text,
  canonical_label text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not (select public.is_super_admin()) then
    raise exception 'Solo el superadministrador puede ver los alias' using errcode = '42501';
  end if;
  return query
  select a.alias_key, a.canonical_key, a.canonical_label, a.created_at
    from public.search_term_aliases a
   order by a.canonical_label, a.alias_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: sugerencias de union por parecido.
--
-- Compara cada termino buscado contra (1) los destinos del catalogo publicado
-- y (2) otros terminos buscados mas frecuentes. Parecido = distancia de edicion
-- baja sobre la forma sin espacios Y similitud de trigramas. Se prefiere el
-- catalogo. Es una sugerencia: nada se une sin que el admin lo apruebe.
-- ---------------------------------------------------------------------------
create or replace function public.admin_demand_alias_suggestions(
  p_days integer default 90,
  p_limit integer default 30
)
returns table (
  termino text,
  llave text,
  busquedas bigint,
  sugerencia text,
  llave_sugerida text,
  fuente text,
  similitud real
)
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 90), 7), 365);
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 200);
begin
  if not (select public.is_super_admin()) then
    raise exception 'Solo el superadministrador puede ver las sugerencias' using errcode = '42501';
  end if;

  return query
  with buscados as (
    select
      public.search_term_canonical(e.query_raw) as k,
      mode() within group (order by btrim(e.query_raw)) as texto,
      count(*) as n
    from public.search_events e
    where e.surface = 'tours'
      and e.created_at >= now() - make_interval(days => v_days)
      and length(public.search_term_key(e.query_raw)) >= 3
      and e.query_normalized !~ '@'
      and e.query_normalized !~ '[0-9]{7,}'
    group by 1
  ),
  catalogo as (
    select distinct on (public.search_term_canonical(t.destination))
           public.search_term_canonical(t.destination) as k,
           btrim(t.destination) as texto
      from public.tours t
     where t.is_published is true
       and t.destination is not null
       and length(public.search_term_key(t.destination)) >= 3
     order by public.search_term_canonical(t.destination), btrim(t.destination)
  ),
  pares as (
    select b.k as ak, b.texto as atx, b.n as an, c.k as ck, c.texto as ctx, 'catalogo'::text as fuente
      from buscados b
      join catalogo c on c.k <> b.k
     where not exists (select 1 from catalogo c2 where c2.k = b.k)
    union all
    select b.k, b.texto, b.n, o.k, o.texto, 'busquedas'::text
      from buscados b
      join buscados o on o.k <> b.k and (o.n > b.n or (o.n = b.n and o.k < b.k))
  ),
  medidos as (
    select p.*,
           replace(p.ak, ' ', '') as ca,
           replace(p.ck, ' ', '') as cc
      from pares p
  ),
  parecidos as (
    select m.ak, m.atx, m.an, m.ck, m.ctx, m.fuente,
           extensions.similarity(m.ak, m.ck) as sim,
           extensions.levenshtein(m.ca, m.cc) as lev
      from medidos m
     where extensions.levenshtein(m.ca, m.cc)
             <= case when least(length(m.ca), length(m.cc)) <= 5 then 1 else 2 end
       and extensions.similarity(m.ak, m.ck) >= 0.4
       and not exists (
         select 1 from public.search_alias_dismissed d
          where d.alias_key = m.ak and d.candidate_key = m.ck)
  ),
  mejores as (
    select distinct on (x.ak)
           x.atx, x.ak, x.an, x.ctx, x.ck, x.fuente, x.sim
      from parecidos x
     order by x.ak, (x.fuente = 'catalogo') desc, x.lev, x.sim desc
  )
  select m.atx, m.ak, m.an, m.ctx, m.ck, m.fuente, m.sim
    from mejores m
   order by m.an desc, m.sim desc
   limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
revoke all on function public.search_key_canonical(text) from public, anon, authenticated;
revoke all on function public.search_term_canonical(text) from public, anon, authenticated;

revoke all on function public.admin_set_search_alias(text, text) from public, anon;
revoke all on function public.admin_remove_search_alias(text) from public, anon;
revoke all on function public.admin_dismiss_alias_suggestion(text, text) from public, anon;
revoke all on function public.admin_search_aliases() from public, anon;
revoke all on function public.admin_demand_alias_suggestions(integer, integer) from public, anon;
grant execute on function public.admin_set_search_alias(text, text) to authenticated;
grant execute on function public.admin_remove_search_alias(text) to authenticated;
grant execute on function public.admin_dismiss_alias_suggestion(text, text) to authenticated;
grant execute on function public.admin_search_aliases() to authenticated;
grant execute on function public.admin_demand_alias_suggestions(integer, integer) to authenticated;

revoke all on function public.claim_destination_alert_matches(int) from public, anon, authenticated;
grant execute on function public.claim_destination_alert_matches(int) to service_role;
