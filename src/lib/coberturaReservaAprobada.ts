// Cobertura de una reserva APROBADA por la agencia cuando el viajero completa el pago (13-oct-2026).
//
// Los puntos y el ToursRed Cash se comprometen en la reserva al crearla (`points_used`,
// `toursred_cash_used`). Hasta el 13-oct-2026, si esos montos cubrian el 100%, `approve-booking`
// confirmaba la reserva y los descontaba por su cuenta cuando la AGENCIA aprobaba; ahora aprobar
// solo abre la ventana de pago y el viajero paga desde «Completar Pago», pasando por
// confirm-booking-wallet-payment (que exige su codigo MFA cuando se gasta saldo).
//
// Ese camino mandaba `p_points_to_use: 0` aunque los puntos ya cubrieran todo, y el RPC
// confirm_booking_paid_with_wallet lo rechaza: exige que lo aportado (parametros + lo ya pagado)
// cubra `amount_due_now + points_used/100 + toursred_cash_used`. Aqui se calcula lo que SI hay que
// mandar: los puntos comprometidos y el Cash (el que el viajero elija en el modal o, si no eligio
// ninguno, el comprometido al crear la reserva).

export interface ReservaAprobada {
  user_payment?: number | string | null;
  deposit_amount?: number | string | null;
  points_used?: number | string | null;
  toursred_cash_used?: number | string | null;
}

export interface CoberturaReservaAprobada {
  /** Puntos que se descuentan (centavos de punto, como `points_used`). */
  puntosAportados: number;
  /** ToursRed Cash que se descuenta, en pesos. */
  efectivoAportado: number;
  /** Lo que queda por cobrar con tarjeta u otro procesador. 0 = pago completo con saldo/puntos. */
  montoACobrar: number;
}

const aNumero = (valor: number | string | null | undefined): number => Number(valor) || 0;
const aCentavos = (valor: number): number => Math.round(valor * 100) / 100;

export function coberturaReservaAprobada(
  reserva: ReservaAprobada,
  efectivoElegido: number,
): CoberturaReservaAprobada {
  const original = aNumero(reserva.user_payment) || aNumero(reserva.deposit_amount);
  const puntosAportados = aNumero(reserva.points_used);
  const efectivoAportado = efectivoElegido > 0 ? efectivoElegido : aNumero(reserva.toursred_cash_used);
  return {
    puntosAportados,
    efectivoAportado,
    montoACobrar: Math.max(0, aCentavos(original - puntosAportados / 100 - efectivoAportado)),
  };
}
