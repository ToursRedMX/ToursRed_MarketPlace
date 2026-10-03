// Carrito mixto: Stripe hace UN cobro por reserva + membresia (una factura de
// suscripcion con la membresia como linea de suscripcion y el desglose de la
// reserva como lineas sueltas), y stripe-webhook lo registra desde DOS eventos:
//
//   checkout.session.completed -> transaccion de la reserva
//   invoice.paid               -> transaccion de la membresia
//
// Hasta el 02-oct-2026 cada uno registraba el cobro COMPLETO: por $589 (deposito
// $500 + membresia $89) quedaban $589 de reserva y $589 de membresia, con los
// $500 del deposito —dinero de la agencia— como ingreso por membresia. Y si las
// dos hubieran leido la comision, la habrian contado dos veces.
//
// Los dos eventos llegan en cualquier orden, asi que cada uno calcula el
// reparto COMPLETO a partir de la misma factura y se queda con su parte: el
// resultado es el mismo sin importar quien llegue primero. Todo en centavos.
//
// La comision se reparte en proporcion al monto. La membresia redondea y la
// reserva se queda con el resto, para que las dos partes sumen exactamente lo
// que cobro Stripe.

export interface LineaDeFactura {
  amount?: number | null;
  parent?: { type?: string | null } | null;
}

// El objeto `invoice` que llega en el webhook (embebido en el evento, o de un
// `retrieve` sin pedir todas las paginas) trae como mucho 10 lineas en
// `lines.data`, con `has_more` avisando que faltan. Una reserva normal no
// pasa de ahi (deposito + seguro + cargo + membresia), pero una con varios
// opcionales si puede, y entonces `centavosDeSuscripcion` suma solo la
// primera pagina: si la linea de membresia cae en la segunda, el reparto
// queda incompleto SIN que nada lo note. Pendiente 11 de la entrada 33.
export async function lineasCompletasDeFactura(
  stripe: { invoices: { listLineItems: (id: string, params: { limit: number }) => { autoPagingToArray: (opts: { limit: number }) => Promise<unknown[]> } } },
  invoiceId: string,
  lineas: { data?: LineaDeFactura[] | null; has_more?: boolean | null } | null | undefined,
): Promise<LineaDeFactura[]> {
  const primeraPagina = lineas?.data ?? [];
  if (!lineas?.has_more) return primeraPagina;
  // Se repite desde cero con el paginador de Stripe en vez de completar a
  // partir de `primeraPagina`: mas simple y sin riesgo de contar una linea
  // dos veces si el cursor no calzara exacto con lo que ya trajo el evento.
  const todas = await stripe.invoices.listLineItems(invoiceId, { limit: 100 })
    .autoPagingToArray({ limit: 1000 });
  return todas as LineaDeFactura[];
}

export interface Comision {
  fee: number;
  net: number;
  base: number | null;
  iva: number | null;
}

// Centavos de la factura que son la suscripcion (la membresia). Las lineas
// sueltas (deposito, opcionales, seguro, cargo por servicio) son de la reserva.
export function centavosDeSuscripcion(lineas: LineaDeFactura[] | null | undefined): number {
  return (lineas ?? [])
    .filter((l) => l?.parent?.type === "subscription_item_details")
    .reduce((s, l) => s + (Number(l.amount) || 0), 0);
}

const aCentavos = (pesos: number) => Math.round(pesos * 100);
const aPesos = (centavos: number) => centavos / 100;

export function repartirComision(
  c: Comision,
  centavosMembresia: number,
  centavosTotal: number,
): { membresia: Comision; reserva: Comision } {
  const proporcion = centavosTotal > 0
    ? Math.min(1, Math.max(0, centavosMembresia / centavosTotal))
    : 0;
  const centavosReserva = centavosTotal - centavosMembresia;

  const feeTotal = aCentavos(c.fee);
  const feeMembresia = Math.round(feeTotal * proporcion);
  const feeReserva = feeTotal - feeMembresia;

  let baseMembresia: number | null = null, ivaMembresia: number | null = null;
  let baseReserva: number | null = null, ivaReserva: number | null = null;
  if (c.base !== null && c.iva !== null) {
    const baseTotal = aCentavos(c.base);
    baseMembresia = Math.round(baseTotal * proporcion);
    baseReserva = baseTotal - baseMembresia;
    // El IVA es lo que falta para la comision de cada parte: asi base + iva =
    // fee en las dos, al centavo, sin un segundo redondeo independiente.
    ivaMembresia = feeMembresia - baseMembresia;
    ivaReserva = feeReserva - baseReserva;
  }

  return {
    membresia: {
      fee: aPesos(feeMembresia),
      net: aPesos(centavosMembresia - feeMembresia),
      base: baseMembresia === null ? null : aPesos(baseMembresia),
      iva: ivaMembresia === null ? null : aPesos(ivaMembresia),
    },
    reserva: {
      fee: aPesos(feeReserva),
      net: aPesos(centavosReserva - feeReserva),
      base: baseReserva === null ? null : aPesos(baseReserva),
      iva: ivaReserva === null ? null : aPesos(ivaReserva),
    },
  };
}
