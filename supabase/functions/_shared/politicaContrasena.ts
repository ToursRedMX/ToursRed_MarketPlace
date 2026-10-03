// Copia de src/lib/politicaContrasena.ts: las Edge Functions no importan de
// src/. Ver ahi el porque del minimo (pendiente 3 de la entrada 33, decidido
// por Axel el 03-oct-2026; no es requisito de PCI para estas cuentas).
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
