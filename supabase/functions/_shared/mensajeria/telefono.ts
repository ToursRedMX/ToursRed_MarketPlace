import { parsePhoneNumberWithError, isSupportedCountry } from 'npm:libphonenumber-js@1.13.7/max';
import type { CountryCode } from 'npm:libphonenumber-js@1.13.7/max';

export function normalizarTelefonoSms(raw: string, country: string, allowed: string[]): { e164: string; country: string } {
  if (typeof raw !== 'string' || raw.length > 40 || !/^\+?[0-9 ().-]+$/.test(raw.trim())) throw new Error('telefono_invalido');
  if (!isSupportedCountry(country)) throw new Error('pais_invalido');
  // No silently reinterpret old +521 input as a verified current number.
  if (/^\+521\d{10}$/.test(raw.replace(/[ ().-]/g, ''))) throw new Error('usa_formato_mexicano_52');
  const phone = parsePhoneNumberWithError(raw, { defaultCountry: country as CountryCode, extract: false });
  if (!phone.isValid() || !phone.country || phone.ext) throw new Error('telefono_invalido');
  if (!allowed.includes(phone.country)) throw new Error('pais_no_soportado');
  return { e164: phone.number, country: phone.country };
}
