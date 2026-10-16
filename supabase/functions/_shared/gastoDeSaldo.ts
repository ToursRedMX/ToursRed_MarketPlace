// MFA para GASTAR ToursRed Cash o puntos en un pago mixto (13-oct-2026).
//
// Contexto: el pago con wallet al 100% ya exigia un codigo TOTP (confirm-booking-wallet-payment).
// Un pago MIXTO (puntos o Cash + tarjeta, PayPal, Conekta, OpenPay o MercadoPago) no: el saldo
// y los puntos quedan comprometidos en la RESERVA al crearla y el webhook del procesador los
// debita cuando el cobro sale bien. Ninguna funcion del camino pedia el segundo factor, asi que
// una sesion robada gastaba el saldo sin el codigo.
//
// Los creadores de cobro no reciben el saldo en la peticion (salvo Stripe): lo leen de la
// reserva. Por eso la decision se toma con la reserva:
//
//   - `payment_status !== 'succeeded'`: el saldo todavia no se debito (el webhook lo hace al
//     cobrar). Una reserva ya pagada puede conservar `points_used` y `toursred_cash_used` para
//     siempre; un suplemento pagado despues con tarjeta NO debe pedir el codigo otra vez.
//   - `points_used > 0` o `toursred_cash_used > 0`: hay saldo o puntos por gastar.
//
// El codigo es de UN SOLO USO (consume_spend_step_up): cada intento de cobro con saldo exige uno
// nuevo. Sin MFA configurado la respuesta es MFA_NOT_CONFIGURED, igual que el wallet al 100%.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { enforceStepUp } from "./stepUpCheck.ts";

export interface ReservaConSaldo {
  user_id?: string | null;
  payment_status?: string | null;
  points_used?: number | string | null;
  toursred_cash_used?: number | string | null;
}

/** true si el cobro de esta reserva va a gastar saldo o puntos. */
export function reservaGastaSaldo(reserva: ReservaConSaldo | null | undefined): boolean {
  if (!reserva) return false;
  if (reserva.payment_status === "succeeded") return false;
  return (Number(reserva.points_used) || 0) > 0 || (Number(reserva.toursred_cash_used) || 0) > 0;
}

/**
 * `null` = puede seguir (no gasta saldo, o el codigo era valido y ya se consumio).
 * Si no, la Response lista para devolver: 403 STEP_UP_REQUIRED / MFA_NOT_CONFIGURED.
 * Falla cerrado: sin cabecera Authorization se rechaza.
 */
export async function exigirMfaSiGastaSaldo(
  req: Request,
  userId: string | undefined,
  reserva: ReservaConSaldo | null | undefined,
): Promise<Response | null> {
  if (!reservaGastaSaldo(reserva)) return null;
  const authHeader = req.headers.get("Authorization");
  if (!userId || !authHeader) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
  // El webhook debita el saldo de la RESERVA, o sea del DUENO. Si quien paga no es el dueno, el
  // saldo ajeno se gastaria sin el codigo del dueno: PayPal y MercadoPago no comprobaban el dueno
  // al cobrar la reserva. Con saldo de por medio, la reserva tiene que ser de quien llama.
  if (reserva?.user_id && reserva.user_id !== userId) {
    return new Response(JSON.stringify({ error: "No tienes permiso sobre esta reserva" }), {
      status: 403,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  return await enforceStepUp(userClient, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, supabaseUrl, userId);
}

// Apartar el saldo al crear el cobro (16-oct-2026).
//
// Antes, el saldo y los puntos de un pago mixto se debitaban en el webhook,
// DESPUES de que la pasarela cobraba el monto ya descontado. Si en esa ventana
// se gastaban en otra pestana, el webhook fallaba en silencio y la reserva se
// confirmaba con el descuento sin pagar; y Conekta y OpenPay ni siquiera los
// debitaban. apartar_saldo_de_reserva los descuenta AQUI, antes de abrir la
// pasarela, con las mismas llaves que los webhooks (su descuento posterior es
// un no-op). Si la reserva muere sin pagarse, el trigger liberar_saldo_apartado
// los devuelve.

interface ClienteConRpc {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
}

/**
 * `null` = puede seguir (no hay saldo que apartar, o ya quedo apartado).
 * Si no, la Response 400 lista para devolver: no se abre la pasarela.
 *
 * @param montos  lo que el cobro aplica como descuento. Sin montos se aparta lo
 *                comprometido en la reserva (lo que ya descuenta amount_due_now).
 */
export async function apartarSaldoDeReserva(
  supabase: ClienteConRpc,
  bookingId: string,
  reserva: ReservaConSaldo | null | undefined,
  montos?: { puntos: number; cash: number },
): Promise<Response | null> {
  const gasta = montos ? (montos.puntos > 0 || montos.cash > 0) : reservaGastaSaldo(reserva);
  if (!gasta) return null;
  const { error } = await supabase.rpc("apartar_saldo_de_reserva", {
    p_booking_id: bookingId,
    ...(montos ? { p_puntos: montos.puntos, p_cash: montos.cash } : {}),
  });
  if (!error) return null;
  console.error(`apartar_saldo_de_reserva ${bookingId}: ${error.message}`);
  const sinSaldo = /insuficiente|insufficient/i.test(error.message);
  return new Response(
    JSON.stringify({
      success: false,
      error: sinSaldo
        ? "Tu saldo de ToursRed Cash o tus puntos ya no alcanzan para el descuento de esta reserva."
        : "No pudimos apartar tu saldo de ToursRed Cash y puntos para este pago. Intenta de nuevo.",
      details: sinSaldo ? "insufficient_balance" : "hold_failed",
    }),
    { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
  );
}
