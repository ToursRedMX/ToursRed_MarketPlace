import type { MensajeSms, ProveedorSms, ResultadoEnvio } from '../tipos.ts';
import { segmentosSms } from '../plantillas.ts';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  messagingServiceSid?: string;
  from?: string;
  whatsappFrom?: string;
  whatsappContentSid?: string;
  testAccountSid?: string;
  testAuthToken?: string;
}
export const messageSidValid = (sid: unknown): sid is string => typeof sid === 'string' && /^SM[0-9a-fA-F]{32}$/.test(sid);
const accountValid = (sid: string) => /^AC[0-9a-fA-F]{32}$/.test(sid);
const phoneValid = (phone: string) => /^\+[1-9]\d{7,14}$/.test(phone);
const serviceValid = (sid: string) => /^MG[0-9a-fA-F]{32}$/.test(sid);
const record = (data: unknown): Record<string, unknown> => data !== null && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};

export function estadoTwilio(status: unknown): 'aceptado' | 'enviado' | 'entregado' | 'fallido' | null {
  if (['accepted', 'scheduled', 'queued', 'sending'].includes(String(status))) return 'aceptado';
  if (status === 'sent') return 'enviado';
  if (status === 'delivered') return 'entregado';
  if (status === 'read') return 'entregado';
  if (['failed', 'undelivered', 'canceled'].includes(String(status))) return 'fallido';
  return null;
}

export function clasificarTwilio(status: number, value: unknown, simulated: boolean): ResultadoEnvio {
  const data = record(value);
  if (status >= 200 && status < 300 && messageSidValid(data.sid) && estadoTwilio(data.status)) {
    // Even an immediate terminal response has an identity: reconcile it, never fallback.
    return { estado: simulated ? 'simulado' : 'aceptado', idProveedor: data.sid };
  }
  if (status >= 400 && status < 500 && status !== 408) {
    const code = Number(data.code);
    // Only explicit API refusals. Opt-out, geo restrictions, fraud and content
    // failures MUST NOT be bypassed with another provider (including HTTP 403).
    const confirmed = (status === 401 && code === 20003) || (status === 429 && code === 20429);
    return { estado: 'fallido', clase: confirmed ? 'rechazo_confirmado' : 'permanente', codigo: Number.isInteger(code) && code > 0 ? `twilio_${code}` : `twilio_http_${status}` };
  }
  return { estado: 'resultado_desconocido', codigo: 'twilio_respuesta_ambigua' };
}

