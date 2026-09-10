import { createClient } from "npm:@supabase/supabase-js@2.116.0";

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
 *
 * El 08-sep-2026 se adopto en las funciones send-* al cerrar A-1. El primer
 * paso NO fue tocar codigo: fue levantar el inventario de llamadores reales de
 * cada una (grep sobre src/, supabase/functions/ y supabase/migrations/) y
 * clasificarlas por como las llaman de verdad. Salieron cuatro grupos, y varias
 * sorpresas que habrian roto caminos vivos si se hubiera aplicado
 * "solo service role" a todas:
 *
 *   - 5 funciones edge llamaban a otra send-* SIN ninguna cabecera
 *     Authorization (resend-agency-credentials, fix-agency-email,
 *     convert-lead-to-agency, create-executive-user,
 *     manage-membership-subscription).
 *   - 3 llamadas edge->edge mandaban la ANON key
 *     (process-receptivo-slot-cancellation, process-slot-reschedule-request).
 *   - 3 crons de Postgres mandan el service role en el header `apikey`, no en
 *     Authorization; uno mandaba la publishable key.
 *   - 4 se llaman desde el front con la llave publicable porque no hay sesion
 *     (formulario de contacto, cotizaciones, recuperar contrasena, alta con
 *     codigo de referido): esas no pueden exigir autenticacion y se acotaron de
 *     otra forma.
 */

/**
 * El cliente admin lo crea este modulo, no lo recibe.
 *
 * La primera version lo recibia como parametro, y eso obligaba a que la funcion
 * que llama al guard y este archivo importen la MISMA version de supabase-js.
 * No es el caso: la mitad del repo importa @2 y la otra mitad @2.39.6, asi que
 * pasar el cliente daba un TS2345 por tipos estructuralmente distintos. Crearlo
 * aqui evita el problema de raiz y de paso quita una linea repetida en cada
 * funcion que adopta el guard.
 *
 * Es un cliente sin sesion: solo se usa para resolver el JWT del llamador y
 * leer users.role.
 */
function clienteAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

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

/**
 * Las llamadas que salen de Postgres (net.http_post en triggers y crons) NO
 * mandan Authorization: mandan la credencial en el header `apikey`. Es la forma
 * que exige el formato nuevo de llaves de Supabase (sb_secret_/sb_publishable_),
 * que el gateway rechaza en Authorization: Bearer. Ver la migracion
 * 20260821212354_fix_pg_net_calls_use_apikey_header_for_new_key_format_compat.
 *
 * Por eso el guard mira los dos sitios. No es un relajo del control: la
 * comparacion sigue siendo contra el SERVICE_ROLE_KEY exacto.
 */
function leerApikey(req: Request): string {
  return (req.headers.get("apikey") ?? "").trim();
}

function esServiceRoleKey(credencial: string): boolean {
  const clave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // La comparacion con cadena vacia siempre seria verdadera si la variable
  // faltara y la credencial viniera vacia: por eso se exige longitud en las dos.
  return Boolean(clave) && credencial.length > 0 && credencial === clave;
}

/** true si el service role viene por Authorization o por apikey. */
function llamadaInterna(req: Request): boolean {
  return esServiceRoleKey(leerBearer(req)) || esServiceRoleKey(leerApikey(req));
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
  if (!llamadaInterna(req)) {
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
  req: Request,
  { recurso, cors }: OpcionesBase,
): Promise<ResultadoAuth> {
  if (llamadaInterna(req)) {
    return { ok: true, llamador: { esServiceRole: true, esAdmin: true, userId: null } };
  }

  const bearer = leerBearer(req);

  if (!bearer) {
    return { ok: false, response: json({ error: "No autenticado" }, 401, cors) };
  }

  const admin = clienteAdmin();
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
  req: Request,
  { recurso, cors }: OpcionesBase,
): Promise<ResultadoAuth> {
  const previo = await requireUser(req, { recurso, cors });
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
  req: Request,
  { ownerUserId, recurso, cors }: OpcionesBase & { ownerUserId: string | null | undefined },
): Promise<ResultadoAuth> {
  const previo = await requireUser(req, { recurso, cors });
  if (!previo.ok) return previo;

  const { esServiceRole, esAdmin, userId } = previo.llamador;
  if (esServiceRole || esAdmin) return previo;

  if (ownerUserId && ownerUserId === userId) return previo;

  console.warn(`${recurso}: usuario ${userId} no es dueno (dueno ${ownerUserId ?? "desconocido"}), rechazado`);
  return { ok: false, response: json({ error: "No tienes permiso sobre este recurso" }, 403, cors) };
}

async function tieneRolAdmin(admin: ReturnType<typeof clienteAdmin>, userId: string): Promise<boolean> {
  const { data } = await admin.from("users").select("role").eq("id", userId).maybeSingle();
  // Nota (igual que en cfdiAuth.ts): el super_admin real del esquema es la
  // columna booleana users.is_super_admin. Aqui no se consulta porque es una
  // escalacion SOBRE admin, no una via alterna para serlo.
  const rol = (data as { role?: string } | null)?.role;
  return rol === "admin" || rol === "super_admin";
}
