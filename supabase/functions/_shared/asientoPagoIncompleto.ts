// Asiento de la cancelacion automatica por pago incompleto (cron `process-incremental-payment-deadlines`).
//
// POR QUE EXISTE (29-oct-2026, pre-UAT, casos FIS-06 y CAN-07): a los 7 dias de un pago por debajo del anticipo, el cron cancela la
// reserva y reembolsa al monedero lo pagado menos el 5% de cargo por servicio. Hacia el libro no dejaba NADA: ni el cobro (que por
// "cobertura insuficiente" nunca se asienta como reserva) ni el reembolso. Medido: TRG-YQ18292VCFC (15-ago, Conekta, 2,850) y
// TRG-PSXABPMBNA2 (27-oct, OpenPay, 200): 3,050.00 en el monedero que el libro (218-11) no tenia.
//
// QUE ASIENTA, en UN solo asiento (el cobro y el reembolso, porque el cobro nunca se asento):
//     Dr 102    Bancos                                  lo cobrado por la pasarela
//       Cr 218-11  Monedero ToursRed Cash               lo reembolsado
//       Cr 402     Cargo por servicio retenido          lo no reembolsado (5% si no estaba exento)
// El cargo por servicio retenido va a 402 igual que el "ajuste servicios no reembolsables" de create_accounting_entry_for_cancellation.
// La comision del procesador la asienta aparte el cron `comisiones-al-libro`, como en cualquier otro cobro.
//
// SOLO SE ASIENTA CUANDO EL DINERO ES TODO DE PASARELA. Si lo pagado no coincide con lo cobrado por pasarela (una parte con ToursRed
// Cash o puntos), de donde salio el resto no se puede deducir de aqui y asentarlo a ojo seria un numero que cuadra y es falso
// (patron 1 de CLAUDE.md): se devuelve `ok: false` y quien llama deja una fila en audit_errors para revision humana.

export interface LineaAsiento {
  account_code: string;
  description: string;
  debit: number;
  credit: number;
}

export type ResultadoAsiento =
  | { ok: true; lineas: LineaAsiento[]; retenido: number }
  | { ok: false; motivo: "sin_pago" | "reembolso_mayor_al_pago" | "fondos_mixtos" };

const redondea = (n: number): number => Math.round(n * 100) / 100;

/**
 * @param pagado       lo que el viajero pago (`bookings.user_payment`)
 * @param porPasarela  suma de `payment_transactions` exitosas de la reserva
 * @param reembolsado  lo que se acredita al monedero
 */
export function lineasDeCancelacionPorPagoIncompleto(
  pagado: number,
  porPasarela: number,
  reembolsado: number,
): ResultadoAsiento {
  const pago = redondea(pagado);
  const pasarela = redondea(porPasarela);
  const reembolso = redondea(reembolsado);

  if (!(pago > 0)) return { ok: false, motivo: "sin_pago" };
  if (reembolso > pago) return { ok: false, motivo: "reembolso_mayor_al_pago" };
  if (Math.abs(pasarela - pago) > 0.01) return { ok: false, motivo: "fondos_mixtos" };

  const retenido = redondea(pago - reembolso);
  const lineas: LineaAsiento[] = [
    { account_code: "102", description: "Cobro por pasarela de una reserva cancelada por pago incompleto", debit: pago, credit: 0 },
  ];
  if (reembolso > 0) {
    lineas.push({ account_code: "218-11", description: "Reembolso a monedero ToursRed Cash por pago incompleto", debit: 0, credit: reembolso });
  }
  if (retenido > 0) {
    lineas.push({ account_code: "402", description: "Cargo por servicio retenido por pago incompleto", debit: 0, credit: retenido });
  }
  return { ok: true, lineas, retenido };
}
