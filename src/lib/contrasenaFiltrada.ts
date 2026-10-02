// ¿Supabase rechazo la contrasena por aparecer en filtraciones conocidas?
//
// Hasta el 02-oct-2026 esto se decidia en 14 lugares con la misma regex sobre el
// TEXTO del error: /leaked|pwned|compromised|common password/. Supabase cambio
// la redaccion a "Password is known to be weak and easy to guess, please choose
// a different one." y ya no casaba en ninguno: el reset de contrasena devolvia
// un 500 con "Error al actualizar la contrasena", y los registros mostraban el
// mensaje crudo en ingles. Se encontro probando el reset de un admin con
// "Admin123!" (auth_logs: weak_password, reasons ["pwned"]).
//
// Ahora se mira el CODIGO, que es contrato de la API: AuthWeakPasswordError
// trae code "weak_password" y reasons ("length" | "characters" | "pwned"). Solo
// "pwned" es "filtrada"; las otras dos razones son reglas de longitud o de
// caracteres y merecen otro mensaje, asi que no se cuentan aqui.
//
// El texto queda de respaldo para errores que ya llegan envueltos en un
// `new Error(mensaje)` y perdieron el codigo por el camino.
//
// supabase/functions/verify-reset-code/index.ts tiene su propia copia de esta
// regla: las Edge Functions no importan de src/.
export function esContrasenaFiltrada(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, reasons, message } = error as { code?: unknown; reasons?: unknown; message?: unknown };

  if (code === 'weak_password' && Array.isArray(reasons)) {
    return reasons.includes('pwned');
  }
  return typeof message === 'string' &&
    /known to be weak|leaked|pwned|compromised|common password/i.test(message);
}
