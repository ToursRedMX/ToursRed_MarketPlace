import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Guards de autorizacion compartidos para Edge Functions.
 *
 * POR QUE EXISTE ESTE ARCHIVO
 *
 * La auditoria del 05-sep-2026 encontro 10 hallazgos en las 171 funciones, y la
 * conclusion de fondo fue que no son 10 descuidos sino UNA causa: no habia un
 * guard compartido, asi que cada funcion reimplementaba —o se olvidaba de— su
 * propio control de acceso. La prueba es que la logica correcta ya estaba
 * escrita en el repo varias veces (cfdiAuth.ts, paypal-webhook,
 * create-paypal-order, process-payment-plan-tour-deadline) y los agujeros
 * estaban justo donde nadie la replico.
 *
 * Este modulo es el punto 1 de "cerrar la llave": que llamar al guard sea mas
 * facil que escribirlo a mano. Sigue el molde de _shared/cfdiAuth.ts, que es el
 * ejemplo que la auditoria senala como bien hecho.
 *
 * LO QUE HAY QUE ENTENDER ANTES DE USARLO
 *
 * `verify_jwt = true` en config.toml NO significa "hay un usuario detras".
 * Significa "el JWT esta firmado por este proyecto", y la llave publicable que
 * viaja en el bundle del front cumple eso. Por eso `verify_jwt` no autoriza
 * nada por si solo, y por eso ~81 funciones quedaron alcanzables sin cuenta.
 * El guard va DENTRO de la funcion, siempre.
 *
 * CRITERIO COMUN
 *
 *   - Fallan cerrado. Si no se puede determinar quien llama, se rechaza.
 *   - Devuelven una Response en vez de lanzar, para que el llamador no tenga
 *     que envolver en try/catch ni recordar el codigo de estado correcto.
 *   - El service role pasa como maxima autoridad: son los llamadores internos
 *     (webhooks, crons, funcion a funcion). Antes de usarlo verifica que los
 *     llamadores reales de tu funcion lo manden: pasarse de estricto rompe
 *     caminos vivos en silencio.
 *
 * ADOPCION
 *
 * Se adopta funcion por funcion, verificando primero quien llama a cada una.
 * No es un refactor masivo: sustituir un guard que hoy funciona por uno nuevo
 * sin comprobar a sus llamadores es exactamente como se rompen los caminos de
 * pago.
 */

type ClienteAdmin = ReturnType<typeof createClient>;

const corsPorDefecto = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

export interface Llamador {
  /** true cuando el bearer es el SERVICE_ROLE_KEY (llamador interno). */
  esServiceRole: boolean;
  esAdmin: boolean;
  /** null cuando el llamador es el service role: no hay persona detras. */
  userId: string | null;
}

export type ResultadoAuth =
  | { ok: true; llamador: Llamador }
  | { ok: false; response: Response };

interface OpcionesBase {
  /** Etiqueta para el log de intentos denegados. Se lee en produccion. */
  recurso: string;
  /** Headers CORS de la funcion, si no son los de por defecto. */
  cors?: Record<string, string>;
}

function json(body: Record<string, unknown>, status: number, cors?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...(cors ?? corsPorDefecto), "Content-Type": "application/json" },
  });
}

