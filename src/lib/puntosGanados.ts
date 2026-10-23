// Cuantos ToursRed Points gana una reserva, para mostrarlo ANTES de pagar. Es el espejo en el navegador de
// `award_points_for_booking` (supabase/migrations/20261016023158_puntos_ganados_por_pesos_pagados_con_puntos.sql): si esa funcion cambia,
// esta tambien (lo vigila scripts/test-puntos-ganados.mjs). La pantalla NO decide los puntos: el servidor los otorga; esto solo
// evita prometer lo que el servidor no va a dar.
//
// La regla (Axel, 16 y 23-oct-2026):
//   - SOLO gana puntos quien tiene ToursRed Plus activo. Sin membresia el servidor otorga 0.
//   - Cada peso pagado da 1 punto con cualquier forma de pago, tambien el pagado con puntos (100 pts = $1).
//   - Va al DOBLE solo lo pagado con ToursRed Cash cuando NO intervino NINGUNA pasarela (100% Cash, o Cash + puntos). Lo pagado
//     con puntos nunca da dobles. Si hubo pasarela (aunque sea una parte), todo va sencillo.

export interface EntradaPuntosGanados {
  /** ToursRed Plus activo AHORA (status 'active' y periodo vigente), como lo exige el servidor. */
  tieneMembresiaActiva: boolean;
  /** Pesos que entran por una pasarela (tarjeta, OXXO, SPEI, PayPal, MercadoPago...). */
  pesosPasarela: number;
  /** Pesos pagados con ToursRed Cash. */
  pesosCash: number;
  /** Pesos pagados con puntos (ya convertidos: 100 puntos = $1). */
  pesosConPuntos: number;
}

export interface ResultadoPuntosGanados {
  puntos: number;
  /** true solo si ESTE pago va al doble (sin pasarela, con Cash o puntos, y con Plus activo). */
  esDoble: boolean;
}

/** Sin pasarela: nada pendiente de pasarela y entro Cash o puntos (la misma regla de confirm_booking_paid_with_wallet). */
export function esPagoSinPasarela(e: Pick<EntradaPuntosGanados, 'pesosPasarela' | 'pesosCash' | 'pesosConPuntos'>): boolean {
  return e.pesosPasarela <= 0 && (e.pesosCash > 0 || e.pesosConPuntos > 0);
}

export function puntosGanados(e: EntradaPuntosGanados): ResultadoPuntosGanados {
  if (!e.tieneMembresiaActiva) return { puntos: 0, esDoble: false };
  const sinPasarela = esPagoSinPasarela(e);
  // El servidor suma "pasarela + Cash" y lo duplica solo si no hubo pasarela; lo pagado con puntos va siempre sencillo.
  const base = Math.max(0, e.pesosPasarela) + Math.max(0, e.pesosCash);
  const puntos = Math.floor((sinPasarela ? base * 2 : base) + Math.max(0, e.pesosConPuntos));
  return { puntos: Math.max(0, puntos), esDoble: sinPasarela && e.pesosCash > 0 };
}
