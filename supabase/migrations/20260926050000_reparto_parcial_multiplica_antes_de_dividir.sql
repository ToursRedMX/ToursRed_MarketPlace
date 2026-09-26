-- ============================================================================
-- reparto_parcial: multiplicar antes de dividir.
--
-- QUE ESTABA PASANDO
--
-- La primera prueba real de la migracion 20260925240000 (reserva 44bec1b8,
-- 72,500 puntos, anticipo $1,450) cuadro en el total, pero cada parcial salio
-- un punto abajo: a Dolores (parte $450) le tocaban 22,500 puntos y se
-- devolvieron 22,499; a Trinidad ($500), 25,000 y se devolvieron 24,999, con
-- un centavo de mas en Cash cada vez. La cancelacion total compenso la
-- diferencia (la suma final fue exacta), pero cada parcial estaba mal.
--
-- La causa: `floor(points_used * least(1, parte / principal))`. 450/1450 es un
-- decimal periodico; numeric lo trunca, y 72,500 x 0.310344827586... queda en
-- 22,499.9999..., que el floor baja a 22,499. Multiplicando primero
-- (72,500 x 450 / 1,450) la division es exacta.
--
-- CREATE OR REPLACE con la misma firma conserva los permisos (service_role).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reparto_parcial(
  p_points_used integer,
  p_parte numeric,
  p_principal numeric,
  p_porcentaje numeric,
  p_extra_cash numeric DEFAULT 0,
  OUT points_share integer,
  OUT cash numeric,
  OUT puntos integer
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_pct numeric := least(1, greatest(0, coalesce(p_porcentaje, 1)));
  v_parte numeric := greatest(0, coalesce(p_parte, 0));
  v_reparto record;
BEGIN
  IF coalesce(p_principal, 0) > 0 THEN
    -- Multiplicar ANTES de dividir: parte/principal suele ser periodico y el
    -- truncamiento de numeric hacia que el floor perdiera un punto.
    points_share := floor(
      greatest(0, coalesce(p_points_used, 0)) * least(v_parte, p_principal) / p_principal
    )::integer;
  ELSE
    points_share := 0;
  END IF;

  -- El bruto es la parte del principal al porcentaje, mas lo que no se pago
  -- con puntos (seguro). reembolso_por_medio le resta el valor de los puntos.
  v_reparto := public.reembolso_por_medio(v_parte * v_pct + coalesce(p_extra_cash, 0), points_share, v_pct, true);
  cash := v_reparto.cash;
  puntos := v_reparto.puntos;
END;
$function$;

DO $$
DECLARE r record;
BEGIN
  -- El caso que lo destapo (44bec1b8): exacto, sin perder un punto.
  r := public.reparto_parcial(72500, 450, 1450, 1, 0);
  ASSERT r.points_share = 22500 AND r.puntos = 22500 AND r.cash = 225,
    format('Dolores: %s / %s / %s (antes 22,499 y $225.01)', r.points_share, r.puntos, r.cash);
  r := public.reparto_parcial(72500, 500, 1450, 1, 0);
  ASSERT r.points_share = 25000 AND r.puntos = 25000 AND r.cash = 250,
    format('Trinidad: %s / %s / %s (antes 24,999 y $250.01)', r.points_share, r.puntos, r.cash);

  -- Los vectores de 20260925240000 siguen igual.
  r := public.reparto_parcial(25000, 250, 500, 1, 0);
  ASSERT r.points_share = 12500 AND r.cash = 125 AND r.puntos = 12500, 'mitad al 100%';
  r := public.reparto_parcial(25000, 250, 500, 0.5, 0);
  ASSERT r.points_share = 12500 AND r.cash = 62.5 AND r.puntos = 6250, 'mitad al 50%';
  r := public.reparto_parcial(25000, 250, 500, 0, 0);
  ASSERT r.points_share = 12500 AND r.cash = 0 AND r.puntos = 0, 'no_refund';
  r := public.reparto_parcial(25000, 250, 500, 1, 79);
  ASSERT r.cash = 204 AND r.puntos = 12500, 'con seguro';
  r := public.reparto_parcial(0, 5149.5, 6179.4, 1, 395);
  ASSERT r.points_share = 0 AND r.cash = 5544.5 AND r.puntos = 0, 'sin puntos';
  r := public.reparto_parcial(7883, 5149.5, 6179.4, 1, 395);
  ASSERT r.points_share = 6569 AND r.puntos = 6569 AND r.cash = 5478.81, 'c33f7538';
  r := public.reparto_parcial(25000, 250, 0, 1, 0);
  ASSERT r.points_share = 0, 'principal cero';
  r := public.reparto_parcial(25000, 900, 500, 1, 0);
  ASSERT r.points_share = 25000, 'parte > principal se acota';
END;
$$;
