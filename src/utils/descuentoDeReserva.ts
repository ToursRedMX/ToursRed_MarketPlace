/**
 * El monto de un codigo de descuento en una reserva.
 *
 * ============================================================================
 * POR QUE ES UN MODULO Y NO CODIGO DENTRO DEL PASO 4
 * ============================================================================
 *
 * Porque la RPC NO devuelve el monto: devuelve el CODIGO. Quien decide cuanto
 * se descuenta es el front, a partir de cuatro campos —`discount_type`,
 * `discount_value`, `discount_applies_to` y `max_discount_amount`— y de una
 * base que cambia segun donde aplique. Esa aritmetica no se puede probar si
 * vive dentro de un componente con veinte estados.
 *
 * Y ya se equivoco una vez: hasta el 12-sep-2026 `BookingFlowStep4` pedia a la
 * RPC un campo `discount_amount` **que no existe**, asi que el descuento era
 * siempre 0 — cuando la llamada llegaba, que no llegaba (ver abajo).
 *
 * ----------------------------------------------------------------------------
 * LOS TRES DESTINOS DE UN DESCUENTO, Y POR QUE NO SON INTERCAMBIABLES
 * ----------------------------------------------------------------------------
 *
 *   `applicable_to = 'service_fees'`  -> baja el CARGO POR SERVICIO de ToursRed.
 *        No toca el precio del tour, asi que la agencia cobra igual: lo paga
 *        la plataforma de su propio margen.
 *
 *   `discount_applies_to = 'total_price'`  -> baja el PRECIO DEL TOUR. El
 *        anticipo y la comision de la agencia se recalculan sobre el precio ya
 *        rebajado, porque el descuento es sobre el producto.
 *
 *   `discount_applies_to = 'payment_amount'` -> baja lo EXIGIBLE HOY sin tocar
 *        el precio. El viajero paga menos ahora y debe lo mismo al final.
 *
 * Confundirlos no da un error: da una cifra creible y equivocada. Un codigo de
 * `service_fees` aplicado al precio del tour le quita dinero a la agencia; uno
 * de `total_price` aplicado al pago inicial regala saldo que nadie descontara.
 *
 * ----------------------------------------------------------------------------
 * LOS TIPOS SE ENUMERAN, NO SE ADIVINAN POR SUBCADENA
 * ----------------------------------------------------------------------------
 *
 * `BookingForm` decidia con `discount_type.includes('percentage')`. Funciona
 * hoy y es fragil: el CHECK de la base admite DIECISIETE tipos, y cuatro de
 * ellos —los de membresia, tarjeta de regalo, seguro y slots— no tienen nada
 * que ver con una reserva de tour. Aqui se enumeran contra el CHECK real
 * (`discount_codes_discount_type_check`, leido el 12-sep-2026), y lo que no
 * este en la lista no descuenta nada en vez de descontar por accidente.
 */

/** Lo que devuelve `validate_tour_discount_code` cuando el codigo es valido. */
export interface CodigoDeDescuento {
  code_id: string;
  code: string;
  discount_type: string;
  discount_value: number;
  /** 'total_price' | 'payment_amount'. La RPC puede omitirlo. */
  discount_applies_to?: string | null;
  max_discount_amount?: number | null;
  /** 'tours' | 'service_fees' | ... */
  applicable_to?: string | null;
}

export type DondeAplica =
  | 'precio_total'        // baja el precio del tour
  | 'monto_a_pagar'       // baja lo exigible hoy
  | 'cargo_por_servicio'  // baja el cargo de ToursRed
  | 'ninguno';            // el codigo no sirve para una reserva de tour

/** Tipos que descuentan un PORCENTAJE sobre el precio del tour. */
const PORCENTAJE_DE_TOUR = new Set([
  'tour_percentage',
  'agency_tour_percentage',
]);

/** Tipos que descuentan un IMPORTE FIJO sobre el precio del tour. */
const FIJO_DE_TOUR = new Set([
  'tour_fixed',
  'agency_tour_fixed',
]);

const redondear = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * A que parte de la reserva le pega este codigo.
 *
 * `service_fees` manda sobre `discount_applies_to`: un codigo de cargo por
 * servicio nunca toca el precio del tour, diga lo que diga el otro campo.
 */
