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
export function enlaceReservas(base: string): string {
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('url_plataforma_invalida');
  const link = new URL('/traveler/bookings', url).toString();
  if (link.length > 85 || segmentosSms(link).encoding !== 'GSM-7') throw new Error('url_plataforma_demasiado_larga');
  return link;
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
