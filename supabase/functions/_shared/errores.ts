/**
 * Saca un mensaje legible de lo que sea que se haya lanzado.
 *
 * Por que existe: `catch (e)` tipa `e` como `unknown` (es lo correcto: en JS se
 * puede lanzar cualquier cosa), y medio centenar de funciones hacian `e.message`
 * directo. Eso no era solo un error de tipos.
 *
 * El caso que de verdad muerde son los errores de Supabase/PostgREST: NO son
 * instancias de Error, son objetos planos `{ message, details, hint, code }`.
 * Un `e instanceof Error ? e.message : String(e)` los convertiria en
 * "[object Object]" — peor que lo que habia. Por eso el orden de abajo mira
 * primero Error, luego string, luego cualquier objeto con `message` de texto, y
 * solo al final serializa.
 *
 * El otro caso es lo que se lanza sin ser Error ni objeto (un string, un
 * numero, un `throw undefined`): ahi `e.message` daba `undefined`, y una
 * respuesta `{ error: undefined }` se serializa como `{}`, o sea que el
 * llamador recibia un JSON vacio en vez de una explicacion.
 *
 * Devuelve siempre un string, nunca lanza: se usa dentro de catch, donde una
 * segunda excepcion tapa la primera.
 */
export function mensajeDeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;

  if (e !== null && typeof e === "object" && "message" in e) {
    const mensaje = (e as { message: unknown }).message;
    if (typeof mensaje === "string" && mensaje.length > 0) return mensaje;
  }

  try {
    const serializado = JSON.stringify(e);
    if (serializado && serializado !== "{}") return serializado;
  } catch {
    // Referencias circulares o BigInt: cae al String() de abajo.
  }

  return String(e);
}
