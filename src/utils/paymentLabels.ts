/**
 * Etiquetas de medios de pago para las pantallas de reservas.
 *
 * Existía un mapa distinto en cada pantalla (BookingSuccessPage, TravelerBookings,
 * AdminBookings), cada uno con su propio vocabulario y su propio fallback, y por
 * eso la misma reserva se veía distinta en cada una: "Tarjeta", "N/A" o "—".
 *
 * Hay DOS conceptos y las pantallas los mezclaban:
 *
 *   PROCESADOR — quién cobró. Vive en `bookings.payment_provider` (poblado en el
 *   100% de las reservas) y en `payment_transactions.payment_processor`.
 *
 *   INSTRUMENTO — con qué se pagó. Vive en
 *   `payment_transactions.payment_method_type`, y llega en dos idiomas según qué
 *   webhook lo escribió: 'card' y 'Tarjeta', 'spei' y 'Transferencia Bancaria'.
 *
 * `bookings.payment_method` es el campo problemático: guarda una mezcla de los
 * tres mundos —instrumento ('Tarjeta'), procesador ('paypal', 'mercadopago',
 * 'openpay') y monedero ('toursred_cash')— y está NULL en la mitad de las
 * reservas. Por eso nunca debe leerse solo: `payment_provider` es el respaldo.
 *
 * NOTA DE ALCANCE: esto es para reservas. `AgencyFinancials.tsx` tiene su propio
 * mapa a propósito — opera sobre `agency_payouts.payment_method`, que es otro
 * dominio (bank_transfer / check / paypal / mercadopago / other) y está alineado
 * con el CHECK de esa tabla. No lo unifiques con este.
 */

export const PROCESSOR_LABELS: Record<string, string> = {
  stripe: 'Stripe',
  openpay: 'Openpay',
  conekta: 'Conekta',
  mercadopago: 'Mercado Pago',
  paypal: 'PayPal',
};

export const METHOD_LABELS: Record<string, string> = {
  card: 'Tarjeta de crédito/débito',
  Tarjeta: 'Tarjeta de crédito/débito',
  spei: 'Transferencia bancaria (SPEI)',
  'Transferencia Bancaria': 'Transferencia bancaria',
  bank_transfer: 'Transferencia bancaria',
  customer_balance: 'Transferencia bancaria',
  oxxo: 'OXXO',
  oxxo_cash: 'OXXO',
  cash: 'Efectivo',
  bnpl: 'Pago a plazos',
  split: 'Pago mixto',
  toursred_cash: 'ToursRed Cash',
  toursred_points: 'Puntos ToursRed',
  toursred_points_cash: 'Puntos ToursRed + ToursRed Cash',
};

/** Nombre presentable del procesador. Cadena vacía si no hay dato. */
export const processorLabel = (processor?: string | null): string => {
  if (!processor) return '';
  return PROCESSOR_LABELS[processor] ?? processor.charAt(0).toUpperCase() + processor.slice(1);
};

/** Nombre presentable del instrumento. Cadena vacía si no hay dato. */
export const methodLabel = (method?: string | null): string => {
  if (!method) return '';
  return METHOD_LABELS[method] ?? method;
};

const isProcessorKey = (value?: string | null): boolean =>
  !!value && Object.prototype.hasOwnProperty.call(PROCESSOR_LABELS, value);

export interface PaymentLabelSource {
  /** payment_transactions.payment_method_type */
  methodType?: string | null;
  /** payment_transactions.payment_processor */
  processor?: string | null;
  /** bookings.payment_method — mezcla instrumento/procesador/monedero, suele ser NULL */
  paymentMethod?: string | null;
  /** bookings.payment_provider — el respaldo confiable */
  paymentProvider?: string | null;
  /** Qué mostrar cuando no hay absolutamente ningún dato */
  fallback?: string;
}

/**
 * Arma "instrumento · procesador" con lo que haya disponible.
 *
 * Si `paymentMethod` trae en realidad un procesador ('paypal', 'openpay'), se usa
 * como procesador y no como instrumento; sin eso una reserva de PayPal se leería
 * "paypal · PayPal".
 */
export function paymentLabel({
  methodType,
  processor,
  paymentMethod,
  paymentProvider,
  fallback = '—',
}: PaymentLabelSource): string {
  const rawInstrument = methodType ?? (isProcessorKey(paymentMethod) ? null : paymentMethod);
  const rawProcessor =
    processor ?? paymentProvider ?? (isProcessorKey(paymentMethod) ? paymentMethod : null);

  const parts = [methodLabel(rawInstrument), processorLabel(rawProcessor)].filter(Boolean);
  return parts.join(' · ') || fallback;
}
