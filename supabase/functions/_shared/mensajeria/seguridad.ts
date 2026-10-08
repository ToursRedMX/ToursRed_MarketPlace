const encoder = new TextEncoder();
export async function hmac(secret: string, value: string): Promise<string> {
  if (secret.length < 32) throw new Error('secreto_no_configurado');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
export function nuevoCodigo(): string {
  const value = new Uint32Array(1);
  // Rejection sampling avoids modulo bias. Leading zeroes are valid OTPs.
  do { crypto.getRandomValues(value); } while (value[0] >= 4294000000);
  return String(value[0] % 1000000).padStart(6, '0');
}
export function nuevaCorrelacion(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), b => b.toString(16).padStart(2, '0')).join('');
}
export async function verificarFirma(secret: string, value: string, signature: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(signature) || secret.length < 32) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = Uint8Array.from(signature.match(/../g) ?? [], b => parseInt(b, 16));
  return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(value));
}
export function datosOtp(userId: string, challengeId: string, phone: string, code: string): string {
  return JSON.stringify(['phone-otp-v1', userId, challengeId, phone, code]);
}
