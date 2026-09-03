import { supabase } from './supabase';

/**
 * Validacion del RFC de una agencia contra el registro del SAT, via la Edge
 * Function `validate-agency-rfc` (que da de alta un customer en FacturAPI; ese
 * alta es lo que dispara la validacion contra el SAT).
 *
 * Existe como helper unico a proposito. Antes la llamada estaba copiada en dos
 * pantallas con criterios distintos —una lanzaba excepcion si la funcion
 * fallaba, la otra guardaba igual— y las cinco altas por OAuth simplemente no
 * validaban. Un solo lugar significa un solo criterio.
 *
 * IMPORTANTE: falla cerrado. Si no se pudo obtener un veredicto del SAT, el
 * resultado es 'indeterminado', nunca un ok silencioso. Quien llama decide si
 * eso bloquea, pero no puede confundirlo con "valido".
 */

export type ResultadoRfc =
  /** El SAT reconoce el RFC con esa razon social y regimen. */
  | { ok: true }
  /** El SAT rechazo los datos. `mensaje` es presentable al usuario. */
  | { ok: false; motivo: 'rechazado'; mensaje: string }
  /** No se pudo obtener veredicto (sin sesion, red caida, funcion con error). */
  | { ok: false; motivo: 'indeterminado'; mensaje: string };

export interface DatosFiscalesAgencia {
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  codigoPostal?: string;
}

/** Los tres campos sin los cuales no hay nada que validar. */
export function tieneDatosFiscalesCompletos(d: Partial<DatosFiscalesAgencia>): boolean {
  return Boolean(d.rfc?.trim() && d.razonSocial?.trim() && d.regimenFiscal?.trim());
}

export async function validarRfcAgencia(datos: DatosFiscalesAgencia): Promise<ResultadoRfc> {
  const rfc = datos.rfc.trim();
  const razonSocial = datos.razonSocial.trim();
  const regimenFiscal = datos.regimenFiscal.trim();

  if (!rfc || !razonSocial || !regimenFiscal) {
    return {
      ok: false,
      motivo: 'indeterminado',
      mensaje: 'Faltan RFC, razon social o regimen fiscal para validar contra el SAT.',
    };
  }

  let token: string;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return {
        ok: false,
        motivo: 'indeterminado',
        mensaje: 'No hay sesion activa para validar el RFC contra el SAT.',
      };
    }
    token = session.access_token;
  } catch {
    return {
      ok: false,
      motivo: 'indeterminado',
      mensaje: 'No se pudo leer la sesion para validar el RFC contra el SAT.',
    };
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-agency-rfc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        rfc,
        razon_social: razonSocial,
        regimen_fiscal: regimenFiscal,
        postal_code: datos.codigoPostal?.trim() || undefined,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      motivo: 'indeterminado',
      mensaje: `No se pudo contactar al validador de RFC: ${err instanceof Error ? err.message : 'error de red'}`,
    };
  }

  const cuerpo = await respuesta.json().catch(() => ({} as Record<string, unknown>));

  // La funcion responde 200 con {valid} para el veredicto del SAT. Cualquier
  // otro status (400 datos incompletos, 401 sin permiso, 500 PAC no
  // configurado) es "no se pudo validar", no "es valido".
  if (!respuesta.ok) {
    const detalle = typeof cuerpo.error === 'string' ? cuerpo.error : `HTTP ${respuesta.status}`;
    return {
      ok: false,
      motivo: 'indeterminado',
      mensaje: `No se pudo validar el RFC contra el SAT (${detalle}).`,
    };
  }

  if (cuerpo.valid === true) return { ok: true };

  const errores = cuerpo.errors as { message?: string }[] | undefined;
  const mensaje =
    (typeof cuerpo.message === 'string' && cuerpo.message) ||
    (Array.isArray(errores) ? errores.map(e => e?.message).filter(Boolean).join('; ') : '') ||
    'El RFC no es valido segun el SAT.';

  // valid ausente no es valid:false; es una respuesta que no entendemos.
  if (cuerpo.valid === false) return { ok: false, motivo: 'rechazado', mensaje };

  return {
    ok: false,
    motivo: 'indeterminado',
    mensaje: 'El validador de RFC respondio en un formato inesperado.',
  };
}
