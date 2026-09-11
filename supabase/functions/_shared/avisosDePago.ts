/**
 * Avisos y asientos contables compartidos por los webhooks de pago.
 *
 * POR QUE EXISTE
 *
 * Estas tres funciones vivian dentro de `stripe-webhook/index.ts`. Al conectar
 * las disputas de los otros cuatro procesadores (10-sep-2026) habrian tenido
 * que copiarse cuatro veces. El comentario original de `crearAsientoContable`
 * ya decia por que no: "existe para que las disputas y los payouts no agreguen
 * dos copias mas de la misma logica de numeracion". El argumento no cambia al
 * cruzar un archivo.
 *
 * NO IMPORTA supabase-js, A PROPOSITO
 *
 * Cuando se escribio, `stripe-webhook` usaba `@2.39.6` y los otros webhooks
 * `@2.116.0`: un import aqui metia una segunda copia en el bundle de la mitad
 * de ellos. Misma decision que en `contextoAuditoria.ts` y `disputas.ts`, y
 * por la misma razon medida. *
 * ESA PREMISA YA NO ES CIERTA, Y CONVIENE QUE SE SEPA
 *
 * El 10-sep-2026 los 175 imports de supabase-js se unificaron en `@2.116.0`, y
 * la regla de version unica de `check-edge-deps.mjs` impide que vuelvan a
 * divergir. Hoy un import aqui NO duplicaria nada.
 *
 * El parametro estructural se mantiene igualmente: un modulo compartido que
 * fija una version se la impone a todas las funciones que lo importan, y la
 * proxima subida tendria que pasar por aqui. No cuesta nada y no ata a nadie.
 * Pero a partir de ahora es una preferencia de diseno, no una restriccion: si
 * alguien decide importar supabase-js en este archivo, no estara repitiendo el
 * error de 2026.
 */

/** Lo unico que estas funciones usan del cliente. */
export interface ClienteMinimo {
  from(tabla: string): any;
  rpc(nombre: string, args?: Record<string, unknown>): any;
}

/**
 * Asiento contable generico.
 *
 * La creacion se delega a una RPC transaccional que asigna folio bajo lock,
 * valida el balance e impide duplicar el mismo movimiento por origen.
 */
export async function crearAsientoContable(
  supabase: ClienteMinimo,
  opts: {
    entryType: "ingreso" | "egreso" | "diario" | "apertura";
    descripcion: string;
    sourceType: string;
    sourceId: string;
    lineas: { account_code: string; description: string; debit: number; credit: number }[];
  },
): Promise<string | null> {
  const entryDate = new Date().toISOString().split("T")[0];
  const { data: entryId, error } = await supabase.rpc("create_accounting_entry_atomic", {
    p_entry_type: opts.entryType,
    p_description: opts.descripcion,
    p_source_type: opts.sourceType,
    p_source_id: opts.sourceId,
    p_entry_date: entryDate,
    p_lines: opts.lineas,
  });

  if (error) {
    console.error("Error creando asiento contable:", error);
    throw error;
  }
  return entryId as string | null;
}

/** Notificacion en la app para los administradores. */
export async function notificarAdmins(
  supabase: ClienteMinimo,
  tipo: string,
  titulo: string,
  mensaje: string,
  data: Record<string, unknown>,
): Promise<void> {
  const { data: admins } = await supabase
    .from("users")
    .select("id")
    .in("role", ["admin", "super_admin"]);

  if (!admins?.length) {
    console.warn("No hay administradores a quienes notificar");
    return;
  }

  const { error } = await supabase.from("notifications").insert(
    admins.map((a: { id: string }) => ({
      user_id: a.id,
      type: tipo,
      title: titulo,
      message: mensaje,
      data,
    })),
  );
  if (error) console.error("Error notificando a admins:", error);
}

/**
 * Correo a operaciones, mismo camino que notify-ops-refund-failed: smtp2go con
 * la llave guardada en email_settings.
 *
 * `origen` sale en el pie del correo. Antes decia siempre "webhook de Stripe";
 * ahora lo manda quien llama, porque con cinco procesadores esa linea fija
 * habria mentido en cuatro de cada cinco correos.
 */
export async function alertarOps(
  supabase: ClienteMinimo,
  asunto: string,
  filas: [string, string][],
  origen = "webhook de pagos",
): Promise<void> {
  const { data: emailSettings } = await supabase
    .from("email_settings")
    .select("smtp_api_key, sender_email, platform_url")
    .maybeSingle();

  if (!emailSettings?.smtp_api_key) {
    console.warn(`Sin smtp_api_key: no se envio la alerta "${asunto}"`);
    return;
  }

  const cuerpo = filas
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">${k}</td>` +
        `<td style="padding:8px;border:1px solid #ddd;">${v}</td></tr>`,
    )
    .join("");

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 640px;">
      <h2 style="color:#dc2626;">${asunto}</h2>
      <table style="border-collapse:collapse;width:100%;">${cuerpo}</table>
      <p style="color:#6b7280;font-size:12px;margin-top:30px;">
        Mensaje automatico del ${origen} de ToursRed.
      </p>
    </div>
  `;

  try {
    const res = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: emailSettings.smtp_api_key,
        to: ["contacto@toursred.com"],
        sender: emailSettings.sender_email || "contacto@toursred.com",
        subject: asunto,
        html_body: html,
      }),
    });
    if (!res.ok) console.error("smtp2go rechazo la alerta:", await res.text());
  } catch (e) {
    console.error("Error enviando la alerta a operaciones:", e);
  }
}

/**
 * Empaqueta las tres funciones de arriba con el cliente y el origen ya puestos,
 * en la forma que espera `registrarDisputa` de `./disputas.ts`.
 *
 * Existe para que los cinco webhooks no repitan el mismo cableado de tres
 * lambdas —que es justo donde se cuela una diferencia entre uno y otro.
 */
export function avisosCon(supabase: ClienteMinimo, origen: string) {
  return {
    notificarAdmins: (
      tipo: string,
      titulo: string,
      mensaje: string,
      data: Record<string, unknown>,
    ) => notificarAdmins(supabase, tipo, titulo, mensaje, data),

    alertarOps: (asunto: string, filas: [string, string][]) =>
      alertarOps(supabase, asunto, filas, origen),

    crearAsientoContable: (opts: {
      entryType: "ingreso" | "egreso" | "diario" | "apertura";
      descripcion: string;
      sourceType: string;
      sourceId: string;
      lineas: { account_code: string; description: string; debit: number; credit: number }[];
    }) => crearAsientoContable(supabase, opts),
  };
}
