/**
 * Asentar el anticipo de una reserva cobrado por Stripe, con el estado que
 * Stripe realmente reporta y sin duplicar la fila cuando el pago se confirma
 * despues.
 *
 * ============================================================================
 * EL COBRO FANTASMA, MEDIDO EN PRODUCCION
 * ============================================================================
 *
 * En `stripe-webhook` el `case` de checkout atiende DOS eventos:
 *
 *     checkout.session.completed
 *     checkout.session.async_payment_succeeded
 *
 * Para tarjeta el primero llega con `payment_status: 'paid'` y ahi se acaba.
 * Para los metodos asincronos de Mexico —SPEI (`customer_balance`) y OXXO— el
 * primero llega con `payment_status: 'unpaid'`: Stripe solo genero la CLABE o
 * el voucher y esta esperando el dinero. El segundo evento llega dias despues,
 * si el cliente paga.
 *
 * El insert de `payment_transactions` estaba FUERA del if/else que distingue
 * esos dos casos, y con `status: 'succeeded'` escrito a mano. O sea: generar la
 * CLABE bastaba para registrar un ingreso cobrado.
 *
 * Medido el 11-sep-2026 contra la API de Stripe, cuenta acct_1Roc3vEs5wtTyCYm:
 *
 *     pi_3TyfTt...  $601.50    29-jul-2026   requires_action, amount_received 0
 *     pi_3U2cet...  $3,125.69  09-ago-2026   requires_action, amount_received 0
 *
 * $3,727.19 de dinero que nunca llego. Las dos reservas si estaban bien
 * (`status: 'pending'`, `paid_at` nulo) y `stripe_orders` tambien distinguia
 * `unpaid`: el unico sitio que mentia era `payment_transactions`, que es el que
 * alimenta `vista_movimientos_financieros`.
 *
 * Comprobado en la vista el 11-sep-2026, las dos filas aparecen asi:
 *
 *     caja   +3,727.19      pasivo  +3,727.19      ingreso  0
 *
 * No infla la utilidad —un anticipo de reserva todavia no es ingreso, es
 * dinero que se le debe al proveedor— sino el SALDO DE EFECTIVO: el reporte
 * afirma que hay $3,727.19 en caja que no estan, contra un pasivo que nadie
 * fondeo.
 *
 * Y por eso el invariante `activo = pasivo + ingreso` jamas iba a saltar:
 * 3727.19 = 3727.19 + 0 cuadra perfecto. La fila esta mal y suma bien. Mismo
 * patron que el tipo de cambio de relleno en los gastos recurrentes, y se
 * encontro igual: cruzando contra la fuente externa en vez de confiar en la
 * suma.
 *
 * ============================================================================
 * EL DUPLICADO, QUE ERA LATENTE
 * ============================================================================
 *
 * Como los dos eventos comparten `case` y el insert no comprobaba si la fila
 * ya existia, un SPEI que SI se pagara habria dejado dos filas del mismo
 * cobro. Y peor: el UPDATE que rellena la comision filtra por
 * `stripe_payment_intent_id`, sin `.limit`, asi que le habria pegado a las dos
 * y habria duplicado tambien la comision.
 *
 * Cero duplicados en produccion el 11-sep-2026, unicamente porque ninguno de
 * los dos SPEI llego a pagarse. Dano latente, no dano hecho. Pasar por aqui lo
 * vuelve imposible.
 *
 * ============================================================================
 * POR QUE EL ESTADO NO SE RECIBE COMO PARTE DE LA FILA
 * ============================================================================
 *
 * `asentarCobroStripe` IGNORA cualquier `status` que venga en `fila` y lo
 * deriva del `payment_status` de la sesion. Si se aceptara en la fila, el
 * proximo que copie y pegue el bloque volveria a escribir 'succeeded' a mano y
 * estariamos igual. Aqui no se puede.
 *
 * ============================================================================
 * POR QUE EL CLIENTE ENTRA COMO PARAMETRO
 * ============================================================================
 *
 * Las Edge Functions no usan la misma version de supabase-js. Importarla aqui
 * meteria una segunda copia en el bundle de las que usan otra — el mismo
 * problema que se descarto al construir `contextoAuditoria.ts`, `disputas.ts`
 * y `cobrosPaypal.ts`, y que ya dio un error de tipos real en `stripe-webhook`.
 */

