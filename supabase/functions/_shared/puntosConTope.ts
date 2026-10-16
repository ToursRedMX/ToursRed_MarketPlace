// Tope de puntos para suplementos, extras y mensualidades (regla de Axel, 16-oct-2026).
//
// Los puntos ToursRed cubren como maximo el 50% de CUALQUIER pago; en una
// mensualidad, el 50% de cada abono. La reserva ya lo aplicaba en
// create_booking_atomic (v_max_points_allowed); aqui vive la misma regla para
// los cobros que no pasan por ahi.
//
// Consecuencias:
//   - "points" deja de ser una forma de pago: pagar 100% con puntos rompe el
//     tope. Los puntos viajan en `points_to_use` junto con el metodo que paga
//     el resto.
//   - El resto se paga con ToursRed Cash, tarjeta (Stripe), Conekta u OpenPay.
//     Con pasarela los puntos se apartan al crear el cobro y se consumen al
//     confirmarlo (puntos_apartados_cargos, 20261016060535). MercadoPago y
//     PayPal usan la misma base en el siguiente PR; mientras, se rechazan.
//
// 100 puntos = $1 MXN, la misma conversion que deduct_points_for_booking.

export const PUNTOS_POR_PESO = 100;
export const TOPE_PUNTOS = 0.5;

/** Metodos que hoy aceptan points_to_use. */
export const METODOS_CON_PUNTOS: readonly string[] = ["toursred_cash", "stripe", "conekta", "openpay"];

/** Maximo de puntos que puede cubrir un pago de `baseMxn` pesos. */
export function maxPuntosPermitidos(baseMxn: number): number {
  if (!Number.isFinite(baseMxn) || baseMxn <= 0) return 0;
  // Centavos enteros antes de aplicar el 50%: 250.10 * 100 da 25009.999...
  return Math.floor(Math.round(baseMxn * PUNTOS_POR_PESO) * TOPE_PUNTOS);
}

export type PuntosValidados =
  | { ok: true; puntos: number; pesos: number }
  | { ok: false; error: string };

/**
 * Lo que se puede revisar sin conocer el monto: que "points" no venga sola, que
 * points_to_use sea un entero y que acompane a un metodo que los acepta. Va ANTES del
 * codigo MFA de gasto, para no gastarle un codigo de un solo uso al viajero en
 * una peticion que se iba a rechazar de todos modos.
 *
 * @param metodo         payment_method de la peticion
 * @param puntosPedidos  points_to_use de la peticion (ausente = 0)
 */
export function validarFormaDePuntos(metodo: string, puntosPedidos: unknown): PuntosValidados {
  if (metodo === "points") {
    return {
      ok: false,
      error: "Los puntos ToursRed cubren como máximo el 50% del pago. Combínalos con ToursRed Cash.",
    };
  }

  const puntos = puntosPedidos === undefined || puntosPedidos === null ? 0 : Number(puntosPedidos);
  if (!Number.isInteger(puntos) || puntos < 0) {
    return { ok: false, error: "points_to_use debe ser un número entero de puntos, cero o mayor." };
  }
  if (puntos === 0) return { ok: true, puntos: 0, pesos: 0 };

  if (!METODOS_CON_PUNTOS.includes(metodo)) {
    return { ok: false, error: "Por ahora los puntos no se pueden combinar con MercadoPago ni PayPal." };
  }

  return { ok: true, puntos, pesos: puntos / PUNTOS_POR_PESO };
}

/**
 * validarFormaDePuntos mas el tope del 50%.
 *
 * @param baseMxn  lo que se puede pagar con puntos: el subtotal o el abono, sin
 *                 cargo por servicio (que con Cash es cero de todos modos)
 */
export function validarPuntos(metodo: string, puntosPedidos: unknown, baseMxn: number): PuntosValidados {
  const forma = validarFormaDePuntos(metodo, puntosPedidos);
  if (!forma.ok || forma.puntos === 0) return forma;
  const puntos = forma.puntos;

  const max = maxPuntosPermitidos(baseMxn);
  if (puntos > max) {
    return {
      ok: false,
      error: `Puedes usar hasta ${max.toLocaleString("es-MX")} puntos en este pago (el 50% de $${baseMxn.toFixed(2)}).`,
    };
  }

  return { ok: true, puntos, pesos: puntos / PUNTOS_POR_PESO };
}

