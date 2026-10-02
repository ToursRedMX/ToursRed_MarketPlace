-- Bitácora cruda de búsquedas de viajeros (02-oct-2026).
--
-- POR QUÉ EXISTE
-- Para poder responder, con datos propios, "qué destinos busca la gente" y
-- "qué busca y no encuentra" (demanda sin resultados), y ofrecérselo a las
-- agencias como reporte agregado.
--
-- DECISIÓN DE DISEÑO: captura CRUDA, normalización DESPUÉS.
-- Hoy hay 5 tours de prueba y 7 destinos de catálogo; normalizar contra eso
-- sesgaría todo. Se guarda exactamente lo que escribió el usuario
-- (query_raw) y una normalización ligera que NO depende de ningún catálogo
-- (query_normalized: minúsculas, sin acentos, espacios colapsados). Cuando haya
-- volumen real se construye una tabla de alias y se rellena un destino a
-- posteriori, también hacia atrás: el texto original siempre se conserva.
--
-- results_count NULL = no se midió; 0 = búsqueda sin resultados. Por eso la
-- métrica de demanda no atendida funciona desde el día uno, sin normalizar.
--
-- Nota: esta migración se aplicó primero en Supabase con apply_migration y el
-- ledger la registró como 20261002155309; este archivo lleva esa misma versión
-- para que local == remoto (ver CLAUDE.md, regla 1).

-- Normalización ligera de texto (sin catálogo): minúsculas, sin acentos, espacios colapsados.
create or replace function public.normalize_search_text(txt text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(
    btrim(
      regexp_replace(
        translate(lower(txt), 'áàäâéèëêíìïîóòöôúùüûñ', 'aaaaeeeeiiiioooouuuun'),
        '\s+', ' ', 'g'
      )
    ),
    ''
  )
$$;

-- Bitácora cruda de búsquedas. Se captura todo lo que escribe el usuario;
-- la normalización contra destinos se hace después con datos reales.
create table public.search_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  session_id text check (session_id is null or char_length(session_id) <= 100),
  user_id uuid references public.users(id) on delete set null,
  surface text not null default 'tours' check (char_length(surface) <= 50),
  query_raw text not null check (char_length(query_raw) between 1 and 200),
  query_normalized text generated always as (public.normalize_search_text(query_raw)) stored,
  results_count integer check (results_count is null or results_count >= 0),
  has_results boolean generated always as (results_count > 0) stored,
  filters jsonb not null default '{}'::jsonb check (pg_column_size(filters) < 4096),
  source text check (source is null or char_length(source) <= 100),
  device text check (device is null or device in ('mobile','desktop','tablet')),
  language text check (language is null or char_length(language) <= 20),
  country text check (country is null or char_length(country) <= 60),
  region text check (region is null or char_length(region) <= 100)
);

comment on table public.search_events is 'Bitácora cruda de búsquedas de viajeros. query_raw es lo que escribió el usuario; query_normalized solo minúsculas/sin acentos (no depende del catálogo). results_count NULL = no se midió; 0 = búsqueda sin resultados. No guardar IP ni datos personales.';
comment on column public.search_events.session_id is 'ID de sesión anónimo generado en el cliente, sin datos personales.';
comment on column public.search_events.surface is 'Dónde se buscó: tours (default), y luego otras verticales del ecosistema.';
comment on column public.search_events.filters is 'Filtros usados: fechas, personas, categoría, precio, etc.';

create index search_events_created_at_idx on public.search_events (created_at desc);
create index search_events_query_normalized_idx on public.search_events (query_normalized);
create index search_events_sin_resultados_idx on public.search_events (created_at desc) where has_results = false;

alter table public.search_events enable row level security;

-- Solo inserción para visitantes y usuarios; lectura solo para admin. Sin update/delete (bitácora inmutable).
revoke all on public.search_events from anon, authenticated;
grant insert on public.search_events to anon, authenticated;
grant select on public.search_events to authenticated;

create policy "Anyone can log search"
  on public.search_events for insert
  to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));

create policy "Admins can view searches"
  on public.search_events for select
  to authenticated
  using ((select public.current_user_is_admin()));
