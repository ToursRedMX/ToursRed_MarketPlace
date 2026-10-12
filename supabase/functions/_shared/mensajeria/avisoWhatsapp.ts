// Correo de aviso de un mensaje entrante de WhatsApp. Logica pura (sin red ni base de
// datos): se prueba con `scripts/test-whatsapp-aviso.mjs`.
//
// CUANDO se manda lo decide la base (`whatsapp_registrar_entrante`, una vez por
// conversacion; ver la migracion 20261012223925). Aqui solo se ARMA el correo.
//
// El nombre del perfil y el texto del mensaje los controla cualquier persona del mundo:
// van escapados en el HTML y sin saltos de linea ni caracteres de control en el asunto
// (un "\r\nBcc: ..." en el nombre no debe poder inyectar cabeceras).

export const DESTINATARIO_AVISO = 'contacto@toursred.com';
/** WhatsApp solo permite texto libre durante 24 h desde el ULTIMO mensaje del cliente. */
export const HORAS_VENTANA = 24;

export const escapeHtml = (valor: string): string => valor
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Una sola linea, sin caracteres de control, recortada. Para el asunto y los datos cortos. */
export function lineaSegura(valor: unknown, max: number): string {
  if (typeof valor !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return valor.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Varias lineas permitidas (la vista previa del mensaje), sin otros caracteres de control. */
export function textoSeguro(valor: unknown, max: number): string {
  if (typeof valor !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return valor.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

export const limiteVentana = (recibidoEn: Date): Date => new Date(recibidoEn.getTime() + HORAS_VENTANA * 3600 * 1000);

/** "13 oct 18:00 (hora CDMX)". Zona explicita: la funcion corre en UTC. */
export function formatoLimite(fecha: Date): string {
  const partes = new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(fecha);
  const dato = (tipo: string) => partes.find(p => p.type === tipo)?.value ?? '';
  const hora = dato('hour') === '24' ? '00' : dato('hour');
  return `${dato('day')} ${dato('month').replace(/\.$/, '')} ${hora}:${dato('minute')} (hora CDMX)`;
}

export interface DatosAviso {
  nombre: string | null;
  telefono: string;
  esUsuario: boolean;
  preview: string;
  numAdjuntos: number;
  recibidoEn: Date;
  /** URL base de la plataforma, p. ej. https://toursred.com (sin barra final). */
  urlPlataforma: string;
}

/** Solo https y sin espacios: la URL viene de la configuracion, pero se valida antes de ponerla en un enlace. */
export const urlPlataformaValida = (url: unknown): url is string => typeof url === 'string' && /^https:\/\/[^\s"'<>]+$/.test(url);

export function armarAviso(d: DatosAviso): { asunto: string; html: string; texto: string } {
  const nombre = lineaSegura(d.nombre, 60);
  const telefono = lineaSegura(d.telefono, 20);
  const quien = nombre || telefono;
  const limite = formatoLimite(limiteVentana(d.recibidoEn));
  const preview = textoSeguro(d.preview, 200);
  const adjuntos = d.numAdjuntos > 0 ? `${d.numAdjuntos} adjunto${d.numAdjuntos === 1 ? '' : 's'}` : '';
  const resumen = [preview, adjuntos && `(${adjuntos})`].filter(Boolean).join(' ') || '(mensaje vacío)';
  const enlace = `${d.urlPlataforma.replace(/\/+$/, '')}/admin/whatsapp-entrantes`;

  const asunto = lineaSegura(`[WhatsApp] Mensaje nuevo de ${quien} — responde antes del ${limite}`, 150);

  const fila = (etiqueta: string, valor: string) =>
    `<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">${etiqueta}</td><td style="padding:8px;border:1px solid #ddd;">${valor}</td></tr>`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color:#16a34a;">Mensaje nuevo de WhatsApp</h2>
      <p>Un cliente escribió al número de ToursRed. WhatsApp solo permite responder con texto libre durante <strong>24 horas</strong> desde su último mensaje.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        ${fila('Cliente', escapeHtml(quien))}
        ${fila('Teléfono', escapeHtml(telefono))}
        ${fila('Usuario registrado', d.esUsuario ? 'Sí' : 'No')}
        ${fila('Mensaje', `<span style="white-space:pre-wrap;">${escapeHtml(resumen)}</span>`)}
        ${fila('Responder antes de', `<strong>${escapeHtml(limite)}</strong>`)}
      </table>
      <p><a href="${escapeHtml(enlace)}" style="display:inline-block;padding:10px 20px;background:#16a34a;color:white;text-decoration:none;border-radius:6px;">Abrir la bandeja de WhatsApp</a></p>
      <p style="color:#6b7280;font-size:12px;margin-top:30px;">Se envía un solo aviso por conversación: los mensajes siguientes de este cliente se acumulan en la bandeja sin generar otro correo, hasta que pasen más de 4 horas sin actividad. Mensaje automático de ToursRed.</p>
    </div>`;
  const texto = [
    'Mensaje nuevo de WhatsApp', '',
    `Cliente: ${quien}`, `Teléfono: ${telefono}`, `Usuario registrado: ${d.esUsuario ? 'Sí' : 'No'}`,
    `Mensaje: ${resumen}`, `Responder antes de: ${limite}`, '',
    `Bandeja: ${enlace}`, '',
    'Se envía un solo aviso por conversación (hasta que pasen más de 4 horas sin actividad).',
  ].join('\n');
  return { asunto, html, texto };
}