export function twilio(config: TwilioConfig, transport: typeof fetch = fetch): ProveedorSms & {
  comprobar(): Promise<boolean>;
  comprobarWhatsApp(): Promise<boolean>;
  consultar(sid: string): Promise<TwilioMessage | null>;
  saldoMonetario(): Promise<{ amount: number; currency: string } | null>;
} {
  const base = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}`;
  const credentialsValid = accountValid(config.accountSid) && /^[0-9a-fA-F]{32}$/.test(config.authToken);
  const senderValid = config.messagingServiceSid ? serviceValid(config.messagingServiceSid) : phoneValid(config.from ?? '');
  async function get(url: string): Promise<Record<string, unknown> | null> {
    if (!credentialsValid) return null;
    try {
      const response = await transport(url, { headers: { Authorization: `Basic ${btoa(config.accountSid + ':' + config.authToken)}` }, redirect: 'error', signal: AbortSignal.timeout(10000) });
      return response.ok ? record(await response.json()) : null;
    } catch { return null; }
  }
  return {
    nombre: 'twilio',
    async enviar(message: MensajeSms): Promise<ResultadoEnvio> {
      if (!phoneValid(message.destino) || !message.texto || segmentosSms(message.texto).segments > 3) return { estado: 'fallido', clase: 'permanente', codigo: 'mensaje_invalido' };
      let account = config.accountSid, token = config.authToken;
      const body = new URLSearchParams({ To: message.destino, Body: message.texto });
      if (message.canal === 'whatsapp') {
        if (message.categoria !== 'otp' || !/^\d{6}$/.test(message.codigoOtp ?? '')) return { estado: 'fallido', clase: 'permanente', codigo: 'otp_whatsapp_invalido' };
        // Test credentials do not support WhatsApp; simulation stays local.
        if (message.simulacion) return { estado: 'simulado', idProveedor: `mock-whatsapp-${message.correlacion}` };
        if (!credentialsValid || !/^whatsapp:\+[1-9]\d{7,14}$/.test(config.whatsappFrom ?? '') || !/^HX[0-9a-fA-F]{32}$/.test(config.whatsappContentSid ?? '')) return { estado: 'fallido', clase: 'permanente', codigo: 'twilio_whatsapp_config_invalida' };
        try { if (new URL(message.urlEstados).protocol !== 'https:') throw Error(); }
        catch { return { estado: 'fallido', clase: 'permanente', codigo: 'callback_invalido' }; }
        body.delete('Body');
        body.set('To', 'whatsapp:' + message.destino);
        body.set('From', config.whatsappFrom!);
        body.set('ContentSid', config.whatsappContentSid!);
        body.set('ContentVariables', JSON.stringify({ '1': message.codigoOtp }));
        body.set('StatusCallback', message.urlEstados);
        body.set('ValidityPeriod', '600');
      } else
      if (message.simulacion) {
        // Never use live credentials as a test fallback. Without a separate test
        // pair simulation is entirely local and cannot contact any provider.
        if (!config.testAccountSid && !config.testAuthToken) return { estado: 'simulado', idProveedor: `mock-twilio-${message.correlacion}` };
        account = config.testAccountSid ?? ''; token = config.testAuthToken ?? '';
        if (!accountValid(account) || !/^[0-9a-fA-F]{32}$/.test(token) || account === config.accountSid || token === config.authToken) return { estado: 'fallido', clase: 'permanente', codigo: 'twilio_test_config_invalida' };
        body.set('From', '+15005550006');
      } else {
        if (!credentialsValid || !senderValid) return { estado: 'fallido', clase: 'permanente', codigo: 'twilio_config_invalida' };
        if (config.messagingServiceSid) body.set('MessagingServiceSid', config.messagingServiceSid);
        else body.set('From', config.from!);
        try { if (new URL(message.urlEstados).protocol !== 'https:') throw Error(); }
        catch { return { estado: 'fallido', clase: 'permanente', codigo: 'callback_invalido' }; }
        body.set('StatusCallback', message.urlEstados);
        // Do not let a queued OTP arrive after its ten-minute validity window.
        body.set('ValidityPeriod', message.categoria === 'otp' ? '600' : '3600');
      }
      try {
        const response = await transport(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`, {
          method: 'POST', headers: { Authorization: `Basic ${btoa(account + ':' + token)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(), redirect: 'error', signal: AbortSignal.timeout(10000),
        });
        let data: unknown; try { data = await response.json(); } catch { data = null; }
        return clasificarTwilio(response.status, data, message.simulacion);
      } catch { return { estado: 'resultado_desconocido', codigo: 'twilio_transporte_ambiguo' }; }
    },
    async comprobar() {
      // Diagnostico temporal: por que twilio_ready sale false. No imprime
      // accountSid/authToken, solo el paso que fallo.
      if (!senderValid) { console.error('twilio.comprobar: senderValid=false (formato de MessagingServiceSid o From invalido)'); return false; }
      const account = await get(base + '.json');
      if (account?.sid !== config.accountSid || account.status !== 'active') {
        console.error('twilio.comprobar: cuenta no valida', { sid_coincide: account?.sid === config.accountSid, status: account?.status ?? 'sin_respuesta' });
        return false;
      }
      if (config.messagingServiceSid) {
        const service = await get(`https://messaging.twilio.com/v1/Services/${config.messagingServiceSid}`);
        if (service?.sid !== config.messagingServiceSid || service.account_sid !== config.accountSid) {
          console.error('twilio.comprobar: messaging service no valido', { sid_coincide: service?.sid === config.messagingServiceSid, account_coincide: service?.account_sid === config.accountSid, respuesta: service ?? 'sin_respuesta' });
          return false;
        }
        const pool = await get(`https://messaging.twilio.com/v1/Services/${config.messagingServiceSid}/PhoneNumbers?PageSize=100`);
        const listo = Array.isArray(pool?.phone_numbers) && pool.phone_numbers.some((p: unknown) => {
          const item = record(p); return Array.isArray(item.capabilities) && item.capabilities.includes('SMS');
        });
        if (!listo) console.error('twilio.comprobar: sender pool sin numero con capacidad SMS', { cantidad: Array.isArray(pool?.phone_numbers) ? pool.phone_numbers.length : 'sin_respuesta' });
        return listo;
      }
      const result = await get(`${base}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(config.from!)}&PageSize=1`);
      const listo = Array.isArray(result?.incoming_phone_numbers) && result.incoming_phone_numbers.some((p: unknown) => {
        const item = record(p); return item.account_sid === config.accountSid && item.phone_number === config.from && record(item.capabilities).sms === true;
      });
      if (!listo) console.error('twilio.comprobar: numero From no encontrado o sin capacidad SMS', { cantidad: Array.isArray(result?.incoming_phone_numbers) ? result.incoming_phone_numbers.length : 'sin_respuesta' });
      return listo;
    },
    async comprobarWhatsApp() {
      if (!credentialsValid || !/^whatsapp:\+[1-9]\d{7,14}$/.test(config.whatsappFrom ?? '') || !/^HX[0-9a-fA-F]{32}$/.test(config.whatsappContentSid ?? '')) return false;
      const approval = await get(`https://content.twilio.com/v1/Content/${config.whatsappContentSid}/ApprovalRequests`);
      const content = await get(`https://content.twilio.com/v1/Content/${config.whatsappContentSid}`);
      const account = await get(base + '.json');
      const senders = await get('https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp&PageSize=1000');
      const senderReady = Array.isArray(senders?.senders) && senders.senders.some((value: unknown) => {
        const sender = record(value); return sender.sender_id === config.whatsappFrom && sender.status === 'ONLINE';
      });
      return senderReady && account?.sid === config.accountSid && account.status === 'active'
        && approval?.account_sid === config.accountSid && content?.account_sid === config.accountSid
        && record(approval?.whatsapp).status === 'approved' && record(approval?.whatsapp).category === 'AUTHENTICATION'
        && Object.hasOwn(record(content?.types), 'whatsapp/authentication');
    },
    async saldoMonetario() {
      const data = await get(base + '/Balance.json');
      if (data?.account_sid !== config.accountSid || typeof data.balance !== 'string' || !/^-?\d+(\.\d+)?$/.test(data.balance)
        || typeof data.currency !== 'string' || !/^[A-Z]{3}$/.test(data.currency)) return null;
      const amount = Number(data.balance);
      return Number.isFinite(amount) ? { amount, currency: data.currency } : null;
    },
    async consultar(sid: string) {
      if (!messageSidValid(sid)) return null;
      const data = await get(`${base}/Messages/${sid}.json`);
      if (!data || data.sid !== sid || data.account_sid !== config.accountSid || typeof data.to !== 'string' || !/^(whatsapp:)?\+[1-9]\d{7,14}$/.test(data.to)) return null;
      const state = estadoTwilio(data.status); if (!state) return null;
      const price = typeof data.price === 'string' && /^-?\d+(\.\d{1,6})?$/.test(data.price) ? Math.abs(Number(data.price)) : null;
      const unit = typeof data.price_unit === 'string' && /^[a-zA-Z]{3}$/.test(data.price_unit) ? data.price_unit.toUpperCase() : null;
      return { sid, destination: data.to, state, code: /^\d+$/.test(String(data.error_code)) ? `twilio_${data.error_code}` : null,
        cost: unit && price !== null && price < 1e8 ? price : null, unit: price !== null && price < 1e8 ? unit : null };
    },
  };
}
export interface TwilioMessage {
  sid: string; destination: string; state: 'aceptado' | 'enviado' | 'entregado' | 'fallido'; code: string | null; cost: number | null; unit: string | null;
}
