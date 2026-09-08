// Vigilancia de llamadas "fire and forget" — M-6 de la auditoria del 05-sep-2026.
//
// ============================================================================
// EL PROBLEMA ES PEOR QUE "HAY CATCH VACIOS"
// ============================================================================
//
// El hallazgo describia catch vacios que se tragan el error. La realidad es
// otra, y peor:
//
//     EdgeRuntime.waitUntil(
//       supabase.functions.invoke("send-cfdi-email", { ... }).catch(() => {})
//     );
//
// **Ni `fetch()` ni `functions.invoke()` rechazan la promesa cuando la
// respuesta es 4xx o 5xx.** `fetch` solo rechaza si falla la RED.
// `functions.invoke` resuelve con `{ data, error }` y nunca lanza.
//
// O sea que ese `.catch(() => {})` no esta tragando el error: el error NUNCA
// LLEGA AHI. Si `send-cfdi-email` devuelve 500 —el viajero no recibio su
// CFDI—, la promesa se resuelve correctamente y nadie mira el resultado. El
// catch es decorativo y el camino de fallo que importa no se comprueba.
//
// Es exactamente la misma trampa que ya mordio a este repo en `c968c1d`,
// donde `.rpc().catch()` reventaba los 5 webhooks de pago porque
// `PostgrestFilterBuilder` es thenable pero no es una Promise.
//
// ============================================================================
// QUE HACEN ESTAS FUNCIONES
// ============================================================================
//
// Comprueban las DOS cosas —que la promesa no se rompa y que la respuesta sea
// buena— y dejan rastro cuando algo falla:
//
//   1. `console.error`, que sale en los logs de la funcion.
//   2. una fila en `public.audit_errors`, que es consultable, tiene fecha y
//      sobrevive a la rotacion de logs.
//
// Es el mismo criterio que se aplico del lado de SQL en M-4 con las tres
// `snapshot_*_tax`: no se trata de fallar o no fallar, sino de que el fallo se
// haga visible en el momento.
//
// NINGUNA DE ESTAS FUNCIONES LANZA. Se usan dentro de `EdgeRuntime.waitUntil`,
// donde una excepcion no la recoge nadie, y el trabajo principal ya termino:
// que el aviso falle no puede tumbar un cobro que ya se hizo.

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

/**
 * Escribe el fallo en los logs y, en la medida de lo posible, en
 * `public.audit_errors`. Nunca lanza.
 *
 * Se usa REST directo en vez de `createClient` a proposito: la mitad del repo
 * importa `supabase-js@2` y la otra mitad `@2.39.6`, y este modulo lo importan
 * las dos. Un `fetch` a PostgREST no tiene ese problema de tipos ni arrastra
 * una dependencia mas al bundle de 16 funciones.
 */
export async function registrarFallo(
  contexto: string,
  detalle: unknown,
  datos?: Record<string, unknown>,
): Promise<void> {
  const mensaje = detalle instanceof Error
    ? detalle.message
    : typeof detalle === "string"
    ? detalle
    : JSON.stringify(detalle);

  console.error(`[fallo-silencioso] ${contexto}: ${mensaje}`, datos ?? {});

  if (!supabaseUrl || !serviceKey) return;

  try {
    await fetch(`${supabaseUrl}/rest/v1/audit_errors`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        error_message: `${contexto}: ${mensaje}`.slice(0, 4000),
        sqlstate: null,
        raw_payload: { contexto, ...(datos ?? {}) },
      }),
    });
  } catch {
    // Dejar el rastro nunca puede romper el flujo que se estaba salvando.
    // Mismo patron que el BEGIN anidado de `insert_audit_log` en SQL.
  }
}

/**
 * Para encadenar detras de `fetch(...)` a otra Edge Function.
 *
 * `fetch` NO rechaza en 4xx/5xx, asi que hay que mirar `res.ok` a mano. Eso es
 * justo lo que faltaba en los 20 sitios que tenian `.catch(() => {})`.
 *
 *     fetch(url, { ... })
 *       .then((res) => vigilarRespuesta(res, "contexto"))
 *       .catch((e) => registrarFallo("contexto", e))
 *
 * Se disena para encadenar, no para envolver, para que aplicarlo a los sitios
 * existentes sea un cambio de una linea y no una reestructuracion.
 */
export async function vigilarRespuesta(
  res: Response,
  contexto: string,
  datos?: Record<string, unknown>,
): Promise<void> {
  if (res.ok) return;
  let cuerpo = "";
  try {
    cuerpo = (await res.text()).slice(0, 500);
  } catch {
    cuerpo = "(no se pudo leer el cuerpo)";
  }
  await registrarFallo(contexto, `HTTP ${res.status}: ${cuerpo}`, datos);
}

/**
 * Para encadenar detras de `supabase.functions.invoke(...)`.
 *
 * `invoke` NO lanza en respuestas no-2xx: devuelve `{ data, error }`. Un
 * `.catch()` solo, sin mirar `error`, deja pasar exactamente el caso que
 * importa.
 */
export async function vigilarResultado(
  r: unknown,
  contexto: string,
  datos?: Record<string, unknown>,
): Promise<void> {
  // `unknown` y no `{ error?: unknown }` a proposito: el tipo concreto que
  // devuelve `invoke` cambia entre supabase-js@2 y @2.39.6, y este modulo lo
  // importan funciones de las dos. Estrechar aqui evita que la anotacion del
  // llamador tenga que coincidir con ninguna de las dos.
  const err = (r as { error?: unknown } | null | undefined)?.error;
  if (err) {
    await registrarFallo(contexto, err, datos);
  }
}
