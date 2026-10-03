// Minimo de seguridad para cualquier contrasena de la plataforma.
//
// Hasta el 03-oct-2026 eran 6 caracteres sin exigir nada mas, repetidos en 6
// lugares (alta de viajero sin validar nada en el cliente, alta de agencia,
// alta de ejecutivo, los dos resets y el cambio de contrasena ya logueado,
// este ultimo el unico que exigia mayuscula/minuscula/numero). No es
// requisito de PCI para estas cuentas -- el Requisito 8 del SAQ A aplica solo
// a las cuentas que administran el servidor web (Netlify, Supabase), no a
// viajeros/agencias/admins/ejecutivos (ver docs/pci/mapeo-saq-a.md) -- es
// decision de producto de Axel (pendiente 3 de la entrada 33).
//
// supabase/functions/_shared/politicaContrasena.ts tiene su propia copia:
// las Edge Functions no importan de src/.
export const LONGITUD_MINIMA_CONTRASENA = 8;

export function validarContrasena(password: string): string | null {
  if (password.length < LONGITUD_MINIMA_CONTRASENA) {
    return `La contraseña debe tener al menos ${LONGITUD_MINIMA_CONTRASENA} caracteres`;
  }
  if (!/[A-Z]/.test(password)) {
    return 'La contraseña debe contener al menos una letra mayúscula';
  }
  if (!/[a-z]/.test(password)) {
    return 'La contraseña debe contener al menos una letra minúscula';
  }
  if (!/[0-9]/.test(password)) {
    return 'La contraseña debe contener al menos un número';
  }
  return null;
}
