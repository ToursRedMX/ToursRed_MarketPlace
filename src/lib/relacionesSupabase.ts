/**
 * Relaciones anidadas de supabase-js: por que hace falta castear.
 *
 * Cuando una consulta pide una relacion anidada —`bookings` con `tours(...)`,
 * por ejemplo— PostgREST devuelve un OBJETO si la relacion es a-uno (la llave
 * foranea vive en la tabla que consulta) y un ARREGLO si es a-muchos.
 *
 * supabase-js no puede distinguir los dos casos sin los tipos generados de la
 * base (`supabase gen types`), que este proyecto no tiene: infiere TODA
 * relacion anidada como arreglo. El resultado es un error de tipos en cada
 * `setState` que recibe una fila con relaciones, aunque el dato en tiempo de
 * ejecucion sea correcto.
 *
 * Estos dos helpers existen para que ese casteo se haga en un solo sitio, con
 * la explicacion escrita una sola vez, y para que en el punto de uso quede
 * dicho QUE tipo se espera. No son un `any` disfrazado: quien los llama
 * escribe el tipo destino y asume la carga de que la consulta lo respalde.
 *
 * ANTES DE USARLOS, COMPRUEBA LA DIRECCION DE LA LLAVE. Si la relacion es de
 * verdad a-muchos, el arreglo que infiere supabase-js es CORRECTO y castear a
 * objeto produciria un `undefined` en produccion que el tipo ya no señala. La
 * comprobacion es una consulta:
 *
 *   select tc.table_name, kcu.column_name, ccu.table_name as destino
 *   from information_schema.table_constraints tc
 *   join information_schema.key_column_usage kcu using (constraint_name)
 *   join information_schema.constraint_column_usage ccu using (constraint_name)
 *   where tc.constraint_type = 'FOREIGN KEY' and tc.table_name = '<la tabla>';
 *
 * Si la FK sale de la tabla que consultas, el embebido es a-uno.
 *
 * El dia que se generen los tipos de la base, estos helpers sobran y borrarlos
 * deberia dejar el `tsc` en verde solo.
 */

/** Una fila con relaciones anidadas a-uno. */
export const comoFila = <T>(fila: unknown): T => fila as T;

/** Un conjunto de filas con relaciones anidadas a-uno. Null y undefined dan []. */
export const comoFilas = <T>(filas: unknown): T[] => (filas ?? []) as T[];
