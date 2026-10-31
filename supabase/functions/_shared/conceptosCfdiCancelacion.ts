// Conceptos del CFDI nuevo que se emite cuando se cancela el original con motivo 03 (la operacion no se llevo a cabo).
//
// REGLA DEL CONTADOR (30-oct-2026, FIS-05):
//   - El cargo por servicio retenido (5%) es ingreso 100% de ToursRed: se factura directo, SIN pago por terceros.
//   - Si la cancelacion tiene penalizacion, se DIVIDE: la parte de la plataforma se factura directo (sin terceros) y la parte de la
//     agencia lleva la informacion del tercero, porque es ingreso de la agencia y no de la plataforma.
//   - Si la cancelacion cae en otro mes que la factura, se procesa igual.
//
// Los importes entran BRUTOS (con el IVA incluido en la parte gravada), igual que se guardan en booking_cancellations. En un concepto
// gravado `valor_unitario` es el NETO (bruto / 1.16, porque FacturAPI recibe tax_included = false); en uno exento es el importe completo.
// Dividir un exento entre 1.16 desaparece dinero del CFDI (ver taxBreakdown.ts).
//
// SUPUESTO QUE HAY QUE CONFIRMAR CON EL CONTADOR: la parte de la agencia de la penalizacion hereda el tratamiento de IVA de la reserva
// (tax_treatment / exempt_ratio, el snapshot), porque es ingreso de la agencia por el mismo tour. La parte de la plataforma y el cargo
// por servicio van siempre al 16%, como la comision de ToursRed en cualquier otro CFDI.

import { calculateTaxBreakdown, type TaxTreatment } from "./taxBreakdown.ts";

export interface TerceroCfdi {
  rfc: string;
  nombre: string;
  regimen_fiscal: string;
  domicilio_fiscal: string;
}

export interface ConceptoCfdiCancelacion {
  clave_prod_serv: string;
  cantidad: number;
  clave_unidad: string;
  descripcion: string;
  valor_unitario: number;
  exento?: boolean;
  tercero?: TerceroCfdi | null;
}

export interface EntradaConceptosCancelacion {
  /** Cargo por servicio retenido, bruto. */
  cargoRetenido: number;
  /** Parte de la plataforma de la penalizacion, bruta. */
  penalizacionPlataforma: number;
  /** Parte de la agencia de la penalizacion, bruta. */
  penalizacionAgencia: number;
  /** Datos de la agencia cuando su RFC es distinto del receptor; null si no hace falta tercero. */
  tercero: TerceroCfdi | null;
  taxTreatment: TaxTreatment;
  exemptRatio: number;
  /** "Reserva TRG-... (cancelada) - Nombre del tour" */
  referencia: string;
}

export interface ResultadoConceptosCancelacion {
  conceptos: ConceptoCfdiCancelacion[];
  subtotal: number;
  iva: number;
  total: number;
}

const redondea = (n: number, decimales = 2): number => {
  const f = Math.pow(10, decimales);
  return Math.round((n + Number.EPSILON) * f) / f;
};
const r6 = (n: number): number => redondea(n, 6);
const positivo = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

export function conceptosDeCancelacion(e: EntradaConceptosCancelacion): ResultadoConceptosCancelacion {
  const cargo = positivo(e.cargoRetenido);
  const plataforma = positivo(e.penalizacionPlataforma);
  const agencia = positivo(e.penalizacionAgencia);
  const conceptos: ConceptoCfdiCancelacion[] = [];

  if (cargo > 0) {
    conceptos.push({
      clave_prod_serv: "81141600",
      cantidad: 1,
      clave_unidad: "E48",
      descripcion: `Cargo por servicio de plataforma - ${e.referencia}`,
      valor_unitario: r6(cargo / 1.16),
      tercero: null,
    });
  }

  if (plataforma > 0) {
    conceptos.push({
      clave_prod_serv: "81141600",
      cantidad: 1,
      clave_unidad: "E48",
      descripcion: `Penalizacion por cancelacion, parte de la plataforma - ${e.referencia}`,
      valor_unitario: r6(plataforma / 1.16),
      tercero: null,
    });
  }

  if (agencia > 0) {
    const desglose = calculateTaxBreakdown({
      grossAmount: agencia,
      taxTreatment: e.taxTreatment,
      exemptRatio: e.exemptRatio,
      decimals: 6,
    });
    const descripcion = `Penalizacion por cancelacion, parte de la agencia - ${e.referencia}`;
    if (desglose.taxableBase > 0) {
      conceptos.push({
        clave_prod_serv: "90121500",
        cantidad: 1,
        clave_unidad: "E48",
        descripcion,
        valor_unitario: desglose.taxableBase,
        tercero: e.tercero,
      });
    }
    if (desglose.exemptAmount > 0) {
      conceptos.push({
        clave_prod_serv: "90121500",
        cantidad: 1,
        clave_unidad: "E48",
        descripcion,
        valor_unitario: desglose.exemptAmount,
        exento: true,
        tercero: e.tercero,
      });
    }
  }

  const gravadoNeto = conceptos.filter((c) => !c.exento).reduce((s, c) => s + c.valor_unitario * c.cantidad, 0);
  const exento = conceptos.filter((c) => c.exento).reduce((s, c) => s + c.valor_unitario * c.cantidad, 0);
  const total = redondea(gravadoNeto * 1.16 + exento);
  const subtotal = redondea(gravadoNeto + exento);
  return { conceptos, subtotal, iva: redondea(total - subtotal), total };
}
