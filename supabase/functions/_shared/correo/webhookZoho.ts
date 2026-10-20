// Lo que Zoho (correos transaccionales / CPaaS) avisa por webhook DESPUES de aceptar un correo: rebotes,
// aperturas, clics. Se convierte en filas de `bitacora_evento_correo`, que se cruzan con
// `bitacora_envio_correo` por la referencia propia que mandamos como `client_reference` (el id de la fila del envio).
//
// Formato (documentacion de Zoho): { event_name: ["hardbounce"], event_message: [{ email_info, event_data, request_id }],
// mailagent_key, webhook_request_id }. El formato del evento «entregado» no esta en la documentacion que se pudo leer,
// asi que el analisis es defensivo: lo que no se reconoce se guarda igual, en `payload`, con tipo «desconocido».
//
// PRIVACIDAD: la apertura y el clic traen IP y ubicacion del viajero (`ip_location_info`) y su navegador; no se
// guardan. Tampoco se registra el cuerpo del webhook en los logs.

export interface FilaEvento {
  proveedor: "zoho";
  tipo: string;
  referencia: string | null;
  id_proveedor: string | null;
  destinatario: string | null;
  detalle: string | null;
  payload: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DETALLE = 500;

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Compara dos secretos sin cortar en el primer caracter distinto. */
export function igualesEnTiempoConstante(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diferencia = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diferencia |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diferencia === 0;
}

/** `Authorization: Bearer <token>` contra el secreto esperado. Sin secreto configurado nunca autoriza. */
export function autorizadoPorToken(cabecera: string | null, esperado: string | null | undefined): boolean {
  if (!esperado) return false;
  const m = (cabecera ?? "").match(/^Bearer\s+(.+)$/i);
  return m ? igualesEnTiempoConstante(m[1].trim(), esperado) : false;
}

function sinDatosDeUbicacion(mensaje: Record<string, unknown>): Record<string, unknown> {
  const copia = structuredClone(mensaje);
  const datos = copia.event_data;
  if (Array.isArray(datos)) {
    for (const d of datos) {
      const detalles = esObjeto(d) ? d.details : null;
      if (Array.isArray(detalles)) {
        for (const det of detalles) {
          if (esObjeto(det)) {
            delete det.ip_location_info;
            delete det.user_agent;
          }
        }
      }
    }
  }
  return copia;
}

export function filasDeWebhookZoho(cuerpo: unknown): FilaEvento[] {
  if (!esObjeto(cuerpo)) return [];
  const nombres = Array.isArray(cuerpo.event_name) ? cuerpo.event_name : [];
  const mensajes = Array.isArray(cuerpo.event_message) ? cuerpo.event_message : [];
  const tipo = texto(nombres[0]) ?? "desconocido";

  const filas: FilaEvento[] = [];
  for (const m of mensajes) {
    if (!esObjeto(m)) continue;
    const info = esObjeto(m.email_info) ? m.email_info : {};
    const referencia = texto(info.client_reference);

    const para = Array.isArray(info.to) ? info.to[0] : null;
    const direccion = esObjeto(para) && esObjeto(para.email_address) ? texto(para.email_address.address) : null;

    // Rebotes: motivo y mensaje de diagnostico (sin el correo del cuerpo).
    let detalle: string | null = null;
    const datos = Array.isArray(m.event_data) ? m.event_data[0] : null;
    const detalles = esObjeto(datos) && Array.isArray(datos.details) ? datos.details[0] : null;
    if (esObjeto(detalles)) {
      const partes = [texto(detalles.reason), texto(detalles.diagnostic_message)].filter(Boolean);
      if (partes.length) detalle = partes.join(" | ").slice(0, MAX_DETALLE);
    }

    filas.push({
      proveedor: "zoho",
      tipo,
      referencia: referencia && UUID.test(referencia) ? referencia.toLowerCase() : null,
      id_proveedor: texto(info.email_reference) ?? texto(m.request_id),
      destinatario: direccion ? direccion.toLowerCase() : null,
      detalle,
      payload: sinDatosDeUbicacion(m),
    });
  }
  return filas;
}
