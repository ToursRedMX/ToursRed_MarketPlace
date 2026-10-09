import { validateRequest } from 'npm:twilio@6.1.2/lib/webhooks/webhooks.js';
import { estadoTwilio, messageSidValid } from './proveedores/twilio.ts';

// The public URL is constructed from trusted configuration, never forwarded Host.
export function verifyTwilioSignature(token: string, signature: string, publicUrl: string, params: Record<string, string>): boolean {
  if (!/^[0-9a-fA-F]{32}$/.test(token) || !signature) return false;
  try { return validateRequest(token, signature, publicUrl, params); } catch { return false; }
}
export function parseTwilioCallback(params: Record<string, string>, accountSid: string, allowWhatsApp = false) {
  const state = estadoTwilio(params.MessageStatus);
  const destination = allowWhatsApp ? /^(whatsapp:)?\+[1-9]\d{7,14}$/ : /^\+[1-9]\d{7,14}$/;
  if (params.AccountSid !== accountSid || !messageSidValid(params.MessageSid) || !destination.test(params.To ?? '') || !state) return null;
  return { sid: params.MessageSid, destination: params.To, state, code: /^\d+$/.test(params.ErrorCode ?? '') ? `twilio_${params.ErrorCode}` : null };
}
