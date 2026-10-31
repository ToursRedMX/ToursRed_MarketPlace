// Guarda los eventos de un webhook de correo en `bitacora_evento_correo`, sin duplicados y cruzados con su envio.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import type { FilaEventoCorreo, ProveedorEventoCorreo } from "./eventosCorreo.ts";

/**
 * Los eventos que no traen la referencia propia (SMTP2GO nunca; SendGrid si el custom_arg no llego) se cruzan con el
 * envio por el id que devolvio el proveedor al aceptar el correo (`bitacora_envio_correo.id_proveedor`).
 */
export async function resolverReferencias(
  supabase: SupabaseClient,
  proveedor: ProveedorEventoCorreo,
  filas: FilaEventoCorreo[],
): Promise<FilaEventoCorreo[]> {
  const ids = [...new Set(filas.filter((f) => !f.referencia && f.id_proveedor).map((f) => f.id_proveedor as string))];
  if (ids.length === 0) return filas;
  const { data, error } = await supabase
    .from("bitacora_envio_correo")
    .select("id, id_proveedor")
    .eq("proveedor", proveedor)
    .in("id_proveedor", ids);
  // Sin el cruce el evento se guarda igual (con referencia nula): perder el vinculo no debe perder el evento.
  if (error || !data) return filas;
  const porIdProveedor = new Map<string, string>();
  for (const e of data as { id: string; id_proveedor: string }[]) porIdProveedor.set(e.id_proveedor, e.id);
  return filas.map((f) => (!f.referencia && f.id_proveedor && porIdProveedor.has(f.id_proveedor))
    ? { ...f, referencia: porIdProveedor.get(f.id_proveedor) as string }
    : f);
}

/**
 * Un reintento del proveedor no duplica filas: (proveedor, id_evento) es unico y los repetidos se ignoran. Las filas sin
 * id_evento (nulo) nunca chocan entre si.
 */
export async function guardarEventosCorreo(
  supabase: SupabaseClient,
  filas: FilaEventoCorreo[],
): Promise<{ error: { code?: string } | null }> {
  const { error } = await supabase
    .from("bitacora_evento_correo")
    .upsert(filas, { onConflict: "proveedor,id_evento", ignoreDuplicates: true });
  return { error };
}
