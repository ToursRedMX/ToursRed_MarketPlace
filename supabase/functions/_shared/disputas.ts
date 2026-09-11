/**
 * Disputas y contracargos, para los cinco procesadores.
 *
 * POR QUE EXISTE
 *
 * Hasta el 10-sep-2026 solo `stripe-webhook` registraba disputas, y lo hacia
 * con logica propia de 240 lineas. PayPal tenia un `case` con el nombre del
 * evento cuyo cuerpo entero era `console.warn()` y `break` — parecia cobertura
 * y no persistia nada. MercadoPago, Conekta y OpenPay no mencionaban la
 * palabra.
 *
 * Copiar esas 240 lineas cuatro veces habria garantizado que se separaran. Aqui
 * vive el efecto —fila, bloqueo de check-in, alerta y asiento contable— y cada
 * webhook solo traduce SU payload a `DisputaNormalizada`.
 *
 * ESTE MODULO NO IMPORTA supabase-js, A PROPOSITO
 *
 * Cuando se escribio, los cinco webhooks no usaban la misma version:
 * `stripe-webhook` importaba `@2.39.6` y otros `@2.116.0`. Un import aqui
 * metia una segunda copia en el bundle de los que usaran otra — lo mismo que
 * se descarto el 10-sep-2026 al construir `contextoAuditoria.ts`, y que ya
 * habia dado un error de tipos real. Por eso el cliente entra como parametro
 * con un tipo estructural minimo. *
 * ESA PREMISA YA NO ES CIERTA, Y CONVIENE QUE SE SEPA
 *
 * El 10-sep-2026 los 175 imports de supabase-js se unificaron en `@2.116.0`, y
 * la regla de version unica de `check-edge-deps.mjs` impide que vuelvan a
 * divergir. Hoy un import aqui NO duplicaria nada.
 *
 * El parametro estructural se mantiene igualmente: un modulo compartido que
 * fija una version se la impone a todas las funciones que lo importan, y la
 * proxima subida tendria que pasar por aqui. No cuesta nada y no ata a nadie.
 * Pero a partir de ahora es una preferencia de diseno, no una restriccion: si
 * alguien decide importar supabase-js en este archivo, no estara repitiendo el
 * error de 2026.
 *
 * LO QUE NO GARANTIZA
 *
 * El mapeo de cada procesador se escribio contra su DOCUMENTACION, no contra
 * payloads observados: en la base hay 0 disputas de los cinco. Por eso
 * `last_payload` guarda el evento entero siempre — si un campo viene en otro
 * sitio, el dato no se pierde y el mapeo se corrige leyendo la fila. Ver
 * `scripts/test-disputas.mjs`.
 */

/** Tipo estructural minimo: lo unico que este modulo usa del cliente. */
export interface ClienteMinimo {
  from(tabla: string): any;
  rpc(nombre: string, args?: Record<string, unknown>): any;
}

export type Procesador = "stripe" | "paypal" | "mercadopago" | "conekta" | "openpay";

/** Que le pasó a la disputa, con vocabulario nuestro y no de un procesador. */
export type FaseDisputa =
  | "abierta"      // se acaba de abrir: hay ventana para responder
  | "actualizada"  // cambio algo sin cerrarse
  | "cerrada";     // hubo resolucion; `resultado` dice cual

export type ResultadoDisputa = "ganada" | "perdida" | "otro";

export interface DisputaNormalizada {
  procesador: Procesador;
  /** Id de la disputa EN EL PROCESADOR. Unico solo dentro de ese procesador. */
  disputaId: string;
  /** Id del cobro disputado, si el evento lo trae. */
  cobroId?: string | null;
  /** Id del pago en el procesador, con el que se busca la payment_transaction. */
  pagoId?: string | null;
  /** En unidades de la moneda, NO en centavos. Cada webhook convierte lo suyo. */
  monto: number;
  moneda: string;
  motivo?: string | null;
  /** Estado crudo del procesador, tal cual, para no perder matiz. */
  estadoCrudo: string;
  fase: FaseDisputa;
  resultado?: ResultadoDisputa;
  /** Fecha limite para presentar evidencia, si el procesador la informa. */
  evidenciaVence?: string | null;
  /** Se marca solo cuando el procesador dice que ya retiro/repuso el dinero. */
  fondosRetirados?: boolean;
  fondosRepuestos?: boolean;
  /** Nombre del evento tal cual lo mando el procesador. */
  tipoEvento: string;
  /** El evento entero. Se guarda siempre. */
  payload: unknown;
}

