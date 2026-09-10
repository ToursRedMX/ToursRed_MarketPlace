/**
 * Contexto de la peticion para la bitacora — Req. 10.2 de PCI DSS v4.
 *
 * POR QUE EXISTE
 *
 * Hasta el 10-sep-2026 `extractClientIp` y `maskIp` estaban COPIADAS en tres
 * funciones (`record-session-event`, `check-login-risk`, `geo-lookup`), cada
 * una con su propia version. Este archivo es el unico lugar donde viven.
 *
 * QUE RESUELVE Y QUE NO
 *
 * La migracion `20260910190000` hace que `insert_audit_log` deduzca IP, user
 * agent, sesion y correlacion de `current_setting('request.headers')`, que es
 * lo que PostgREST deja por peticion. Eso cubre lo que el NAVEGADOR escribe
 * directo contra PostgREST, incluidos los renglones que escriben los 8
 * triggers de auditoria.
 *
 * Lo que NO cubre son las escrituras que salen de una Edge Function: ahi
 * PostgREST ve las cabeceras de la peticion INTERNA de la funcion, no las del
 * navegador del usuario. Por eso `cabecerasDeContexto()`: la funcion reenvia
 * el contexto del cliente al crear su cliente de Supabase, y entonces hasta
 * los renglones escritos por trigger salen con el origen correcto.
 */

/**
 * IP real del cliente, en el orden en que los proxies la ponen.
 *
 * `x-forwarded-for` puede venir como "cliente, proxy1, proxy2"; se toma el
 * primero. Este mismo orden esta replicado en el COALESCE de
 * `insert_audit_log` (migracion 20260910190000) para que el valor deducido en
 * SQL coincida con el que reenvia TypeScript.
 */
export function extraerIpDelCliente(req: Request): string | null {
  const candidatos = [
    req.headers.get("cf-connecting-ip"),   // Cloudflare
    req.headers.get("x-real-ip"),          // Nginx / generico
    req.headers.get("x-forwarded-for"),    // Proxy estandar, puede traer lista
    req.headers.get("true-client-ip"),     // Akamai / Cloudflare Enterprise
    req.headers.get("fastly-client-ip"),   // Fastly
  ];

  for (const candidato of candidatos) {
    if (candidato) {
      const ip = candidato.split(",")[0].trim();
      if (ip) return ip;
    }
  }
  return null;
}

/**
 * Enmascara una IP: IPv4 pierde el ultimo octeto, IPv6 los dos ultimos grupos
 * si tiene 4 o mas.
 *
 * OJO — ESTA REGLA VIVE EN DOS SITIOS, A PROPOSITO Y VIGILADA.
 *
 * La otra copia es `public.enmascarar_ip()` en SQL, que es la que usa
 * `insert_audit_log` para derivar `ip_masked` de la bitacora. Esta de aca hace
 * falta igual porque `record-session-event` tambien escribe
 * `user_sessions.ip_masked`, y esa tabla no pasa por `insert_audit_log`.
 *
 * Dos implementaciones de una misma regla se desincronizan solas — este repo
 * ya tuvo que montar `guardia-fiscal` por exactamente eso con la formula del
 * IVA. Aqui la atadura es `scripts/test-contexto-auditoria.mjs`: comprueba
 * esta funcion contra unos vectores y ademas verifica que la migracion afirme
 * los MISMOS vectores en sus ASSERT. Si alguien cambia una de las dos reglas,
 * la otra deja de cumplir los vectores y CI lo dice.
 *
 * Para la bitacora NO hace falta llamarla: `insert_audit_log` deriva
 * `ip_masked` cuando no se lo pasan.
 */
export function enmascararIp(ip: string | null | undefined): string | null {
  if (!ip || !ip.trim()) return null;

  if (ip.includes(".")) {
    const partes = ip.split(".");
    partes[partes.length - 1] = "xxx";
    return partes.join(".");
  }

  const partes = ip.split(":");
  if (partes.length >= 4) {
    partes[partes.length - 1] = "xxx";
    partes[partes.length - 2] = "xxx";
  }
  return partes.join(":");
}

/**
 * Cabeceras a reenviar cuando una Edge Function habla con PostgREST, para que
 * el contexto que vea la base sea el del CLIENTE y no el de la funcion.
 *
 * Se usan al construir el cliente:
 *
 *     const supabase = createClient(url, key, {
 *       global: { headers: { ...cabecerasDeContexto(req) } },
 *     });
 *
 * Solo se incluye lo que de verdad venga en la peticion: reenviar una cabecera
 * vacia haria que la base creyera saber el origen cuando no lo sabe, y un dato
 * de origen inventado es peor que no tener ninguno.
 */
export function cabecerasDeContexto(req: Request): Record<string, string> {
  const cabeceras: Record<string, string> = {};

  const ip = extraerIpDelCliente(req);
  if (ip) cabeceras["x-forwarded-for"] = ip;

  const ua = req.headers.get("user-agent");
  if (ua) cabeceras["user-agent"] = ua;

  // Se propaga la correlacion si el cliente la trae; si no, se abre una para
  // esta peticion, de modo que todo lo que escriba comparta identificador.
  const correlacion = req.headers.get("x-correlation-id") ?? crypto.randomUUID();
  cabeceras["x-correlation-id"] = correlacion;

  return cabeceras;
}
