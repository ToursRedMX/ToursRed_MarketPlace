/**
 * Asentar un cobro de PayPal sin pisar lo que ya este, y rellenando la comision
 * si la fila ya existia con cero.
 *
 * ============================================================================
 * EL HUECO QUE CIERRA, MEDIDO EN PRODUCCION
 * ============================================================================
 *
 * Los caminos sincronos —`process-payment-plan-installment`,
 * `process-supplement-payment`, `purchase-post-booking-extras`— insertan la
 * fila de PayPal con `status: "succeeded"` y `processor_fee: 0`, porque en ese
 * momento no conocen la comision. En los otros procesadores el webhook la
 * rellena despues. En PayPal NO LO HACIA NADIE: `capture-paypal-order` solo
 * insertaba filas nuevas y, al encontrar una existente, se iba.
 *
 * Medido el 11-sep-2026 sobre produccion: 2 cobros de PayPal liquidados con
 * comision en cero, $6,162.44 entre los dos, ambos del 22-jul-2026.
 *
 *     booking_deposit           $3,999.65   ya no se reproduce (PR #188, 09-sep)
 *     payment_plan_installment  $2,162.79   ESTE camino seguia igual
 *
 * Es el mismo hueco que el PR #211 le cerro a MercadoPago, que insertaba «si no
 * existe» y se iba.
 *
 * Y habia un segundo riesgo: cuatro de los cinco sitios insertaban SIN
 * comprobar si la fila ya estaba, asi que segun el orden de las llamadas
 * podian dejar DOS filas del mismo cobro, una con cero y otra con la comision.
 * Una fila duplicada es peor que una comision en cero porque infla el cobro en
 * todos los reportes. Medido el mismo dia: cero duplicados en produccion, asi
 * que era riesgo latente y no dano hecho. Pasar por aqui lo vuelve imposible.
 *
 * ============================================================================
 * LA REGLA AL ACTUALIZAR, Y POR QUE
 * ============================================================================
 *
 * Solo se escribe la comision cuando la NUEVA es > 0 y la GUARDADA es 0 o nula.
 *
 * Pisar una comision buena con un cero seria peor que no tocar nada: PayPal no
 * siempre manda `seller_receivable_breakdown`, y entonces el parseo cae en
 * `"0"`, que es indistinguible de «este cobro no tuvo comision». Misma regla
 * que adopto el #211 para MercadoPago.
 *
 * ============================================================================
 * POR QUE EL CLIENTE ENTRA COMO PARAMETRO
 * ============================================================================
 *
 * Las Edge Functions no usan la misma version de supabase-js. Importarla aqui
 * meteria una segunda copia en el bundle de las que usan otra — el mismo
 * problema que se descarto al construir `contextoAuditoria.ts` y `disputas.ts`,
 * y que ya dio un error de tipos real en `stripe-webhook`.
 */

/** Tipo estructural minimo: lo unico que este modulo usa del cliente. */
export interface ClienteMinimo {
  // deno-lint-ignore no-explicit-any
  from(tabla: string): any;
}

export type AccionSobreCobro = 'insertado' | 'comision_rellenada' | 'sin_cambio';

export interface ResultadoAsiento {
  error: { message: string } | null;
  accion: AccionSobreCobro;
}

/**
 * @param fila  La fila completa de `payment_transactions`, tal cual se
 *              insertaria. Debe traer `paypal_capture_id` para poder
 *              identificar un cobro ya asentado.
 */
export async function asentarCobroPaypal(
  supabase: ClienteMinimo,
  fila: Record<string, unknown>,
): Promise<ResultadoAsiento> {
  const capturaId = fila.paypal_capture_id as string | null | undefined;

  // Sin id de captura no hay con que identificar la fila. Se inserta: perder el
  // cobro seria peor que arriesgar un duplicado que hoy no se puede detectar.
  if (!capturaId) {
    const { error } = await supabase.from('payment_transactions').insert(fila);
    return { error: error ?? null, accion: 'insertado' };
  }

  const { data: existente } = await supabase
    .from('payment_transactions')
    .select('id, processor_fee')
    .eq('paypal_capture_id', capturaId)
    .maybeSingle();

  if (!existente) {
    const { error } = await supabase.from('payment_transactions').insert(fila);
    return { error: error ?? null, accion: 'insertado' };
  }

  const comisionNueva = Number(fila.processor_fee ?? 0);
  const comisionGuardada = Number(existente.processor_fee ?? 0);

  if (comisionNueva > 0 && comisionGuardada === 0) {
    const { error } = await supabase
      .from('payment_transactions')
      .update({ processor_fee: comisionNueva, net_amount: fila.net_amount })
      .eq('id', existente.id);
    return { error: error ?? null, accion: 'comision_rellenada' };
  }

  return { error: null, accion: 'sin_cambio' };
}
