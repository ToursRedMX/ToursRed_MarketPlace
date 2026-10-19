// Envio de un correo transaccional sencillo por el proveedor configurado en `email_settings`
// (SMTP2GO o SendGrid, con respaldo opcional: ver `_shared/correo/enviarCorreo.ts`). Devuelve true
// solo si el proveedor lo acepto; nunca lanza ni registra el cuerpo (puede llevar un codigo).
import { enviarCorreo } from "./correo/enviarCorreo.ts";
import type { ClienteCorreo } from "./correo/tipos.ts";

export async function enviarCorreoSimple(
  admin: ClienteCorreo,
  para: string,
  asunto: string,
  html: string,
): Promise<boolean> {
  try {
    return (await enviarCorreo(admin, { para, asunto, html })).ok;
  } catch {
    console.error("enviarCorreoSimple: fallo el envio");
    return false;
  }
}

/** Marco comun de los correos de seguridad: sin contenido libre, solo texto ya escapado por quien llama. */
export function marcoCorreoSeguridad(titulo: string, cuerpoHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
<div style="background: #667eea; padding: 24px; border-radius: 10px 10px 0 0; text-align: center;"><h1 style="color: white; margin: 0; font-size: 22px;">${titulo}</h1></div>
<div style="background: #f9f9f9; padding: 28px; border-radius: 0 0 10px 10px;">${cuerpoHtml}
<p style="font-size: 12px; color: #999; margin-top: 28px; padding-top: 16px; border-top: 1px solid #ddd;">ToursRed · Este mensaje es automático por motivos de seguridad de tu cuenta.</p></div></body></html>`;
}

/** j***@dominio.com: lo bastante para reconocerlo, no para copiarlo. */
export function enmascararCorreo(correo: string): string {
  const [local, dominio] = correo.split("@");
  if (!local || !dominio) return "***";
  return `${local.slice(0, 1)}***@${dominio}`;
}
