const basic = new Set(Array.from('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'));
const extension = new Set(Array.from('\f^{}\\[~]|€'));
export function segmentosSms(texto: string): { encoding: 'GSM-7' | 'Unicode'; units: number; segments: number } {
  let units = 0;
  for (const char of texto) {
    if (basic.has(char)) units++;
    else if (extension.has(char)) units += 2;
    else return { encoding: 'Unicode', units: texto.length, segments: texto.length <= 70 ? 1 : Math.ceil(texto.length / 67) };
  }
  return { encoding: 'GSM-7', units, segments: units <= 160 ? 1 : Math.ceil(units / 153) };
}
const clean = (value: string, max: number) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9 .,:/-]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
export function plantillaOtp(code: string): string {
  if (!/^\d{6}$/.test(code)) throw new Error('codigo_invalido');
  return `Tu codigo ToursRed es ${code}. Vence en 10 min. No lo compartas con nadie.`;
}
/**
 * El texto de un OTP con el codigo TACHADO, para guardarlo en la bitacora del admin. El codigo nunca se guarda: se tacha el
 * valor exacto y, ademas, cualquier secuencia de 4 a 8 digitos (por si cambia el formato del codigo o del texto). La base
 * (`record_sms_text`) vuelve a tacharlo: dos defensas, porque un codigo guardado en claro es una cuenta tomada.
 */
export function ocultarCodigoOtp(texto: string, codigo?: string): string {
  const oculto = '••••••';
  let t = texto;
  if (codigo) t = t.split(codigo).join(oculto);
  return t.replace(/\d{4,}/g, oculto);
}
export function enlacePlataforma(base: string, ruta: string): string {
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('url_plataforma_invalida');
  const link = new URL(ruta, url).toString();
  if (link.length > 85 || segmentosSms(link).encoding !== 'GSM-7') throw new Error('url_plataforma_demasiado_larga');
  return link;
}
export function enlaceReservas(base: string): string {
  return enlacePlataforma(base, '/traveler/bookings');
}
export function plantillaConfirmacion(folio: string, base: string): string {
  const text = `ToursRed: tu reserva ${clean(folio, 20)} esta confirmada. Detalles: ${enlaceReservas(base)}`;
  if (segmentosSms(text).segments > 1) throw new Error('plantilla_demasiado_larga');
  return text;
}
export function plantillaRecordatorio(tour: string, punto: string, folio: string, hora = ''): string {
  const time = /^\d{2}:\d{2}/.test(hora) ? ` ${hora.slice(0,5)}` : '';
  return `ToursRed: manana ${clean(tour, 35)}${time}. Encuentro: ${clean(punto, 35)}. Reserva ${clean(folio, 20)}.`;
}

// Avisos a la AGENCIA y a su personal. Siempre un solo segmento GSM-7: se intenta con el nombre del
// tour y, si con un enlace largo no cabe, se manda sin el. Nunca llevan datos del viajero ni el
// contenido de un mensaje.
function unSegmento(conTour: string, sinTour: string): string {
  if (segmentosSms(conTour).segments <= 1) return conTour;
  if (segmentosSms(sinTour).segments <= 1) return sinTour;
  throw new Error('plantilla_demasiado_larga');
}
export function plantillaAgenciaReserva(folio: string, tour: string, base: string): string {
  const link = enlacePlataforma(base, '/agency/bookings');
  const f = clean(folio, 20);
  return unSegmento(
    `ToursRed: nueva reserva ${f} - ${clean(tour, 30)}. Revisala: ${link}`,
    `ToursRed: nueva reserva ${f}. Revisala: ${link}`);
}
export function plantillaAgenciaCancelacion(folio: string, tour: string, base: string): string {
  const link = enlacePlataforma(base, '/agency/bookings');
  const f = clean(folio, 20);
  return unSegmento(
    `ToursRed: se cancelo la reserva ${f} - ${clean(tour, 30)}. Detalles: ${link}`,
    `ToursRed: se cancelo la reserva ${f}. Detalles: ${link}`);
}
export function plantillaAgenciaMensaje(base: string): string {
  const text = `ToursRed: tienes un mensaje nuevo en la plataforma. Responde: ${enlacePlataforma(base, '/messages')}`;
  if (segmentosSms(text).segments > 1) throw new Error('plantilla_demasiado_larga');
  return text;
}

/** El texto de un SMS de la cola segun su categoria y lo que devolvio prepare_sms_notification. */
export function textoDeNotificacion(categoria: string, snapshot: Record<string, string>, base: string): string {
  switch (categoria) {
    case 'reserva_confirmada': return plantillaConfirmacion(snapshot.folio, base);
    case 'recordatorio_tour': return plantillaRecordatorio(snapshot.tour, snapshot.meeting_point, snapshot.folio, snapshot.departure_time);
    case 'agencia_reserva': return plantillaAgenciaReserva(snapshot.folio, snapshot.tour, base);
    case 'agencia_cancelacion': return plantillaAgenciaCancelacion(snapshot.folio, snapshot.tour, base);
    case 'agencia_mensaje': return plantillaAgenciaMensaje(base);
    default: throw new Error('categoria_sin_plantilla');
  }
}
