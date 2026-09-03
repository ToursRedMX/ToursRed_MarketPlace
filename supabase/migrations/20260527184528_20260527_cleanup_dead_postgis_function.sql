
DROP FUNCTION IF EXISTS public.search_tours_by_departure_radius(
  double precision,
  double precision,
  double precision,
  text[],
  text,
  numeric,
  numeric,
  integer
);