/** Tipo estructural minimo: lo unico que este modulo usa del cliente. */
export interface ClienteMinimo {
  // deno-lint-ignore no-explicit-any
  from(tabla: string): any;
}

export type EstadoDeCobro = 'succeeded' | 'pending';

export type AccionSobreCobroStripe =
  | 'insertado'
  | 'confirmado'
  | 'sin_cambio';

export interface ResultadoAsientoStripe {
  error: { message: string } | null;
  accion: AccionSobreCobroStripe;
  estado: EstadoDeCobro;
}

/**
 * Traduce el `payment_status` de una Checkout Session al estado con el que se
 * guarda la fila.
 *
 * - `paid`                 el dinero entro.
 * - `no_payment_required`  no habia nada que cobrar (sesion cubierta al 100%
 *                          con descuento o saldo). Queda liquidada.
 * - `unpaid`               SPEI u OXXO esperando la transferencia. NO es un
 *                          cobro.
 *
 * Cualquier otro valor —incluido uno que Stripe agregue mañana— cae en
 * 'pending' a proposito. Quedarse corto se ve en la conciliacion y lo caza el
 * detector diario; pasarse inventa caja y pasivo, y eso no se nota hasta que
 * alguien cruza contra Stripe a mano.
 */
export function estadoSegunStripe(
  paymentStatus: string | null | undefined,
): EstadoDeCobro {
  return paymentStatus === 'paid' || paymentStatus === 'no_payment_required'
    ? 'succeeded'
    : 'pending';
}

/**
 * @param fila           La fila de `payment_transactions` tal cual se
 *                       insertaria. Su `status` se ignora: manda
 *                       `paymentStatus`.
 * @param paymentStatus  `session.payment_status` de la Checkout Session.
 */
export async function asentarCobroStripe(
  supabase: ClienteMinimo,
  fila: Record<string, unknown>,
  paymentStatus: string | null | undefined,
): Promise<ResultadoAsientoStripe> {
  const estado = estadoSegunStripe(paymentStatus);
  const intentId = fila.stripe_payment_intent_id as string | null | undefined;

  // Sin PaymentIntent no hay con que identificar la fila. Se inserta: perder el
  // cobro seria peor que arriesgar un duplicado que hoy no se puede detectar.
  // Pasa en modo suscripcion cuando la invoice no trae pago.
  if (!intentId) {
    const { error } = await supabase
      .from('payment_transactions')
      .insert({ ...fila, status: estado });
    return { error: error ?? null, accion: 'insertado', estado };
  }

  // `.limit(1)` y no `.maybeSingle()`: maybeSingle revienta con 2+ filas, y
  // este modulo existe justamente para el caso en que ya haya duplicados
  // historicos. Que un cobro viejo mal registrado tire el webhook de uno nuevo
  // seria cambiar un problema de reporte por una perdida de datos.
  const { data: existentes } = await supabase
    .from('payment_transactions')
    .select('id, status')
    .eq('stripe_payment_intent_id', intentId)
    .limit(1);

  const existente = existentes?.[0];

  if (!existente) {
    const { error } = await supabase
      .from('payment_transactions')
      .insert({ ...fila, status: estado });
    return { error: error ?? null, accion: 'insertado', estado };
  }

  // La fila ya estaba. Solo se toca para confirmarla: el camino unpaid -> paid
  // de SPEI y OXXO. Nunca al reves — un reenvio del webhook de la fase unpaid
  // no debe devolver a 'pending' un cobro ya liquidado.
  if (estado === 'succeeded' && existente.status !== 'succeeded') {
    // `processor_fee` no se toca a proposito: lo rellena el paso siguiente con
    // la comision real de Stripe, y pisarlo con el cero de `fila` seria el
    // mismo error que cerro el #211 en MercadoPago. `net_amount` si se
    // reescribe porque ese mismo paso lo recalcula justo despues.
    const { error } = await supabase
      .from('payment_transactions')
      .update({
        status: 'succeeded',
        amount: fila.amount,
        net_amount: fila.net_amount,
        payment_method_type: fila.payment_method_type,
        metadata: fila.metadata,
      })
      .eq('id', existente.id);
    return { error: error ?? null, accion: 'confirmado', estado };
  }

  return { error: null, accion: 'sin_cambio', estado };
}
