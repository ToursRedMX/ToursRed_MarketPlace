import type { EventoEntrega, MensajeSms, ProveedorSms, ResultadoEnvio } from '../tipos.ts';
import { segmentosSms } from '../plantillas.ts';

export function clasificarRespuesta(status: number, body: unknown, test: boolean): ResultadoEnvio {
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const code = String(data.code ?? '');
  if (status >= 200 && status < 300 && code === '0' && typeof data.subid === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(data.subid)) {
    return { estado: test ? 'simulado' : 'aceptado', idProveedor: data.subid };
  }
  if ([401, 402, 403, 429].includes(status)) return { estado: 'fallido', clase: 'rechazo_confirmado', codigo: `http_${status}` };
  if (status >= 200 && status < 300 && code === '35') return { estado: 'fallido', clase: 'rechazo_confirmado', codigo: 'lm_35' };
  if (status >= 200 && status < 300 && ['10', '11', '20', '21', '23', '24', '27', '28'].includes(code)) return { estado: 'fallido', clase: 'permanente', codigo: `lm_${code}` };
  // A generic 500 / JSON 30 is not evidence that the SMS was never accepted.
  return { estado: 'resultado_desconocido', codigo: 'respuesta_ambigua' };
}
export function labsmobile(user: string, token: string, sender: string, transport: typeof fetch = fetch): ProveedorSms {
  const configured = user.length > 0 && token.length > 0 && /^[a-zA-Z0-9]{1,11}$/.test(sender);
  const authorization = `Basic ${btoa(user + ':' + token)}`;
  return {
    nombre: 'labsmobile',
    async enviar(m: MensajeSms): Promise<ResultadoEnvio> {
      if (!configured) return { estado: 'fallido', clase: 'rechazo_confirmado', codigo: 'credenciales_no_configuradas' };
      if (!/^\+[1-9]\d{7,14}$/.test(m.destino) || !/^[a-zA-Z0-9_-]{1,20}$/.test(m.correlacion) || !m.texto) return { estado: 'fallido', clase: 'permanente', codigo: 'mensaje_invalido' };
      const size = segmentosSms(m.texto);
      if (size.segments > 3) return { estado: 'fallido', clase: 'permanente', codigo: 'mensaje_demasiado_largo' };
      try {
        const callback = new URL(m.urlEstados);
        if (callback.protocol !== 'https:') return { estado: 'fallido', clase: 'permanente', codigo: 'callback_invalido' };
        const response = await transport('https://api.labsmobile.com/json/send', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
          headers: { Authorization: authorization, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: m.texto, tpoa: sender, recipient: [{ msisdn: m.destino.slice(1) }], subid: m.correlacion,
            label: `toursred:${m.categoria}`, ackurl: m.urlEstados, test: m.simulacion ? 1 : 0, ucs2: size.encoding === 'Unicode' ? 1 : 0, long: size.segments > 1 ? 1 : 0 }),
        });
        let data: unknown;
        try { data = await response.json(); } catch { data = null; }
        return clasificarRespuesta(response.status, data, m.simulacion);
      } catch {
        return { estado: 'resultado_desconocido', codigo: 'transporte_ambiguo' };
      }
    },
    async saldo() {
      if (!configured) return null;
      try {
        const r = await transport('https://api.labsmobile.com/json/balance', { headers: { Authorization: authorization }, redirect: 'error', signal: AbortSignal.timeout(10000) });
        const d = await r.json();
        const n = Number(d.credits);
        return r.ok && String(d.code) === '0' && d.credits != null && Number.isFinite(n) && n >= 0 ? { creditos: n } : null;
      } catch { return null; }
    },
  };
}
export function interpretarCallback(url: URL): EventoEntrega | null {
  const q = url.searchParams, correlacion = q.get('subid') ?? '', msisdn = q.get('msisdn') ?? '';
  const level = q.get('acklevel'), status = q.get('status');
  if (!/^[a-zA-Z0-9_-]{1,20}$/.test(correlacion) || !/^[1-9]\d{7,14}$/.test(msisdn) || !['ok', 'ko'].includes(status ?? '') || !['operator', 'handset', 'error'].includes(level ?? '')) return null;
  const desc = q.get('desc') ?? '';
  const codigo = ['BLOCKED', 'DELIVRD', 'EXPIRED', 'REJECTD', 'UNDELIV', 'UNKNOWN'].includes(desc) ? desc : 'UNKNOWN';
  const stamp = q.get('timestamp') ?? '';
  const timestamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stamp) && Number.isFinite(Date.parse(stamp.replace(' ', 'T') + 'Z')) ? stamp.replace(' ', 'T') + 'Z' : null;
  return { correlacion, destino: '+' + msisdn, estado: status === 'ko' || level === 'error' ? 'fallido' : level === 'handset' ? 'entregado' : 'enviado', codigo, timestamp };
}
