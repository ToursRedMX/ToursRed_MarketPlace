/**
 * Soportes de un gasto: subir, listar, descargar y borrar.
 *
 * Los bytes viven en el bucket PRIVADO `gastos-comprobantes` y la fila en
 * `soportes_de_gasto`. Las dos cosas tienen que moverse juntas o quedan
 * huerfanas, y este modulo es el unico lugar donde se hace.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const BUCKET = 'gastos-comprobantes';

/** Lo que el bucket acepta. Espejo de `allowed_mime_types` en la migracion. */
export const TIPOS_ACEPTADOS = [
  'application/pdf', 'text/xml', 'application/xml',
  'image/jpeg', 'image/png', 'image/webp',
];
export const BYTES_MAXIMOS = 10 * 1024 * 1024;

export interface SoporteDeGasto {
  id: string;
  gasto_id: string;
  ruta: string;
  nombre: string;
  tipo_mime: string | null;
  bytes: number | null;
  subido_por: string | null;
  created_at: string;
}

/**
 * Deja un nombre de archivo apto para una llave de Storage.
 *
 * NO es cosmetico. El nombre viene del disco de quien sube, asi que puede
 * traer `../`, acentos, espacios, emojis o 300 caracteres. Una llave con `..`
 * es una travesia de directorios; una con caracteres raros la rechaza Storage
 * o la deja irrecuperable. Se reduce a lo seguro y se conserva la extension,
 * que es lo unico que el navegador mira al descargar.
 *
 * El nombre BONITO se guarda aparte, en la columna `nombre`: la pantalla
 * muestra ese y la llave puede ser fea sin que a nadie le importe.
 */
export function nombreSeguro(nombre: string): string {
  const limpio = (nombre || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')       // acentos fuera
    .replace(/[^A-Za-z0-9._-]+/g, '-')     // todo lo demas, guion
    .replace(/\.{2,}/g, '.')               // `..` nunca sobrevive
    .replace(/^[.-]+/, '')                 // ni un punto o guion inicial
    .replace(/-{2,}/g, '-')
    .slice(0, 80);
  return limpio || 'archivo';
}

/**
 * La llave dentro del bucket: `<gasto>/<marca de tiempo>-<nombre>`.
 *
 * La marca de tiempo evita que subir dos veces el mismo archivo choque contra
 * el UNIQUE de `ruta`. Prefijar con el id del gasto agrupa los archivos por
 * gasto, que es como se navegan desde el panel de Supabase cuando algo falla.
 */
export function rutaDeSoporte(gastoId: string, nombre: string, ahora = Date.now()): string {
  return `${gastoId}/${ahora}-${nombreSeguro(nombre)}`;
}

/** Lo que NO se puede subir, dicho en español. `null` si se puede. */
export function porQueNoSePuedeSubir(archivo: { type: string; size: number }): string | null {
  if (archivo.size > BYTES_MAXIMOS) {
    return `El archivo pesa ${(archivo.size / 1024 / 1024).toFixed(1)} MB y el limite son 10 MB.`;
  }
  if (archivo.size === 0) return 'El archivo esta vacio.';
  // El tipo puede venir vacio si el sistema no lo reconoce; se deja pasar y que
  // decida el bucket, que es quien manda.
  if (archivo.type && !TIPOS_ACEPTADOS.includes(archivo.type)) {
    return `No se aceptan archivos de tipo ${archivo.type}. Sube un PDF, un XML o una imagen.`;
  }
  return null;
}

/**
 * Sube el archivo y registra su fila. Devuelve el error en español, o null.
 *
 * Si el INSERT falla despues de haber subido, se BORRA el objeto: un archivo en
 * el bucket sin fila que lo apunte no se ve desde ningun lado y nadie lo va a
 * limpiar nunca.
 */
export async function subirSoporte(
  supabase: SupabaseClient,
  gastoId: string,
  archivo: File,
): Promise<string | null> {
  const problema = porQueNoSePuedeSubir(archivo);
  if (problema) return problema;

  const ruta = rutaDeSoporte(gastoId, archivo.name);

  const { error: errorSubida } = await supabase.storage
    .from(BUCKET)
    .upload(ruta, archivo, { contentType: archivo.type || undefined, upsert: false });
  if (errorSubida) return `No se pudo subir el archivo: ${errorSubida.message}`;

  const { error: errorFila } = await supabase.from('soportes_de_gasto').insert({
    gasto_id: gastoId,
    ruta,
    nombre: archivo.name.slice(0, 200),
    tipo_mime: archivo.type || null,
    bytes: archivo.size,
  });

  if (errorFila) {
    // El objeto ya subio pero la fila no entro. Sin esto queda basura invisible.
    await supabase.storage.from(BUCKET).remove([ruta]);
    return `El archivo se subio pero no se pudo registrar, asi que se deshizo: ${errorFila.message}`;
  }
  return null;
}

/**
 * Una URL firmada para abrir o descargar el archivo.
 *
 * El bucket es privado a proposito —una factura trae RFC y domicilio fiscal—
 * asi que no hay URL publica: se firma una que caduca.
 */
export async function urlDeSoporte(
  supabase: SupabaseClient,
  ruta: string,
  segundos = 60,
): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(ruta, segundos);
  if (error) return { url: null, error: `No se pudo abrir el archivo: ${error.message}` };
  return { url: data?.signedUrl ?? null, error: null };
}

/**
 * Borra la fila y el objeto.
 *
 * En ese orden: si el objeto se borrara primero y la fila fallara, la pantalla
 * mostraria un enlace roto. Al reves, lo peor que queda es un objeto huerfano
 * que no se ve — molesto, pero no miente.
 */
export async function borrarSoporte(
  supabase: SupabaseClient,
  soporte: Pick<SoporteDeGasto, 'id' | 'ruta'>,
): Promise<string | null> {
  const { error } = await supabase.from('soportes_de_gasto').delete().eq('id', soporte.id);
  if (error) return `No se pudo borrar el soporte: ${error.message}`;
  const { error: errorObjeto } = await supabase.storage.from(BUCKET).remove([soporte.ruta]);
  if (errorObjeto) {
    console.error('soportesDeGasto: la fila se borro pero el objeto quedo', soporte.ruta, errorObjeto);
  }
  return null;
}

/**
 * Descarga un texto como archivo, sin pasar por el servidor.
 *
 * Es lo que usa el boton de «descargar XML»: el XML ya esta en memoria porque
 * viene en la fila del gasto, asi que pedirlo otra vez seria absurdo.
 */
export function descargarTexto(nombre: string, texto: string, tipo = 'application/xml'): void {
  const url = URL.createObjectURL(new Blob([texto], { type: `${tipo};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Sin esto el blob se queda en memoria hasta que se cierra la pestana.
  URL.revokeObjectURL(url);
}
