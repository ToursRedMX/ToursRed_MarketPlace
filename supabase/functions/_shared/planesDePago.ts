/**
 * Forma de cada elemento en `tours.installment_definitions` (jsonb).
 *
 * Se repetia como `(def: any)` en tres webhooks de pago (Stripe, PayPal,
 * MercadoPago) que arman el plan de pagos en parcialidades al confirmar el
 * primer cobro -- el mismo bloque copiado y pegado tres veces. Este tipo no
 * centraliza esa logica (es trabajo aparte), solo evita que cada copia
 * reinvente `any` para la misma columna.
 */
export interface DefinicionParcialidad {
  pct_of_total: number;
  label?: string;
  specific_date?: string;
  days_before_departure?: number;
  days_after_booking?: number;
}
