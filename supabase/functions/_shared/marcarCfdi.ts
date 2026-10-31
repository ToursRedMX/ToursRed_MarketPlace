// Marca un CFDI como cancelado (o pendiente de cancelar) y, si se puede, lo liga a la cancelacion que lo origino.
//
// El ESTADO es lo que importa: el SAT ya acepto la solicitud y el original no puede seguir figurando `stamped`. La liga es una llave foranea a
// `booking_cancellations`; si llega un id que no es de una cancelacion total (las parciales viven en otra tabla) el UPDATE completo se rechaza.
// Antes ese error no se revisaba: tras una cancelacion parcial el original quedaba `stamped` en la base con la solicitud aceptada en el SAT
// (31-oct-2026, folio 113 de TRG-JII15E7VX1A), y los reportes contaban dos CFDI vigentes por la misma venta.
//
// Ahora: si ligar falla se reintenta solo con el estado, y si tambien eso falla se avisa (`alFallar`, que en las funciones es registrarFallo)
// en vez de callarlo. `alFallar` se inyecta para poder probar esto sin red.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";

export type EstadoCancelacionCfdi = "cancelled" | "cancellation_pending";

export type AlFallar = (contexto: string, detalle: string, datos: Record<string, unknown>) => Promise<void>;

export async function marcarCfdi(
  supabase: Pick<SupabaseClient, "from">,
  cfdiId: string,
  estado: EstadoCancelacionCfdi,
  cancellationId: string | null | undefined,
  alFallar: AlFallar,
): Promise<{ ok: boolean; ligada: boolean }> {
  if (cancellationId) {
    const { error } = await supabase
      .from("cfdi_invoices")
      .update({ status: estado, cancellation_id: cancellationId })
      .eq("id", cfdiId);
    if (!error) return { ok: true, ligada: true };
    console.warn(
      `cancel-cfdi: no se pudo ligar el CFDI ${cfdiId} a la cancelacion ${cancellationId} (${error.message}); se marca solo el estado`,
    );
  }
  const { error } = await supabase.from("cfdi_invoices").update({ status: estado }).eq("id", cfdiId);
  if (error) {
    await alFallar("cancel-cfdi/estado", error.message, { cfdi_invoice_id: cfdiId, estado });
    return { ok: false, ligada: false };
  }
  return { ok: true, ligada: false };
}
