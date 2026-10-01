// Formato unico para los telefonos que se capturan de aqui en adelante: E.164
// (+525512345678), que es lo que piden los proveedores de SMS y WhatsApp.
//
// Hasta el 01-oct-2026 cada formulario guardaba el texto tal cual y en la base
// conviven +525513209470, 5513209470 y " 9831820183". send-password-reset ya
// compara por los ultimos 10 digitos, asi que esos formatos viejos siguen
// funcionando; esto es para no seguir sumando variantes.
//
// Devuelve null si no se puede interpretar: menos de 10 digitos, o una lada
// internacional que no sea la de Mexico sin el "+" que la distinga.
export function normalizarTelefono(texto: string): string | null {
  const limpio = texto.trim();
  const digitos = limpio.replace(/\D/g, '');

  if (limpio.startsWith('+')) {
    return digitos.length >= 11 && digitos.length <= 15 ? `+${digitos}` : null;
  }
  if (digitos.length === 10) return `+52${digitos}`;
  if (digitos.length === 12 && digitos.startsWith('52')) return `+${digitos}`;
  return null;
}