/**
 * Columna de `payment_transactions` donde vive el id del pago de cada
 * procesador. Sin esto no se puede ligar la disputa con la reserva.
 *
 * OJO: `payment_transactions` NO tiene una columna generica. Tiene una por
 * procesador, y se llaman distinto de lo que uno supondria — se verificaron
 * contra la base el 10-sep-2026, porque el primer intento de este modulo
 * asumio un `processor_payment_id` que no existe:
 *
 *   select column_name from information_schema.columns
 *   where table_schema='public' and table_name='payment_transactions';
 *
 * Conekta tiene DOS (`conekta_order_id` y `conekta_charge_id`). Se busca por
 * la de orden, que es la que el webhook de contracargo trae; si no liga, se
 * intenta por la de cargo. `scripts/test-disputas.mjs` comprueba que estos
 * nombres sigan existiendo.
 */
const COLUMNA_DE_PAGO: Record<Procesador, string[]> = {
  stripe: ["stripe_payment_intent_id"],
  paypal: ["paypal_capture_id"],
  mercadopago: ["mercadopago_payment_id"],
  conekta: ["conekta_order_id", "conekta_charge_id"],
  openpay: ["openpay_charge_id"],
};

/** Cuenta contable del cargo por contracargo perdido. */
const CUENTA_CONTRACARGO = "606.03";
/** Cuenta de saldo. Es generica de tarjeta, no hay una por procesador. */
const CUENTA_SALDO = "102.03";

export interface ResultadoRegistro {
  ok: boolean;
  disputaFilaId?: string;
  bookingId?: string | null;
  motivo?: string;
}

/**
 * Registra la disputa y aplica sus efectos. Nunca lanza: un webhook que revienta
 * hace que el procesador reintente en bucle.
 */
