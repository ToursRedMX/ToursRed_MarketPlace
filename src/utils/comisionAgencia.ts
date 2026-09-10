/**
 * Tasa efectiva de comision de una agencia, como fraccion (0.15 = 15%).
 *
 * Por que existe esto en vez de un `|| 0.10` en cada sitio:
 *
 * 1. `agencies.commission_rate` ES NULLABLE. La migracion 20260703020012 le
 *    quito el NOT NULL y el DEFAULT 0.10, y lo sustituyo por un trigger que
 *    lo rellena desde `platform_settings`. Pero ese trigger es BEFORE INSERT:
 *    un UPDATE que deje la columna en NULL la deja en NULL. O sea, null es
 *    alcanzable.
 *
 * 2. `0` ES UN VALOR LEGITIMO. El propio input de esta pantalla acepta 0
 *    (`Math.max(0, parsed)`), porque un acuerdo de 0% de comision es un
 *    acuerdo real. Con `||`, ese 0 se lee como "sin valor": guardas 0%,
 *    reabres la ficha y ves 10%, y si guardas otra vez se escribe ese 10%.
 *    Con `??` el 0 sobrevive.
 *
 * 3. EL DEFAULT NO ES 10%. Es lo que diga
 *    `platform_settings.agency_commission_percentage` -- hoy 15%. Un 0.10
 *    clavado en el front es un dato viejo que se desincroniza en silencio
 *    el dia que se cambie la configuracion.
 *
 * `parseFloat` sobre texto basura devuelve NaN, y `NaN || 0.10` daba 0.10.
 * Al pasar a `??` eso deja de cubrirse solo, asi que NaN se trata aqui de
 * forma explicita.
 *
 * Mismo criterio que `getEffectiveRate` en AdminTours.tsx.
 */
export const tasaEfectivaAgencia = (
  valorAgencia: number | string | null | undefined,
  defaultPlataformaPct: number,
): number => {
  const n = typeof valorAgencia === 'string' ? parseFloat(valorAgencia) : valorAgencia;
  if (n == null || Number.isNaN(n)) return defaultPlataformaPct / 100;
  return n;
};
