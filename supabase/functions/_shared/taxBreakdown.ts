/**
 * Desglose fiscal de IVA — COPIA DENO. NO EDITAR A MANO.
 *
 * La fuente canonica es src/utils/taxBreakdown.ts. Las Edge Functions corren
 * en Deno y no pueden importar de src/ (contextos de build distintos), asi que
 * el bloque canonico se copia aqui tal cual.
 *
 * La paridad NO depende de que alguien se acuerde: scripts/test-tax-breakdown.mjs
 * compara ambos bloques byte a byte y FALLA si divergen. Si cambias la formula,
 * cambiala en la canonica y vuelve a copiar el bloque.
 *
 * NO calcula el IVA de la comision de ToursRed: esa es una operacion propia y
 * distinta, SIEMPRE 16%, tambien sobre tours exentos o mixtos.
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

// ═══════════════ GUARDIA DE CUADRE (solo Deno, no va en la canonica) ════════

/** Forma minima de un concepto para poder verificarlo. */
export interface VerifiableConcepto {
  cantidad: number;
  valor_unitario: number;
  descuento?: number;
  exento?: boolean;
}

/**
 * Verifica que los conceptos reconstruyan EXACTAMENTE el importe cobrado antes
 * de mandar nada al PAC.
 *
 * Existe porque ninguna de las funciones de CFDI validaba esto, y por eso el
 * bug de `cantidad` en suplementos y opcionales —el CFDI amparaba el doble de
 * lo cobrado con quantity=2— sobrevivio sin que nada lo detectara. Un CFDI mal
 * timbrado no se corrige: se cancela y se vuelve a emitir, con el viajero ya
 * teniendo el comprobante equivocado.
 *
 * Reconstruye lo que hara el PAC:
 *   gravado: (valor_unitario * cantidad - descuento) * 1.16
 *   exento:   valor_unitario * cantidad - descuento
 *
 * Tolerancia de un centavo: los valores unitarios van a 6 decimales y el
 * redondeo del PAC a 2 puede mover el ultimo centavo legitimamente.
 */
export function verifyConceptosTotal(
  conceptos: VerifiableConcepto[],
  expectedTotal: number,
  tolerance = 0.01,
): { ok: boolean; computed: number; expected: number; diff: number } {
  let computed = 0;
  for (const c of conceptos) {
    const neto = c.valor_unitario * c.cantidad - (c.descuento ?? 0);
    computed += c.exento ? neto : neto * (1 + VAT_RATE);
  }
  computed = Math.round(computed * 100) / 100;
  const expected = Math.round(expectedTotal * 100) / 100;
  const diff = Math.round((computed - expected) * 100) / 100;
  return { ok: Math.abs(diff) <= tolerance, computed, expected, diff };
}