export async function registrarDisputa(
  supabase: ClienteMinimo,
  d: DisputaNormalizada,
  avisos: {
    notificarAdmins: (tipo: string, titulo: string, mensaje: string, data: Record<string, unknown>) => Promise<void>;
    alertarOps: (asunto: string, filas: [string, string][]) => Promise<void>;
    crearAsientoContable: (opts: {
      entryType: "ingreso" | "egreso" | "diario" | "apertura";
      descripcion: string;
      sourceType: string;
      sourceId: string;
      lineas: { account_code: string; description: string; debit: number; credit: number }[];
    }) => Promise<string | null>;
  },
): Promise<ResultadoRegistro> {
  const ahora = new Date().toISOString();

  // ---- Ligar con la reserva, si se puede -----------------------------------
  let ptxId: string | null = null;
  let bookingId: string | null = null;

  if (d.pagoId) {
    for (const columna of COLUMNA_DE_PAGO[d.procesador]) {
      const { data: ptx } = await supabase
        .from("payment_transactions")
        .select("id, booking_id")
        .eq(columna, d.pagoId)
        .maybeSingle();
      if (ptx) {
        ptxId = ptx.id;
        bookingId = ptx.booking_id;
        break;
      }
    }
  }
  if (!ptxId) {
    // Se registra igual. Una disputa sin ligar sigue siendo una disputa, y
    // perderla por no poder ligarla seria el peor de los dos errores.
    console.warn(
      `Disputa ${d.procesador}/${d.disputaId}: sin payment_transaction para el pago ${d.pagoId ?? "(no informado)"}. Se registra sin ligar.`,
    );
  }

  // ---- La fila --------------------------------------------------------------
  const fila: Record<string, unknown> = {
    processor: d.procesador,
    processor_dispute_id: d.disputaId,
    processor_charge_id: d.cobroId ?? null,
    processor_payment_id: d.pagoId ?? null,
    amount: d.monto,
    currency: d.moneda.toLowerCase(),
    reason: d.motivo ?? null,
    status: d.estadoCrudo,
    evidence_due_by: d.evidenciaVence ?? null,
    last_event_type: d.tipoEvento,
    last_payload: d.payload,
    updated_at: ahora,
  };
  if (ptxId) fila.payment_transaction_id = ptxId;
  if (bookingId) fila.booking_id = bookingId;
  if (d.fondosRetirados) fila.funds_withdrawn_at = ahora;
  if (d.fondosRepuestos) fila.funds_reinstated_at = ahora;
  if (d.fase === "cerrada") {
    fila.closed_at = ahora;
    fila.outcome = d.estadoCrudo;
  }

  const { data: disputa, error } = await supabase
    .from("payment_disputes")
    .upsert(fila, { onConflict: "processor,processor_dispute_id" })
    .select("id, booking_id")
    .single();

  if (error || !disputa) {
    console.error(`Error guardando la disputa ${d.procesador}/${d.disputaId}:`, error);
    return { ok: false, motivo: "no se pudo guardar la fila" };
  }

  const reserva: string | null = bookingId ?? disputa.booking_id ?? null;

  // ---- Abierta: bloquear check-in y avisar ---------------------------------
  if (d.fase === "abierta") {
    if (reserva) {
      await supabase.from("bookings").update({ dispute_hold_at: ahora }).eq("id", reserva);
    }

    const limite = d.evidenciaVence
      ? new Date(d.evidenciaVence).toLocaleString("es-MX")
      : "sin fecha informada";
    const moneda = d.moneda.toUpperCase();

    await avisos.notificarAdmins(
      "payment_dispute_opened",
      "Disputa de pago abierta",
      `Se abrio una disputa en ${d.procesador} por $${d.monto} ${moneda}. Fecha limite para responder: ${limite}.`,
      {
        dispute_id: disputa.id,
        processor: d.procesador,
        processor_dispute_id: d.disputaId,
        booking_id: reserva,
        evidence_due_by: d.evidenciaVence ?? null,
      },
    );

    await avisos.alertarOps(`[ALERTA] Disputa de pago abierta - $${d.monto} ${moneda} (${d.procesador})`, [
      ["Procesador", d.procesador],
      ["Monto", `$${d.monto} ${moneda}`],
      ["Motivo", d.motivo || "no informado"],
      ["Fecha limite de evidencia", limite],
      ["Reserva", reserva || "no ligada"],
      ["Disputa", d.disputaId],
      ["Pago", d.pagoId || "no informado"],
    ]);
  }

  // ---- Cerrada: liberar o contabilizar --------------------------------------
  if (d.fase === "cerrada") {
    if (d.resultado === "ganada") {
      if (reserva) {
        await supabase.from("bookings").update({ dispute_hold_at: null }).eq("id", reserva);
      }
    } else if (d.resultado === "perdida") {
      // Idempotencia: un reintento del procesador no debe postear dos veces.
      const { count: yaPosteado } = await supabase
        .from("accounting_entries")
        .select("id", { count: "exact", head: true })
        .eq("source_type", "dispute")
        .eq("source_id", disputa.id);

      if (yaPosteado && yaPosteado > 0) {
        console.log(`Disputa ${d.disputaId} perdida: el asiento ya existia, no se duplica`);
      } else {
        await avisos.crearAsientoContable({
          entryType: "egreso",
          descripcion: `Contracargo perdido (${d.procesador} ${d.disputaId})`,
          sourceType: "dispute",
          sourceId: disputa.id,
          lineas: [
            { account_code: CUENTA_CONTRACARGO, description: `Contracargo por disputa perdida - ${d.procesador}`, debit: d.monto, credit: 0 },
            { account_code: CUENTA_SALDO, description: `Reduccion de saldo - ${d.procesador}`, debit: 0, credit: d.monto },
          ],
        });
      }
    }
  }

  return { ok: true, disputaFilaId: disputa.id, bookingId: reserva };
}
