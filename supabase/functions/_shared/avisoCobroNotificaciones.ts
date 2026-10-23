// El correo que avisa, ANTES de que empiece el cobro, que los avisos por SMS pasan a ser una suscripcion mensual.
// Se manda desde send-aviso-cobro-notificaciones (solo admin). Ver la migracion 20261023064502 (a quien se avisa).
//
// Cuida lo que ya mordio con el filtro de spam de Microsoft (23-oct-2026, los correos de cancelacion quedaron en cuarentena con
// SCL:5): lleva SIEMPRE su version en texto plano, un remitente con nombre visible, un solo enlace a la plataforma, y no usa
// vocabulario de dinero devuelto ni mayusculas ni signos de exclamacion. El codigo de verificacion nunca entra al cobro y el correo
// lo dice, para que nadie crea que va a perder el acceso a su cuenta.

export type TipoAviso = "viajero" | "agencia";

export interface DatosAviso {
  tipo: TipoAviso;
  /** Nombre de pila de quien recibe. Vacio -> «Hola». */
  nombre?: string | null;
  /** Solo para agencias: el nombre de la agencia. */
  agencia?: string | null;
  /** Fecha desde la que se cobra (cobro_notificaciones_desde). */
  desde: Date;
  /** Mensualidad en MXN que cobra Stripe, o null si no se pudo leer (el correo dice que se consulta en el perfil). */
  montoMxn: number | null;
  /** https://toursred.com, sin diagonal final. */
  urlBase: string;
}

export interface AvisoConstruido {
  asunto: string;
  html: string;
  texto: string;
}

export const REMITENTE_AVISO = "ToursRed <contacto@toursred.com>";

const escapar = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** «15 de noviembre de 2026», en hora de Mexico (la fecha que el usuario entiende, no la UTC). */
export function fechaLarga(d: Date): string {
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Mexico_City" });
}

export function pesos(monto: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(monto);
}

function enlacePerfil(base: string, tipo: TipoAviso): string {
  const url = new URL(tipo === "agencia" ? "/agency/profile" : "/traveler/profile", base);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("url_plataforma_invalida");
  return url.toString();
}

export function construirAviso(d: DatosAviso): AvisoConstruido {
  const fecha = fechaLarga(d.desde);
  const precio = d.montoMxn != null ? `${pesos(d.montoMxn)} MXN al mes` : "una mensualidad (el monto está en tu perfil)";
  const enlace = enlacePerfil(d.urlBase, d.tipo);
  const saludo = d.nombre?.trim() ? `Hola ${d.nombre.trim()},` : "Hola,";
  const agencia = d.agencia?.trim() || "tu agencia";

  const asunto = `Cambio en los avisos por SMS de ToursRed a partir del ${fecha}`;

  const parrafos: string[] = d.tipo === "agencia"
    ? [
      `A partir del ${fecha}, los avisos por SMS de ${agencia} (nuevas reservas, cancelaciones y mensajes nuevos) pasan a ser una suscripción mensual de ${precio}.`,
      "Se paga una sola vez por agencia y cubre al dueño y a todo el personal.",
      "Ese día se apagan los avisos por SMS de quienes tengan activos, a menos que la agencia ya tenga la suscripción. Para seguir recibiéndolos, contrata la suscripción desde el perfil de la agencia y cada persona vuelve a activar los avisos que quiera.",
    ]
    : [
      `A partir del ${fecha}, los avisos por SMS de tus reservas (confirmación, cancelación y recordatorio del tour) pasan a ser una suscripción mensual de ${precio}.`,
      "Con ToursRed Plus siguen incluidos, sin costo adicional.",
      "Ese día se apagan los avisos por SMS que tienes activos, a menos que tengas ToursRed Plus o la suscripción. Para seguir recibiéndolos, contrata la suscripción desde tu perfil y vuelve a activarlos.",
    ];
  const quedaIgual = "Lo que no cambia: los correos de tus reservas, y los códigos para verificar tu teléfono, que siguen siendo gratis.";
  const porQue = "Recibes este correo porque tienes avisos por SMS activados en ToursRed.";

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapar(asunto)}</title></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 0;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;">
<tr><td style="padding:28px 32px 8px 32px;font-size:20px;font-weight:bold;color:#0e7490;">ToursRed</td></tr>
<tr><td style="padding:8px 32px 0 32px;color:#1f2937;font-size:15px;line-height:1.6;">
<p style="margin:0 0 14px 0;">${escapar(saludo)}</p>
${parrafos.map((p) => `<p style="margin:0 0 14px 0;">${escapar(p)}</p>`).join("\n")}
<p style="margin:0 0 20px 0;">${escapar(quedaIgual)}</p>
<p style="margin:0 0 24px 0;"><a href="${escapar(enlace)}" style="background-color:#0e7490;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block;">Ver mi perfil</a></p>
</td></tr>
<tr><td style="padding:16px 32px 28px 32px;color:#6b7280;font-size:12px;line-height:1.5;border-top:1px solid #e5e7eb;">${escapar(porQue)} Si tienes dudas, responde a contacto@toursred.com.</td></tr>
</table></td></tr></table></body></html>`;

  const texto = [saludo, "", ...parrafos.flatMap((p) => [p, ""]), quedaIgual, "", `Ver mi perfil: ${enlace}`, "", porQue, "Si tienes dudas, responde a contacto@toursred.com."].join("\n");

  return { asunto, html, texto };
}
