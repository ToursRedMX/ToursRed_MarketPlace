/**
 * `fetch` que agrega `x-correlation-id` a lo que va a PostgREST y NO a lo que
 * va a las Edge Functions.
 *
 * POR QUE NO VA EN `global.headers`
 *
 * El 11-sep-2026 la correlacion se puso en `global.headers` del cliente. Se
 * comprobo el preflight de PostgREST, que la admite, pero supabase-js manda
 * esas mismas cabeceras en `supabase.functions.invoke()`, y NINGUNA de las
 * 172 Edge Functions la tiene en `Access-Control-Allow-Headers`. El navegador
 * cortaba el preflight: cada `functions.invoke` del front (43 llamadas, entre
 * ellas cancelar una reserva) fallo del 11 al 25-sep con «Request header field
 * x-correlation-id is not allowed». Las que llaman con `fetch()` directo,
 * como `create-checkout-session`, no la llevaban y por eso siguieron
 * funcionando, lo que escondio el problema.
 *
 * Las Edge Functions generan su propia correlacion si no les llega
 * (`cabecerasDeContexto`), asi que no se pierde nada en la bitacora.
 */
export function crearFetchConCorrelacion(
  correlacion: string,
  fetchBase: typeof fetch = (...args) => fetch(...args),
): typeof fetch {
  return (input, init) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL ? input.href : input.url;
    if (url.includes('/functions/v1/')) return fetchBase(input, init);

    const cabeceras = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (!cabeceras.has('x-correlation-id')) cabeceras.set('x-correlation-id', correlacion);
    return fetchBase(input, { ...init, headers: cabeceras });
  };
}
