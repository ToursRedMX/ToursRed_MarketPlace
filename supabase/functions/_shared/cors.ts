// Allowlist de origenes — M-5 de la auditoria de Edge Functions (05-sep-2026).
//
// ============================================================================
// SIRVE PARA DOS COSAS, Y LA SEGUNDA ES LA QUE DE VERDAD IMPORTA
// ============================================================================
//
// 1. La cabecera CORS, que era `Access-Control-Allow-Origin: *` en las 171
//    funciones. Valor real: BAJO. Con `*` el navegador no manda cookies, y el
//    JWT de Supabase vive en localStorage, que una pagina ajena no puede leer.
//    O sea que una web maliciosa solo puede hacer peticiones SIN autenticar,
//    que es lo mismo que puede hacer cualquier servidor. Es defensa en
//    profundidad honesta, no un agujero que se cierra.
//
// 2. **Validar el origen con el que se arman las URLs de retorno de pago.**
//    Esto si es un agujero, y no estaba en el hallazgo. Ocho funciones hacen:
//
//        success_url: `${req.headers.get("origin")}/booking-success?...`
//
//    El header `Origin` lo controla quien llama. Con `Origin: https://falso.com`
//    la sesion de Stripe/PayPal/Conekta se crea con esa URL de retorno, y el
//    viajero que paga DE VERDAD acaba en la pagina del atacante, con el cobro
//    hecho y una pantalla que puede fingir ser la confirmacion. Es un redirect
//    abierto dentro del flujo de pago.
//
//    `create-checkout-session` ademas acepta `success_url` y `cancel_url`
//    directamente del cuerpo de la peticion, sin mirarlos.
//
// ============================================================================
// LOS ORIGENES
// ============================================================================
//
// Axel definio tres: toursred.com, toursred.com.mx y toursredmx.netlify.app.
//
// Se anaden ademas, y conviene que sea explicito por si hay que quitarlos:
//
//   - Las variantes `www.` de los dos dominios propios. Un sitio que responde
//     en `toursred.com` casi siempre responde tambien en `www.toursred.com`, y
//     dejarlas fuera romperia a quien escriba la www.
//
//   - Los previews de Netlify (`deploy-preview-N--toursredmx.netlify.app`).
//     Sin esto, probar un PR contra el backend real deja de funcionar, que es
//     justo el flujo de revision que se usa hoy. Es un patron, no un dominio
//     fijo, y solo acepta el subdominio exacto de este proyecto.
//
// Quitar cualquiera de los dos grupos es borrar unas lineas de aqui.

const ORIGENES_FIJOS = new Set([
  "https://toursred.com",
  "https://www.toursred.com",
  "https://toursred.com.mx",
  "https://www.toursred.com.mx",
  "https://toursredmx.netlify.app",
]);

/** `deploy-preview-163--toursredmx.netlify.app`, solo de este proyecto. */
const PREVIEW_NETLIFY = /^https:\/\/deploy-preview-\d+--toursredmx\.netlify\.app$/;

/** A donde se manda a alguien cuando no hay un origen de confianza. */
export const ORIGEN_PRINCIPAL = "https://toursred.com";

/** Devuelve el origen si esta permitido; si no, null. */
export function origenPermitido(origen: string | null | undefined): string | null {
  if (!origen) return null;
  if (ORIGENES_FIJOS.has(origen)) return origen;
  if (PREVIEW_NETLIFY.test(origen)) return origen;
  return null;
}

/**
 * Cabeceras CORS para una peticion.
 *
 * `Vary: Origin` no es opcional: sin el, cualquier cache intermedia puede
 * servirle a un origen la respuesta que se genero para otro, y la allowlist
 * deja de servir para nada.
 *
 * Si el origen no esta permitido —o no viene, como en una llamada
 * servidor-a-servidor— no se emite `Access-Control-Allow-Origin`. Para un
 * webhook o un cron da igual: esa cabecera solo la mira un navegador.
 */
export function corsHeaders(req: Request): Record<string, string> {
  const base: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
    "Vary": "Origin",
  };
  const permitido = origenPermitido(req.headers.get("origin"));
  if (permitido) base["Access-Control-Allow-Origin"] = permitido;
  return base;
}

/**
 * El origen con el que se pueden armar URLs de retorno de pago.
 *
 * Nunca devuelve un valor controlado por quien llama: o es uno de la lista, o
 * es el dominio principal. Un atacante que mande `Origin: https://falso.com`
 * consigue que al viajero se le devuelva a toursred.com, no a su pagina.
 */
export function origenParaRedirigir(req: Request): string {
  return origenPermitido(req.headers.get("origin")) ?? ORIGEN_PRINCIPAL;
}

/**
 * Valida una URL de retorno que vino en el CUERPO de la peticion.
 *
 * Devuelve la URL si cuelga de un origen permitido; si no, `null` para que el
 * llamador use su valor por defecto. Se compara el origen ya normalizado por
 * `URL`, no con `startsWith` sobre la cadena: `https://toursred.com.evil.io`
 * empieza igual que el dominio bueno y no debe pasar.
 */
export function urlDeRetornoSegura(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return origenPermitido(parsed.origin) ? url : null;
}
