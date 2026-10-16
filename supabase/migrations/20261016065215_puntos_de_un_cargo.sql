-- Puntos apartados para un cargo, sin consumirlos.
--
-- MercadoPago y PayPal confirman el pago en dos tiempos dentro de la misma
-- Edge Function: primero se verifica el monto cobrado contra lo esperado y
-- despues se registra. Con puntos, lo esperado es el total MENOS los puntos
-- apartados, y esos puntos solo deben consumirse si la verificacion pasa
-- (consumir_puntos_de_cargo, 20261016060535). Esta funcion los lee sin tocar
-- nada: el apartado vivo, o el ya consumido si el webhook llego primero.

CREATE OR REPLACE FUNCTION public.puntos_de_cargo(p_contexto text, p_referencia uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce((
    SELECT puntos FROM puntos_apartados_cargos
     WHERE contexto = p_contexto AND referencia = p_referencia
       AND estado IN ('apartado', 'consumido')
     ORDER BY (estado = 'apartado') DESC, creado_en DESC
     LIMIT 1
  ), 0)
$function$;

REVOKE ALL ON FUNCTION public.puntos_de_cargo(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puntos_de_cargo(text, uuid) TO service_role;
