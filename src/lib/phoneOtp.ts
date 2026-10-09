import { supabase } from './supabase';

export const phoneOtpMessages: Record<string, string> = {
  OTP_CHANNEL_INVALID: 'Selecciona SMS o WhatsApp para recibir el código.',
  OTP_INVALID: 'El código no es válido. Revisa los seis dígitos.',
  OTP_EXPIRED: 'El código venció. Solicita uno nuevo.',
  OTP_COOLDOWN: 'Espera 60 segundos antes de solicitar otro código.',
  OTP_LOCKED: 'Se alcanzó el límite de intentos. Vuelve a intentarlo mañana.',
  OTP_RATE_LIMIT: 'Se alcanzó el límite de solicitudes. Intenta más tarde.',
  PHONE_UNAVAILABLE: 'Este teléfono no está disponible para verificar esta cuenta. Usa otro número o contacta a soporte.',
  PHONE_REAUTH_REQUIRED: 'Para cambiar el teléfono, cierra sesión y vuelve a iniciar sesión con tu método habitual. Después regresa aquí.',
  OTP_SIMULATION: 'El servicio está en simulación. Esta prueba no puede verificar un teléfono real.',
  SMS_UNAVAILABLE: 'El servicio de verificación no está disponible temporalmente. Contacta a soporte.',
  pais_no_soportado: 'Ese país todavía no tiene cobertura habilitada. Contacta a soporte para revisar la cobertura; la verificación sigue siendo necesaria.',
  telefono_invalido: 'Revisa el número y su código de país.',
  pais_invalido: 'Selecciona un país válido.',
  usa_formato_mexicano_52: 'Para México utiliza +52 y diez dígitos, sin el antiguo 1 adicional.',
  CAPTCHA_REQUIRED: 'Completa la verificación de seguridad.',
  CAPTCHA_INVALID: 'Repite la verificación de seguridad.',
  EMAIL_OR_ACCOUNT_REQUIRED: 'Primero verifica tu correo electrónico.',
};

export async function invokePhoneOtp(name: string, body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let code = 'OTP_UNAVAILABLE';
    if (error.context instanceof Response) {
      try { code = (await error.context.json()).code ?? code; } catch { /* generic message */ }
    }
    throw new Error(phoneOtpMessages[code] ?? 'No se pudo completar la solicitud. Intenta más tarde.');
  }
  return data;
}