export function dondeAplica(codigo: CodigoDeDescuento | null | undefined): DondeAplica {
  if (!codigo) return 'ninguno';

  if (codigo.applicable_to === 'service_fees') return 'cargo_por_servicio';

  // Un codigo de membresia, tarjeta de regalo, seguro o slot destacado puede
  // existir y ser valido — pero no en una reserva de tour.
  if (codigo.applicable_to && codigo.applicable_to !== 'tours') return 'ninguno';

  if (!PORCENTAJE_DE_TOUR.has(codigo.discount_type) && !FIJO_DE_TOUR.has(codigo.discount_type)) {
    return 'ninguno';
  }

  return codigo.discount_applies_to === 'payment_amount' ? 'monto_a_pagar' : 'precio_total';
}

/**
 * Cuanto descuenta sobre `base`.
 *
 * **Nunca devuelve mas que `base`.** La base no pone techo a `discount_value`
 * —el CHECK solo exige que sea > 0— asi que un codigo del 150% produciria un
 * precio NEGATIVO. `BookingForm` no lo topaba; aqui si, porque un total en
 * negativo no es un descuento generoso, es una reserva que le debe dinero al
 * viajero.
 */
export function montoDeDescuento(
  codigo: CodigoDeDescuento | null | undefined,
  base: number,
): number {
  const destino = dondeAplica(codigo);
  if (!codigo || destino === 'ninguno' || destino === 'cargo_por_servicio') return 0;
  if (!(base > 0)) return 0;

  let monto = PORCENTAJE_DE_TOUR.has(codigo.discount_type)
    ? base * (Number(codigo.discount_value) / 100)
    : Number(codigo.discount_value);

  const tope = codigo.max_discount_amount;
  if (tope != null && monto > Number(tope)) monto = Number(tope);

  return redondear(Math.min(Math.max(monto, 0), base));
}

/**
 * Cuanto baja el CARGO POR SERVICIO.
 *
 * Los tres tipos son distintos entre si y no se pueden derivar uno del otro:
 * `service_fee_full` exonera el cargo completo sin mirar `discount_value`.
 */
export function descuentoDeCargoPorServicio(
  codigo: CodigoDeDescuento | null | undefined,
  cargoCompleto: number,
): number {
  if (!codigo || dondeAplica(codigo) !== 'cargo_por_servicio') return 0;
  if (!(cargoCompleto > 0)) return 0;

  let monto: number;
  switch (codigo.discount_type) {
    case 'service_fee_full':
      monto = cargoCompleto;
      break;
    case 'service_fee_percentage':
      monto = cargoCompleto * (Number(codigo.discount_value) / 100);
      break;
    case 'service_fee_fixed':
      monto = Number(codigo.discount_value);
      break;
    default:
      // `applicable_to` dice 'service_fees' pero el tipo no es de cargo. Dato
      // incoherente: no se inventa un descuento.
      return 0;
  }

  const tope = codigo.max_discount_amount;
  if (tope != null && monto > Number(tope)) monto = Number(tope);

  return redondear(Math.min(Math.max(monto, 0), cargoCompleto));
}

/**
 * Cuanto baja el COSTO DEL SEGURO de viaje.
 *
 * Vive aparte del descuento del tour porque son codigos distintos, validados
 * por una RPC distinta (`validate_insurance_discount_code`) y guardados en
 * columnas distintas de la reserva. Un codigo de seguro aplicado al tour, o al
 * reves, produce una cifra creible y equivocada.
 *
 * `insurance_free` exonera el seguro entero e IGNORA `discount_value`, igual
 * que `service_fee_full` con el cargo por servicio.
 */
export function descuentoDeSeguro(
  codigo: CodigoDeDescuento | null | undefined,
  costoDelSeguro: number,
): number {
  if (!codigo) return 0;
  if (!(costoDelSeguro > 0)) return 0;

  let monto: number;
  switch (codigo.discount_type) {
    case 'insurance_free':
      monto = costoDelSeguro;
      break;
    case 'insurance_percentage':
      monto = costoDelSeguro * (Number(codigo.discount_value) / 100);
      break;
    case 'insurance_fixed':
      monto = Number(codigo.discount_value);
      break;
    default:
      // No es un codigo de seguro. No se inventa un descuento.
      return 0;
  }

  const tope = codigo.max_discount_amount;
  if (tope != null && monto > Number(tope)) monto = Number(tope);

  return redondear(Math.min(Math.max(monto, 0), costoDelSeguro));
}