/**
 * Puntos ganados por un pago sin pasarela: el Cash va doble y lo pagado con
 * puntos sencillo (los puntos no son monedero). Misma formula que
 * award_points_for_booking y allocate_payment_plan_installment.
 */
export function puntosGanadosSinPasarela(totalMxn: number, pesosEnPuntos: number): number {
  return Math.floor((totalMxn - pesosEnPuntos) * 2 + pesosEnPuntos);
}

// ---------------------------------------------------------------------------
// Puntos + pasarela (20261016060535)
// ---------------------------------------------------------------------------

/** El cobro con pasarela expira antes que el apartado: un pago ya no puede
 *  llegar cuando los puntos se liberan. Stripe acepta de 30 min a 24 h. */
export const MINUTOS_COBRO_CON_PUNTOS = 120;
export const MINUTOS_APARTADO = 180;

/** Conekta deja el checkout abierto 71 h (efectivo y SPEI se pagan despues):
 *  el apartado vence 2 h despues de que ya no se puede pagar. */
export const HORAS_CHECKOUT_CONEKTA = 71;
export const MINUTOS_APARTADO_CONEKTA = (HORAS_CHECKOUT_CONEKTA + 2) * 60;
/** OpenPay: lo mismo mientras no se sepa su fecha limite; con el due_date del
 *  cargo (efectivo, SPEI) se ajusta con ajustarVencimientoDeApartado. */
export const MINUTOS_APARTADO_OPENPAY = MINUTOS_APARTADO_CONEKTA;

export type ContextoDeCargo = "supplement" | "optional_service" | "insurance" | "payment_plan_installment";

interface ClienteConRpc {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Aparta los puntos de un cargo antes de abrir la pasarela. Devuelve el id del
 * apartado, o el mensaje para el viajero si no se pudo (no se abre el cobro).
 */
export async function apartarPuntosDeCargo(
  supabase: ClienteConRpc,
  userId: string,
  contexto: ContextoDeCargo,
  referencia: string,
  puntos: number,
  minutos: number = MINUTOS_APARTADO,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const venceEn = new Date(Date.now() + minutos * 60_000).toISOString();
  const { data, error } = await supabase.rpc("apartar_puntos_de_cargo", {
    p_user_id: userId,
    p_contexto: contexto,
    p_referencia: referencia,
    p_puntos: puntos,
    p_vence_en: venceEn,
  });
  if (error || typeof data !== "string") {
    const sinPuntos = /insuficientes|insufficient/i.test(error?.message ?? "");
    return {
      ok: false,
      error: sinPuntos
        ? "Ya no tienes los puntos suficientes para este pago."
        : "No pudimos apartar tus puntos para este pago. Intenta de nuevo.",
    };
  }
  return { ok: true, id: data };
}

/** Segundos epoch en que expira el cobro con pasarela (Stripe `expires_at`). */
export function expiracionDelCobroConPuntos(): number {
  return Math.floor(Date.now() / 1000) + MINUTOS_COBRO_CON_PUNTOS * 60;
}

interface ClienteConTabla {
  from: (tabla: string) => {
    update: (valores: Record<string, unknown>) => {
      eq: (columna: string, valor: string) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

/**
 * Si el procesador dio una fecha limite de pago (efectivo, SPEI), el apartado
 * vence 2 h despues de ella. Solo se alarga: nunca vence antes que el cobro.
 */
export async function ajustarVencimientoDeApartado(
  supabase: ClienteConTabla,
  apartadoId: string,
  fechaLimite: string | null | undefined,
): Promise<void> {
  if (!fechaLimite) return;
  const limite = Date.parse(fechaLimite);
  if (!Number.isFinite(limite)) return;
  const vence = new Date(Math.max(limite + 2 * 3_600_000, Date.now() + MINUTOS_APARTADO_OPENPAY * 60_000)).toISOString();
  const { error } = await supabase.from("puntos_apartados_cargos").update({ vence_en: vence }).eq("id", apartadoId);
  if (error) console.error(`ajustarVencimientoDeApartado ${apartadoId}: ${error.message}`);
}