function leerBearer(req: Request): string {
  return (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
}

function esServiceRoleKey(bearer: string): boolean {
  const clave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // La comparacion con cadena vacia siempre seria verdadera si la variable
  // faltara y el bearer viniera vacio: por eso se exige longitud en los dos.
  return Boolean(clave) && bearer.length > 0 && bearer === clave;
}

/**
 * Solo llamadores internos. Para crons y funciones que nadie debe disparar a
 * demanda desde el navegador.
 *
 * No consulta la base, asi que es sincrono y no cuesta nada.
 *
 * Antes de usarlo: confirma que el cron o la funcion que la invoca mande el
 * SERVICE_ROLE_KEY. Si alguna la llama con la sesion de un usuario, esto la
 * rompe con un 401.
 */
export function requireServiceRole(req: Request, { recurso, cors }: OpcionesBase): ResultadoAuth {
  const bearer = leerBearer(req);

  if (!esServiceRoleKey(bearer)) {
    console.warn(`${recurso}: llamada sin service role, rechazada`);
    return { ok: false, response: json({ error: "No autorizado" }, 401, cors) };
  }

  return { ok: true, llamador: { esServiceRole: true, esAdmin: true, userId: null } };
}

/**
 * Exige una persona autenticada (o el service role). Devuelve su userId.
 *
 * La llave publicable cae aqui: es un JWT valido del proyecto pero no de un
 * usuario, asi que getUser no devuelve a nadie y termina en 401.
 */
export async function requireUser(
  admin: ClienteAdmin,
  req: Request,
  { recurso, cors }: OpcionesBase,
): Promise<ResultadoAuth> {
  const bearer = leerBearer(req);

  if (esServiceRoleKey(bearer)) {
    return { ok: true, llamador: { esServiceRole: true, esAdmin: true, userId: null } };
  }

  if (!bearer) {
    return { ok: false, response: json({ error: "No autenticado" }, 401, cors) };
  }

  const { data: { user }, error } = await admin.auth.getUser(bearer);
  if (error || !user) {
    console.warn(`${recurso}: bearer sin usuario detras, rechazado`);
    return { ok: false, response: json({ error: "No autenticado" }, 401, cors) };
  }

  const esAdmin = await tieneRolAdmin(admin, user.id);
  return { ok: true, llamador: { esServiceRole: false, esAdmin, userId: user.id } };
}

/** Exige admin o super_admin (o service role). */
export async function requireAdmin(
  admin: ClienteAdmin,
  req: Request,
  { recurso, cors }: OpcionesBase,
): Promise<ResultadoAuth> {
  const previo = await requireUser(admin, req, { recurso, cors });
  if (!previo.ok) return previo;

  if (!previo.llamador.esAdmin) {
    console.warn(`${recurso}: usuario ${previo.llamador.userId} no es admin, rechazado`);
    return { ok: false, response: json({ error: "Requiere permisos de administrador" }, 403, cors) };
  }

  return previo;
}

/**
 * Exige que sea el dueno del recurso, un admin, o el service role.
 *
 * `ownerUserId` se lee de la base ANTES de llamar aqui, no del cuerpo de la
 * peticion: si el llamador puede decir de quien es el recurso, el guard no
 * guarda nada.
 */
export async function requireOwnerOrAdmin(
  admin: ClienteAdmin,
  req: Request,
  { ownerUserId, recurso, cors }: OpcionesBase & { ownerUserId: string | null | undefined },
): Promise<ResultadoAuth> {
  const previo = await requireUser(admin, req, { recurso, cors });
  if (!previo.ok) return previo;

  const { esServiceRole, esAdmin, userId } = previo.llamador;
  if (esServiceRole || esAdmin) return previo;

  if (ownerUserId && ownerUserId === userId) return previo;

  console.warn(`${recurso}: usuario ${userId} no es dueno (dueno ${ownerUserId ?? "desconocido"}), rechazado`);
  return { ok: false, response: json({ error: "No tienes permiso sobre este recurso" }, 403, cors) };
}

async function tieneRolAdmin(admin: ClienteAdmin, userId: string): Promise<boolean> {
  const { data } = await admin.from("users").select("role").eq("id", userId).maybeSingle();
  // Nota (igual que en cfdiAuth.ts): el super_admin real del esquema es la
  // columna booleana users.is_super_admin. Aqui no se consulta porque es una
  // escalacion SOBRE admin, no una via alterna para serlo.
  const rol = (data as { role?: string } | null)?.role;
  return rol === "admin" || rol === "super_admin";
}
