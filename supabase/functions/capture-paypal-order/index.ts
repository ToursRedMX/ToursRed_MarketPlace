import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as Sentry from "npm:@sentry/deno@9";
import { cubreElAnticipo } from "../_shared/exigible.ts";
import { registrarFallo } from "../_shared/falloSilencioso.ts";

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    release: Deno.env.get("SENTRY_RELEASE"),
    tracesSampleRate: 0.1,
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function getPayPalAccessToken(clientId: string, clientSecret: string, isSandbox: boolean): Promise<string> {
  const base = isSandbox
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("PayPal token error:", errorBody);
    throw new Error("Failed to get PayPal access token");
  }
  const data = await response.json();
  return data.access_token;
}

async function getPayPalOrderDetails(base: string, accessToken: string, orderId: string): Promise<any> {
  const response = await fetch(`${base}/v2/checkout/orders/${orderId}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    const errorBody = await response.text();
    console.error("PayPal get order error:", errorBody);
    throw new Error("Failed to get PayPal order details");
  }
  return response.json();
}

async function activateGiftCard(supabase: any, giftCardId: string, paypalTransactionId: string | null) {
  const { data: existingGc } = await supabase
    .from("gift_cards")
    .select("payment_status")
    .eq("id", giftCardId)
    .maybeSingle();

  if (existingGc?.payment_status === "paid") {
    console.log(`Gift card ${giftCardId} already paid — skipping duplicate activation (PayPal)`);
    return;
  }

  const { error } = await supabase
    .from("gift_cards")
    .update({
      status: "active",
      payment_status: "paid",
      payment_provider: "paypal",
      paypal_transaction_id: paypalTransactionId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", giftCardId)
    .in("status", ["pending_payment", "active"]);

  if (error) {
    console.error("Error updating gift card:", error);
  } else {
    // Poliza contable: venta de gift card
    await supabase.rpc("create_accounting_entry_for_gift_card_sale", { p_gift_card_id: giftCardId });
  }

  EdgeRuntime.waitUntil(
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-gift-card-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ giftCardId: giftCardId }),
    })
  );
}

interface ClienteDeCobros {
  from(tabla: string): {
    select(columnas: string): {
      eq(columna: string, valor: unknown): {
        maybeSingle(): Promise<{ data: { id?: string } | null }>;
      };
    };
    insert(fila: Record<string, unknown>): Promise<{ error: { message: string } | null }>;
  };
}

/** Lo que interesa de la captura de PayPal; el resto del payload se guarda tal cual. */
interface CapturaPaypal {
  amount?: { value?: string; currency_code?: string };
  seller_receivable_breakdown?: { paypal_fee?: { value?: string } };
  purchase_units?: Array<{ payments?: { captures?: CapturaPaypal[] } }>;
}

/**
 * Asienta un cobro de PayPal en `payment_transactions`.
 *
 * Existe como funcion —y no copiada en los dos sitios— porque la llaman los DOS
 * caminos de `confirmBooking`: el que confirma y el que deja la reserva en
 * `processing` por cobro corto. Si fueran dos copias, la de la rama corta seria
 * la que se queda vieja, que es justo la que menos se mira.
 *
 * Idempotente por `paypal_capture_id`: PayPal reintenta, y esta funcion se
 * llama dos veces sobre la misma captura cuando un cobro parcial se completa
 * despues.
 *
 * No lanza nunca. Se la llama en caminos donde el dinero YA se cobro: fallar
 * aqui no debe impedir que la reserva se marque, solo dejar el rastro.
 */
async function registrarCobroPaypal(
  supabase: ClienteDeCobros,
  bookingId: string,
  paypalTransactionId: string | null,
  captureData?: CapturaPaypal,
): Promise<void> {
  if (!paypalTransactionId) return;
  try {
    const capture = captureData?.purchase_units?.[0]?.payments?.captures?.[0] || captureData;
    const amountValue = parseFloat(capture?.amount?.value ?? "0");
    const currencyCode = (capture?.amount?.currency_code || "MXN").toLowerCase();
    const paypalFee = parseFloat(capture?.seller_receivable_breakdown?.paypal_fee?.value || "0");

    const { data: existingTx } = await supabase
      .from("payment_transactions")
      .select("id")
      .eq("paypal_capture_id", paypalTransactionId)
      .maybeSingle();

    if (existingTx) return;

    const { error } = await supabase.from("payment_transactions").insert({
      booking_id: bookingId,
      paypal_capture_id: paypalTransactionId,
      payment_processor: "paypal",
      amount: amountValue,
      currency: currencyCode,
      status: "succeeded",
      payment_method_type: "Tarjeta",
      charge_context: "booking_deposit",
      charge_reference_id: bookingId,
      processor_fee: paypalFee,
      net_amount: amountValue - paypalFee,
      metadata: captureData || null,
    });

    if (error) {
      await registrarFallo(
        "capture-paypal-order/no-se-pudo-asentar-el-cobro",
        `PayPal cobro ${amountValue} en la captura ${paypalTransactionId} y la fila de payment_transactions no se pudo insertar.`,
        { bookingId, paypalTransactionId, amountValue, motivo: error.message },
      );
      return;
    }
    console.log(`payment_transactions record created for PayPal capture ${paypalTransactionId}`);
  } catch (txErr) {
    await registrarFallo(
      "capture-paypal-order/no-se-pudo-asentar-el-cobro",
      `Excepcion al asentar la captura ${paypalTransactionId} de PayPal.`,
      { bookingId, paypalTransactionId, motivo: String(txErr) },
    );
  }
}

async function confirmBooking(supabase: any, bookingId: string, paypalTransactionId: string | null, captureData?: any, usuarioAutenticado?: string | null) {
  const { data: existingBooking, error: errorReserva } = await supabase
    .from("bookings")
      .select("payment_status, deposit_amount, amount_due_now, membership_cost, user_id, toursred_cash_used, points_used")
    .eq("id", bookingId)
    .maybeSingle();

  // Falla cerrado. Sin esto, una lectura fallida dejaba `existingBooking` en
  // null, el piso se calculaba sobre un objeto vacio (piso 0) y CUALQUIER cobro
  // confirmaba la reserva.
  if (errorReserva || !existingBooking) {
    console.error(`No se pudo leer la reserva ${bookingId}; no se confirma`, errorReserva);
    return;
  }

  // Autenticar no es autorizar: sin esto, cualquier usuario con sesion podia
  // capturar la orden de otro con solo conocer el orderId. `usuarioAutenticado`
  // llega null en los caminos sin sesion (gift_card no pasa por aqui).
  if (usuarioAutenticado && existingBooking.user_id !== usuarioAutenticado) {
    console.error(`Usuario ${usuarioAutenticado} intento capturar la reserva ${bookingId}, que no es suya`);
    return;
  }

  if (existingBooking?.payment_status === "succeeded") {
    console.log(`Booking ${bookingId} already confirmed — skipping duplicate side effects (PayPal)`);
    return;
  }

  const capturedAmount = parseFloat(
    (captureData?.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value) ?? captureData?.amount?.value ?? "0"
  );
  // `charge_context` NO es opcional en este filtro. Sin el entraban tambien los
  // cobros de seguro, servicios opcionales, suplementos y cuotas del plan de
  // pagos, y ese dinero contaba como si fuera anticipo. Esta en los datos: la
  // reserva 860a587c tiene un `payment_plan_installment` de 2,162.79 que hoy se
  // suma contra un anticipo de 3,089.70. `_shared/coberturaDePago.ts` filtra
  // igual; esta consulta se habia quedado atras.
  const { data: priorPaypalPayments, error: errorPagosPrevios } = await supabase
    .from("payment_transactions")
    .select("amount")
    .eq("booking_id", bookingId)
    .eq("status", "succeeded")
    .eq("payment_processor", "paypal")
    .eq("charge_context", "booking_deposit");
  const alreadyPaid = (priorPaypalPayments || []).reduce((sum: number, tx: any) => sum + Number(tx.amount || 0), 0);
  const totalPaid = alreadyPaid + capturedAmount;
  // Ver `_shared/exigible.ts`. El maximo con `amount_due_now` convertia esto en
  // un piso que quien pago con puntos o ToursRed Cash NUNCA alcanza: la reserva
  // quedaba en `processing` con el dinero ya cobrado. El piso correcto es el
  // anticipo bruto, y la billetera se suma a lo cubierto.
  const cobertura = cubreElAnticipo(existingBooking, totalPaid);

  if (!cobertura.suficiente) {
    // PayPal YA cobro. Antes esta rama solo marcaba `processing` y volvia: el
    // dinero quedaba capturado y sin asentar en ningun lado, con un console.log
    // que nadie lee. Dos consecuencias:
    //
    //   1. Un cobro real sin rastro contable.
    //   2. Peor: DOS pagos parciales nunca se sumaban. Como el primero no
    //      quedaba registrado, en el segundo `alreadyPaid` volvia a ser 0 y la
    //      reserva no confirmaba nunca. El viajero pagaba dos veces.
    //
    // El webhook de Stripe hace justo esto en el mismo caso.
    await registrarCobroPaypal(supabase, bookingId, paypalTransactionId, captureData);
    await supabase.from("bookings").update({ payment_status: "processing" }).eq("id", bookingId);
    await registrarFallo(
      "capture-paypal-order/cobertura-insuficiente",
      `Cobro por debajo del anticipo: cubierto ${cobertura.cubierto} de ${cobertura.piso} exigidos. La reserva queda en processing, sin confirmar.`,
      {
        bookingId,
        capturedAmount,
        pagadoPrevio: alreadyPaid,
        billetera: cobertura.billetera,
        cubierto: cobertura.cubierto,
        piso: cobertura.piso,
        faltante: cobertura.faltante,
        paypalTransactionId,
        ...(errorPagosPrevios ? { errorLeyendoPagosPrevios: errorPagosPrevios.message } : {}),
      },
    );
    return;
  }

  const { error } = await supabase
    .from("bookings")
    .update({
      payment_status: "succeeded",
      status: "confirmed",
      payment_method: "paypal",
      payment_provider: "paypal",
      paypal_transaction_id: paypalTransactionId,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId);

  if (error) {
    console.error("Error updating booking:", error);
  }

  // Deduct ToursRed Cash from wallet if used
  const toursRedCashUsed = parseFloat(existingBooking?.toursred_cash_used || '0');
  if (toursRedCashUsed > 0 && existingBooking?.user_id) {
    try {
      const { data: existingWalletTx } = await supabase
        .from("wallet_transactions")
        .select("id")
        .eq("user_id", existingBooking.user_id)
        .eq("reference_id", bookingId)
        .eq("reference_type", "booking")
        .eq("type", "debit")
        .maybeSingle();

      if (existingWalletTx) {
        console.log(`⚠️ ToursRed Cash already deducted for booking ${bookingId} (PayPal), skipping...`);
      } else {
        const { error: walletError } = await supabase.rpc('update_wallet_balance', {
          p_user_id: existingBooking.user_id,
          p_amount: -toursRedCashUsed,
          p_type: 'debit',
          p_description: `Aplicado a reserva #${bookingId}`,
          p_reference_id: bookingId,
          p_reference_type: 'booking',
          p_idempotency_key: `${bookingId}_charge_booking`,
        });
        if (walletError) {
          console.error(`Error deducting ToursRed Cash (PayPal): ${walletError.message}`);
        } else {
          console.log(`Successfully deducted ${toursRedCashUsed} MXN from user wallet (PayPal)`);
        }
      }
    } catch (walletErr) {
      console.error('Error processing ToursRed Cash deduction (PayPal):', walletErr);
    }
  }

  // Deduct ToursRed Points if used
  const pointsUsed = parseInt(existingBooking?.points_used || '0');
  if (pointsUsed > 0) {
    try {
      const { error: pointsError } = await supabase.rpc('deduct_points_for_booking', {
        p_booking_id: bookingId,
        p_points_to_deduct: pointsUsed,
      });
      if (pointsError) {
        console.error(`Error deducting points (PayPal): ${pointsError.message}`);
      } else {
        console.log(`Successfully deducted ${pointsUsed} points from user points wallet (PayPal)`);
      }
    } catch (pointsErr) {
      console.error('Error processing points deduction (PayPal):', pointsErr);
    }
  }

  // Persist payment_transactions record for multi-processor refund support
  await registrarCobroPaypal(supabase, bookingId, paypalTransactionId, captureData);

  // Process unpaid optional services (pickup, language, traditional optionals)
  try {
    const { data: unpaidOptionals } = await supabase
      .from("booking_optional_services")
      .select("id, subtotal, total_paid")
      .eq("booking_id", bookingId)
      .eq("is_cancelled", false)
      .is("paid_at", null);

    // A diferencia de lo que hacia antes, aqui NO se recalcula service_charge ni se
    // vuelve a llamar apply_membership_service_fee_exemption: esa RPC muta memberships,
    // y create_booking_atomic ya aplico la exencion sobre el cargo de los extras
    // (linea 348 de esa funcion) y guardo el service_charge neto al crear la reserva.
    // Repetirlo consumia dos veces el tope mensual del socio.
    //
    // Mismo criterio que openpay-webhook:317, que ya lo evitaba a proposito y dejo
    // documentado que Stripe y PayPal si lo hacian. Aqui solo se marcan como pagados
    // los extras que venian en el pago inicial, sin recalcular importes.
    if (unpaidOptionals && unpaidOptionals.length > 0) {
      for (const opt of unpaidOptionals) {
        if ((opt.total_paid || opt.subtotal) <= 0) continue;
        await supabase
          .from("booking_optional_services")
          .update({
            paid_at: new Date().toISOString(),
            payment_method: "paypal",
            total_paid: opt.total_paid || opt.subtotal,
          })
          .eq("id", opt.id);
      }
      console.log(`Processed ${unpaidOptionals.length} optional services for booking ${bookingId} (PayPal)`);
    }
  } catch (optError) {
    console.error("Error processing optional services (PayPal):", optError);
  }

  // Apply preventa commission discount (10% on first 10 preventa bookings)
  EdgeRuntime.waitUntil(
    (async () => {
      try {
        const { data: bookingForPreventa } = await supabase
          .from("bookings")
          .select("es_reserva_preventa, commission_amount, tour_id")
          .eq("id", bookingId)
          .single();

        if (bookingForPreventa?.es_reserva_preventa) {
          const { data: preventaCount } = await supabase.rpc("get_preventa_bookings_count", { p_tour_id: bookingForPreventa.tour_id });
          if ((preventaCount || 0) <= 10) {
            const commissionBase = parseFloat(bookingForPreventa.commission_amount) || 0;
            const preventaComisionDescuento = Math.round(commissionBase * 0.10 * 100) / 100;
            await supabase.from("bookings").update({
              commission_amount: Math.round((commissionBase - preventaComisionDescuento) * 100) / 100,
              preventa_comision_descuento: preventaComisionDescuento,
            }).eq("id", bookingId);
            console.log(`✅ Preventa commission discount applied (PayPal): -${preventaComisionDescuento}`);
          }
        }
      } catch (preventaErr) {
        console.error("Error processing preventa commission discount (PayPal):", preventaErr);
      }
    })()
  );

  EdgeRuntime.waitUntil(
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-booking-confirmation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ booking_id: bookingId }),
    })
  );

  EdgeRuntime.waitUntil(
    (async () => {
      try {
        const { data: cfdiSettings } = await supabase
          .from("platform_settings")
          .select("pac_provider")
          .maybeSingle();
        if (cfdiSettings?.pac_provider && cfdiSettings.pac_provider !== "none") {
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-booking-cfdi`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ booking_id: bookingId, payment_form: '04' }),
          });
        }
      } catch (cfdiErr) {
        console.error("Error triggering booking CFDI (paypal):", cfdiErr);
      }
    })()
  );

  // Sync booking to accounting system (fire and forget)
  EdgeRuntime.waitUntil(
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-booking-to-accounting`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ booking_id: bookingId }),
    }).catch((err) => console.error("Error triggering booking accounting sync (paypal):", err))
  );

  // Activate payment plan if the booking was created with selected_payment_mode === 'plan'
  EdgeRuntime.waitUntil(
    (async () => {
      try {
        const { data: bkForPlan } = await supabase
          .from("bookings")
          .select(`
            id, selected_payment_mode, total_price, deposit_amount,
            tours:tour_id(payment_option, payment_plan_mode, installment_definitions, start_date, full_payment_days_before_departure)
          `)
          .eq("id", bookingId)
          .maybeSingle();

        if (bkForPlan?.selected_payment_mode === 'plan') {
          const tour = bkForPlan.tours as any;
          const totalPrice = parseFloat(bkForPlan.total_price) || 0;
          const depositPaid = parseFloat(bkForPlan.deposit_amount) || 0;
          const defs: any[] = tour?.installment_definitions || [];

          if (defs.length > 0) {
            const { data: existingPlan } = await supabase
              .from("booking_payment_plans")
              .select("id")
              .eq("booking_id", bookingId)
              .maybeSingle();

            if (!existingPlan) {
              const { data: plan, error: planErr } = await supabase
                .from("booking_payment_plans")
                .insert({
                  booking_id: bookingId,
                  mode: 'installments',
                  total_plan_amount: totalPrice,
                  total_amount_paid: depositPaid,
                  status: 'active',
                  paid_100_pct_at_booking: false,
                })
                .select('id')
                .single();

              if (planErr || !plan) {
                console.error('Error creating payment plan (PayPal):', planErr);
              } else {
                const bookingDate = new Date();
                const departureDate = tour?.start_date ? new Date(tour.start_date) : null;
                const daysBeforeDeparture = tour?.full_payment_days_before_departure || 15;

                const installments = defs.map((def: any, idx: number) => {
                  const amount = Math.round(totalPrice * (def.pct_of_total / 100) * 100) / 100;
                  let dueDate: Date;
                  if (def.specific_date) {
                    dueDate = new Date(def.specific_date + 'T12:00:00');
                  } else if (def.days_before_departure !== undefined && departureDate) {
                    dueDate = new Date(departureDate);
                    dueDate.setDate(dueDate.getDate() - def.days_before_departure);
                  } else {
                    dueDate = new Date(bookingDate);
                    dueDate.setDate(dueDate.getDate() + (def.days_after_booking || 0));
                  }

                  const isFirstInstallment = idx === 0;
                  const amountPaidForThisInstallment = isFirstInstallment ? Math.min(depositPaid, amount) : 0;
                  const isPaid = isFirstInstallment && amountPaidForThisInstallment >= amount;

                  return {
                    plan_id: plan.id,
                    booking_id: bookingId,
                    installment_number: idx + 1,
                    label: def.label || `Pago ${idx + 1}`,
                    amount_due: amount,
                    amount_paid: amountPaidForThisInstallment,
                    due_date: dueDate.toISOString().split('T')[0],
                    status: isPaid ? 'paid' : 'pending',
                    paid_at: isPaid ? new Date().toISOString() : null,
                  };
                });

                const { error: instErr } = await supabase
                  .from("booking_payment_plan_installments")
                  .insert(installments);

                if (instErr) {
                  console.error('Error creating installments (PayPal):', instErr);
                } else {
                  await supabase
                    .from("bookings")
                    .update({
                      has_payment_plan: true,
                      payment_plan_status: 'active',
                      payment_plan_total: totalPrice,
                      payment_plan_paid: depositPaid,
                    })
                    .eq("id", bookingId);
                  console.log(`✅ Payment plan created for booking ${bookingId} with ${installments.length} installments (PayPal)`);
                }
              }
            } else {
              console.log(`Payment plan already exists for booking ${bookingId}, skipping (PayPal)`);
            }
          }
        }
      } catch (planErr) {
        console.error('Error creating payment plan for booking (PayPal):', planErr);
      }
    })()
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Del cuerpo solo se usan orderId y context. El front tambien manda
    // bookingId, giftCardId y slotId, pero NO se leen a proposito: el
    // identificador del recurso se toma de la respuesta de PayPal
    // (purchase_units[0].reference_id / custom_id), que es la fuente
    // autoritativa. Aceptarlos del cliente permitiria dirigir un pago a una
    // reserva distinta de aquella para la que se creo la orden.
    //
    // Se dejaban desestructurados sin usar y eso confunde: parece que el
    // bookingId del cliente decide algo. No decide nada.
    const { orderId, context } = await req.json();

    if (!orderId) {
      return new Response(JSON.stringify({ error: "order_id requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let usuarioAutenticado: string | null = null;
    if (context !== "gift_card") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await authClient.auth.getUser();
      if (!user) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      // Se guarda para `confirmBooking`, que es donde se puede comprobar la
      // propiedad: el id de la reserva no llega en el cuerpo, sale del
      // `reference_id` que devuelve PayPal mas abajo.
      usuarioAutenticado = user.id;
    }

    let paypalClientId = Deno.env.get("PAYPAL_CLIENT_ID");
    let paypalClientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");
    let isSandbox = Deno.env.get("PAYPAL_SANDBOX") === "true";

    const { data: settings } = await supabase
      .from("platform_settings")
      .select("paypal_client_id, paypal_sandbox")
      .maybeSingle();
    const { data: secrets } = await supabase
      .from("platform_secrets")
      .select("paypal_client_secret")
      .maybeSingle();

    if (!paypalClientId && settings?.paypal_client_id) paypalClientId = settings.paypal_client_id;
    if (!paypalClientSecret && secrets?.paypal_client_secret) paypalClientSecret = secrets.paypal_client_secret;
    if (settings?.paypal_sandbox !== undefined && settings?.paypal_sandbox !== null) {
      isSandbox = settings.paypal_sandbox;
    }

    if (!paypalClientId || !paypalClientSecret) {
      console.error("PayPal credentials missing. env:", !!Deno.env.get("PAYPAL_CLIENT_ID"), "settings:", !!settings?.paypal_client_id);
      return new Response(JSON.stringify({ error: "PayPal no configurado" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const base = isSandbox
      ? "https://api-m.sandbox.paypal.com"
      : "https://api-m.paypal.com";

    const accessToken = await getPayPalAccessToken(paypalClientId, paypalClientSecret, isSandbox);

    const captureResponse = await fetch(`${base}/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "PayPal-Request-Id": `capture_${orderId}`,
      },
    });

    let captureData: any;
    let captureStatus: string;

    if (!captureResponse.ok) {
      const errorBody = await captureResponse.text();
      console.error("PayPal capture error status:", captureResponse.status, "body:", errorBody);

      let errorJson: any = {};
      try { errorJson = JSON.parse(errorBody); } catch {}

      const isAlreadyCaptured =
        captureResponse.status === 422 &&
        errorJson?.details?.some((d: any) => d.issue === "ORDER_ALREADY_CAPTURED");

      if (isAlreadyCaptured) {
        console.log("Order already captured, fetching order details to confirm payment:", orderId);
        try {
          const orderDetails = await getPayPalOrderDetails(base, accessToken, orderId);
          console.log("PayPal order details status:", orderDetails.status);

          if (orderDetails.status === "COMPLETED") {
            const referenceId = orderDetails.purchase_units?.[0]?.reference_id;
            const verifiedSlotId = orderDetails.purchase_units?.[0]?.custom_id;
            const paypalTransactionId = orderDetails.purchase_units?.[0]?.payments?.captures?.[0]?.id || null;

            if (context === "featured_slot") {
              if (!verifiedSlotId) {
                return new Response(JSON.stringify({ error: "No se pudo verificar el tour destacado de esta orden" }), {
                  status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
              }
              const totalPaid = parseFloat(orderDetails.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? "0");
              await supabase.rpc("confirm_featured_slot_payment", {
                p_slot_id: verifiedSlotId,
                p_payment_id: paypalTransactionId ?? orderId,
                p_payment_provider: "paypal",
                p_total: totalPaid,
              });
              EdgeRuntime.waitUntil(
                fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-featured-slot-cfdi`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                  },
                  body: JSON.stringify({ slot_id: verifiedSlotId }),
                }).catch((err) => console.error("Error triggering featured slot CFDI (paypal already captured):", err))
              );
            } else if (context === "gift_card" && referenceId) {
              await activateGiftCard(supabase, referenceId, paypalTransactionId);
            } else if (context === "supplement" && referenceId) {
              await supabase.from("booking_supplements").update({
                status: "paid", payment_provider: "paypal", updated_at: new Date().toISOString(),
              }).eq("id", referenceId);
              EdgeRuntime.waitUntil(
                (async () => {
                  const { error } = await supabase.rpc("create_accounting_entry_for_supplement", { p_supplement_id: referenceId });
                  if (error) console.error("Error creating supplement accounting entry (PayPal already captured):", error.message);
                })()
              );
            } else if (context === "extras" && referenceId) {
              const extrasType = orderDetails.purchase_units?.[0]?.custom_id || "insurance";
              if (extrasType === "optional_service") {
                await supabase.from("booking_optional_services").update({
                  paid_at: new Date().toISOString(), payment_method: "paypal",
                }).eq("id", referenceId);
                EdgeRuntime.waitUntil(
                  (async () => {
                    const { error } = await supabase.rpc("create_accounting_entry_for_optional_service", { p_bos_id: referenceId });
                    if (error) console.error("Error creating optional service accounting entry (PayPal already captured):", error.message);
                  })()
                );
              } else {
                await supabase.from("bookings").update({
                  travel_insurance_included: true,
                  travel_insurance_cost: parseFloat(orderDetails.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? "0"),
                  updated_at: new Date().toISOString(),
                }).eq("id", referenceId);
                EdgeRuntime.waitUntil(
                  (async () => {
                    const { error } = await supabase.rpc("create_accounting_entry_for_insurance_purchase", { p_booking_id: referenceId });
                    if (error) console.error("Error creating insurance accounting entry (PayPal already captured):", error.message);
                  })()
                );
              }
            } else if (context === "payment_plan_installment" && referenceId) {
              const { data: planTx } = await supabase.from("booking_payment_plan_transactions")
                .select("id").eq("plan_id", referenceId).eq("payment_provider", "paypal")
                .order("created_at", { ascending: false }).limit(1).maybeSingle();
              if (planTx?.id) {
                EdgeRuntime.waitUntil(
                  (async () => {
                    const { error } = await supabase.rpc("create_accounting_entry_for_payment_plan_installment", { p_installment_tx_id: planTx.id });
                    if (error) console.error("Error creating payment plan installment accounting entry (PayPal already captured):", error.message);
                  })()
                );
              }
            } else if (referenceId) {
              await confirmBooking(supabase, referenceId, paypalTransactionId, orderDetails, usuarioAutenticado);
            }

            return new Response(JSON.stringify({ success: true, status: "COMPLETED", alreadyCaptured: true }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          } else {
            console.error("Order not COMPLETED after already captured check, status:", orderDetails.status);
            return new Response(JSON.stringify({ success: false, status: orderDetails.status, error: "Pago no completado" }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } catch (orderErr: any) {
          console.error("Error fetching order details after already captured:", orderErr);
          return new Response(JSON.stringify({ error: "Error al verificar estado del pago" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      return new Response(JSON.stringify({ error: "Error al capturar pago de PayPal", details: errorBody }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    captureData = await captureResponse.json();
    captureStatus = captureData.status;

    console.log("PayPal capture status:", captureStatus, "orderId:", orderId);

    if (captureStatus === "COMPLETED") {
      const referenceId = captureData.purchase_units?.[0]?.reference_id;
      const verifiedSlotId = captureData.purchase_units?.[0]?.custom_id;
      const paypalTransactionId = captureData.purchase_units?.[0]?.payments?.captures?.[0]?.id || null;

      if (context === "featured_slot") {
        if (!verifiedSlotId) {
          return new Response(JSON.stringify({ error: "No se pudo verificar el tour destacado de esta orden" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const totalPaid = parseFloat(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? "0");
        await supabase.rpc("confirm_featured_slot_payment", {
          p_slot_id: verifiedSlotId,
          p_payment_id: paypalTransactionId ?? orderId,
          p_payment_provider: "paypal",
          p_total: totalPaid,
        });
        EdgeRuntime.waitUntil(
          fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-featured-slot-cfdi`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ slot_id: verifiedSlotId }),
          }).catch((err) => console.error("Error triggering featured slot CFDI (paypal):", err))
        );
      } else if (context === "gift_card" && referenceId) {
        await activateGiftCard(supabase, referenceId, paypalTransactionId);
      } else if (context === "supplement" && referenceId) {
        await supabase.from("booking_supplements").update({
          status: "paid", payment_id: paypalTransactionId ?? orderId,
          payment_provider: "paypal", updated_at: new Date().toISOString(),
        }).eq("id", referenceId);

        const capturedAmt = parseFloat(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? "0");
        const ppFee = parseFloat(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.seller_receivable_breakdown?.paypal_fee?.value ?? "0");
        await supabase.from("payment_transactions").insert({
          booking_id: (await supabase.from("booking_supplements").select("booking_id").eq("id", referenceId).maybeSingle()).data?.booking_id,
          paypal_capture_id: paypalTransactionId, payment_processor: "paypal",
          amount: capturedAmt, currency: "mxn", status: "succeeded",
          processor_fee: ppFee, net_amount: capturedAmt - ppFee,
          charge_context: "supplement", charge_reference_id: referenceId,
        });

        EdgeRuntime.waitUntil(
          fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-supplement-cfdi`, {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({ booking_supplement_id: referenceId, payment_form: "04" }),
          }).catch((e) => console.error("Error triggering supplement CFDI (PayPal):", e))
        );
        EdgeRuntime.waitUntil(
          (async () => {
            const { error } = await supabase.rpc("create_accounting_entry_for_supplement", { p_supplement_id: referenceId });
            if (error) console.error("Error creating supplement accounting entry (PayPal):", error.message);
          })()
        );

      } else if (context === "extras" && referenceId) {
        const extrasType = captureData.purchase_units?.[0]?.custom_id || "insurance";
        if (extrasType === "optional_service") {
          await supabase.from("booking_optional_services").update({
            paid_at: new Date().toISOString(), payment_method: "paypal", updated_at: new Date().toISOString(),
          }).eq("id", referenceId);

          const capturedAmt = parseFloat(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? "0");
          const ppFee = parseFloat(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.seller_receivable_breakdown?.paypal_fee?.value ?? "0");
          const bosBooking = (await supabase.from("booking_optional_services").select("booking_id").eq("id", referenceId).maybeSingle()).data?.booking_id;
          await supabase.from("payment_transactions").insert({
            booking_id: bosBooking, paypal_capture_id: paypalTransactionId, payment_processor: "paypal",
            amount: capturedAmt, currency: "mxn", status: "succeeded",
            processor_fee: ppFee, net_amount: capturedAmt - ppFee,
            charge_context: "optional_service", charge_reference_id: referenceId,
          });

          EdgeRuntime.waitUntil(
            fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-optional-service-cfdi`, {
              method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
              body: JSON.stringify({ booking_optional_service_id: referenceId, payment_form: "04" }),
            }).catch((e) => console.error("Error triggering optional service CFDI (PayPal):", e))
          );
          EdgeRuntime.waitUntil(
            (async () => {
              const { error } = await supabase.rpc("create_accounting_entry_for_optional_service", { p_bos_id: referenceId });
              if (error) console.error("Error creating optional service accounting entry (PayPal):", error.message);
            })()
          );
        } else {
          await supabase.from("bookings").update({
            travel_insurance_included: true,
            travel_insurance_cost: parseFloat(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? "0"),
            updated_at: new Date().toISOString(),
          }).eq("id", referenceId);

          const capturedAmt = parseFloat(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? "0");
          const ppFee = parseFloat(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.seller_receivable_breakdown?.paypal_fee?.value ?? "0");
          await supabase.from("payment_transactions").insert({
            booking_id: referenceId, paypal_capture_id: paypalTransactionId, payment_processor: "paypal",
            amount: capturedAmt, currency: "mxn", status: "succeeded",
            processor_fee: ppFee, net_amount: capturedAmt - ppFee,
            charge_context: "insurance", charge_reference_id: referenceId,
          });

          EdgeRuntime.waitUntil(
            fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-post-booking-insurance-cfdi`, {
              method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
              body: JSON.stringify({ booking_id: referenceId, payment_form: "04" }),
            }).catch((e) => console.error("Error triggering insurance CFDI (PayPal):", e))
          );
          EdgeRuntime.waitUntil(
            (async () => {
              const { error } = await supabase.rpc("create_accounting_entry_for_insurance_purchase", { p_booking_id: referenceId });
              if (error) console.error("Error creating insurance accounting entry (PayPal):", error.message);
            })()
          );
        }

      } else if (context === "payment_plan_installment" && referenceId) {
        const planId = referenceId;
        const { data: planRow } = await supabase.from("booking_payment_plans").select("booking_id").eq("id", planId).maybeSingle();
        let planUserId: string | null = null;
        if (planRow) {
          const { data: bkRow } = await supabase.from("bookings").select("user_id").eq("id", planRow.booking_id).maybeSingle();
          planUserId = bkRow?.user_id || null;
        }
        const capturedAmt = parseFloat(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? "0");
        const ppFee = parseFloat(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.seller_receivable_breakdown?.paypal_fee?.value ?? "0");

        const { error: allocError } = await supabase.rpc("allocate_payment_plan_installment", {
          p_plan_id: planId, p_amount: capturedAmt, p_provider: "paypal",
          p_service_charge: 0, p_gross_service_charge: 0,
          p_provider_transaction_id: paypalTransactionId ?? orderId,
          p_user_id: planUserId, p_membership_exemption_used: false, p_is_wallet_payment: false,
        });

        if (allocError) {
          console.error(`Error allocating payment plan installment (PayPal) for plan ${planId}:`, allocError.message);
        }

        await supabase.from("payment_transactions").insert({
          booking_id: planRow?.booking_id, paypal_capture_id: paypalTransactionId,
          payment_processor: "paypal", amount: capturedAmt, currency: "mxn",
          status: "succeeded", processor_fee: ppFee, net_amount: capturedAmt - ppFee,
          charge_context: "payment_plan_installment", charge_reference_id: planId,
        });

        const { data: planTx } = await supabase.from("booking_payment_plan_transactions")
          .select("id").eq("plan_id", planId).eq("payment_provider", "paypal")
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (planTx?.id) {
          EdgeRuntime.waitUntil(
            (async () => {
              const { error } = await supabase.rpc("create_accounting_entry_for_payment_plan_installment", { p_installment_tx_id: planTx.id });
              if (error) console.error("Error creating payment plan installment accounting entry (PayPal):", error.message);
            })()
          );
        }

      } else if (referenceId) {
        await confirmBooking(supabase, referenceId, paypalTransactionId, captureData, usuarioAutenticado);
      }

      return new Response(JSON.stringify({ success: true, status: captureStatus }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: false, status: captureStatus }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Error in capture-paypal-order:", err);
    if (sentryDsn) {
      Sentry.captureException(err, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return new Response(JSON.stringify({ error: err.message || "Error interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
