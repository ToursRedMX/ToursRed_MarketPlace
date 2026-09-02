/**
 * Desglose fiscal de IVA — FUENTE CANONICA.
 *
 * Un solo lugar donde vive la formula de IVA para lo que se vende al viajero:
 * tours, suplementos y servicios opcionales. Cada entidad es fiscalmente
 * INDEPENDIENTE (Art. 15 fr. XIII LIVA: un tour gravado puede llevar un
 * opcional exento y ninguno hereda del otro).
 *
 * ── PARIDAD CON DENO ────────────────────────────────────────────────────────
 * Las Edge Functions corren en Deno y no pueden importar de src/ (contextos de
 * build distintos; tsconfig.app.json solo incluye src/). Por eso existe una
 * copia en supabase/functions/_shared/taxBreakdown.ts.
 *
 * Esa copia NO se mantiene por disciplina: scripts/test-tax-breakdown.mjs
 * compara el bloque canonico de ambos archivos y FALLA si divergen. Si tocas
 * la formula aqui, tocala alla igual o el test se cae.
 *
 * ── LO QUE ESTA FUNCION NO HACE ─────────────────────────────────────────────
 * NO calcula el IVA de la comision de ToursRed. Esa es una operacion propia y
 * distinta de lo que se vende: SIEMPRE 16%, tambien sobre tours exentos o
 * mixtos. Nunca le pases exemptRatio del tour a un calculo de comision.
 */

// ═══════════════ INICIO BLOQUE CANONICO (paridad con _shared) ═══════════════

export type TaxTreatment = 'taxable_16' | 'exempt' | 'mixed';

/** Tasa legal de IVA vigente. Se guarda por fila en el snapshot para que un
 *  cambio futuro no reinterprete cobros viejos. */
export const VAT_RATE = 0.16;

/** Decimales de exempt_ratio. Debe coincidir con numeric(9,8) en la BD. */
export const EXEMPT_RATIO_DECIMALS = 8;

export interface TaxBreakdownInput {
  /** Monto bruto cobrado, con IVA ya incluido en la parte gravada. */
  grossAmount: number;
  taxTreatment: TaxTreatment;
  exemptRatio: number;
  /**
   * Decimales del resultado.
   *  - 2 (default): importes de UI, contabilidad y snapshot.
   *  - 6: valor_unitario de FacturAPI, que es la precision que hoy usan las
   *    Edge Functions via `r6 = Math.round(n * 1e6) / 1e6`.
   */
  decimals?: 2 | 6;
}

export interface TaxBreakdown {
  exemptAmount: number;
  taxableBase: number;
  vatAmount: number;
  /** exempt + base + iva. Cuadra EXACTO con grossAmount por construccion. */
  total: number;
  taxTreatment: TaxTreatment;
  exemptRatio: number;
  taxRate: number;
}

const roundTo = (n: number, decimals: number): number => {
  const f = Math.pow(10, decimals);
  return Math.round((n + Number.EPSILON) * f) / f;
};

/**
 * Descompone un monto bruto en parte exenta, base gravable e IVA.
 *
 * El cuadre exacto no se deja al azar del redondeo: se redondean exento y
 * base, y el IVA se obtiene por DIFERENCIA contra el bruto. Redondear los tres
 * por separado deja descuadres de un centavo que el SAT rechaza, y que en un
 * CFDI con varios conceptos se acumulan.
 */
export function calculateTaxBreakdown({
  grossAmount,
  taxTreatment,
  exemptRatio,
  decimals = 2,
}: TaxBreakdownInput): TaxBreakdown {
  const ratio = normalizeExemptRatio(taxTreatment, exemptRatio);
  const gross = roundTo(grossAmount, decimals);

  const exemptAmount = roundTo(gross * ratio, decimals);
  const taxableGross = roundTo(gross - exemptAmount, decimals);
  const taxableBase = roundTo(taxableGross / (1 + VAT_RATE), decimals);
  // Por diferencia, no por multiplicacion: garantiza base + iva == taxableGross.
  const vatAmount = roundTo(taxableGross - taxableBase, decimals);

  return {
    exemptAmount,
    taxableBase,
    vatAmount,
    total: roundTo(exemptAmount + taxableBase + vatAmount, decimals),
    taxTreatment,
    exemptRatio: ratio,
    taxRate: ratio === 1 ? 0 : VAT_RATE,
  };
}

/**
 * El tratamiento manda sobre el ratio. Si llega una combinacion imposible
 * —'exempt' con ratio 0.3, por ejemplo— se usa el ratio que el tratamiento
 * implica en vez de calcular con un valor que la BD habria rechazado.
 * El CHECK de la migracion impide que eso llegue a persistirse; esto cubre
 * datos en transito.
 */
export function normalizeExemptRatio(taxTreatment: TaxTreatment, exemptRatio: number): number {
  if (taxTreatment === 'taxable_16') return 0;
  if (taxTreatment === 'exempt') return 1;
  const r = Number(exemptRatio);
  if (!Number.isFinite(r) || r <= 0 || r >= 1) {
    throw new Error(`exempt_ratio invalido para tratamiento 'mixed': ${exemptRatio}`);
  }
  return r;
}

/**
 * Deriva el ratio a partir de los pesos que captura la agencia.
 * Tolerancia $0.01 como pide el requerimiento: por debajo de eso es error de
 * redondeo del usuario, por encima es una captura que no cuadra y se rechaza.
 */
export function deriveExemptRatio(
  exemptAmount: number,
  taxableGrossAmount: number,
  referencePrice: number,
): number {
  if (!(referencePrice > 0)) {
    throw new Error('El precio de referencia debe ser mayor a cero');
  }
  const sum = exemptAmount + taxableGrossAmount;
  if (Math.abs(sum - referencePrice) > 0.01) {
    throw new Error(
      `La suma capturada (${sum.toFixed(2)}) no coincide con el precio de referencia (${referencePrice.toFixed(2)})`,
    );
  }
  const ratio = exemptAmount / referencePrice;
  // 8 decimales para cuadrar con exempt_ratio numeric(9,8) en la BD. Con 4
  // decimales, 999/1499 se guarda como 0.6664 y el anticipo del 40% cae en
  // 399.57 en vez de 399.60.
  return Math.min(1, Math.max(0, roundTo(ratio, EXEMPT_RATIO_DECIMALS)));
}

/** Tratamiento que corresponde a un ratio dado. Mantiene enum y ratio en sync. */
export function treatmentForRatio(exemptRatio: number): TaxTreatment {
  if (exemptRatio <= 0) return 'taxable_16';
  if (exemptRatio >= 1) return 'exempt';
  return 'mixed';
}

// ════════════════ FIN BLOQUE CANONICO (paridad con _shared) ═════════════════
