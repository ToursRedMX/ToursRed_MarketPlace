/**
 * Lectura de variables de entorno que NO pueden faltar.
 *
 * Por que existe: media docena de funciones llamaban
 * `createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))`
 * sin `!` y sin comprobar nada. `Deno.env.get` devuelve `string | undefined`,
 * asi que eso era un error de tipos (TS2345) sobre un caso que ademas es real:
 * si la variable falta, `createClient(undefined, undefined)` truena con
 * "supabaseUrl is required", un mensaje que no dice CUAL de las dos falto ni en
 * que funcion.
 *
 * La alternativa que ya usa medio repo es un `!` pegado a cada `Deno.env.get`.
 * Silencia el tipo pero no mejora el mensaje: preferimos fallar con el nombre
 * de la variable, que es lo unico que hace falta para arreglarlo.
 *
 * Lanza a proposito. Todos los llamadores corren dentro de `Deno.serve`, que
 * convierte una excepcion en 500: una funcion sin sus credenciales no tiene
 * nada util que hacer, y seguir con `undefined` solo mueve el fallo mas lejos
 * del sitio donde se puede entender.
 */
export function envRequerida(nombre: string): string {
  const valor = Deno.env.get(nombre);
  if (!valor) {
    throw new Error(`Falta la variable de entorno ${nombre}`);
  }
  return valor;
}
