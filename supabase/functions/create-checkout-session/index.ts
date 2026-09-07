import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";
import Stripe from "npm:stripe@22.3.0";
import * as Sentry from "npm:@sentry/deno@9";

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    tracesSampleRate: 0.1,
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const {
      amount,
      currency = 'mxn',
      description,
      bookingId,
      metadata = {},
      success_url,
      cancel_url,
      addMembership = false,
      membershipPlan = 'monthly',
      toursRedCashUsed = 0,
      pointsUsed = 0
    } = await req.json();

    if (amount == null || !bookingId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required parameters: amount and bookingId are required"
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    if (amount <= 0) {
      return new Response(
        JSON.stringify({ success: false, error: "El monto a cobrar es cero; no se requiere pago con tarjeta." }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      console.error("Stripe secret key is not set");
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Payment configuration is incomplete", 
          details: "stripe_key_missing"
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2026-06-24.dahlia",
    });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "No authorization header" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 401,
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

    // Antes solo se comprobaba que la cabecera EXISTIERA, nunca quien venia
    // detras. Con `verify_jwt` puesto, la llave publicable ya es un JWT valido
    // del proyecto, asi que cualquiera podia abrir una sesion de cobro sobre la
    // reserva de otro. Los tres llamadores del front (BookingFlowStep4,
    // TravelersInfoPage, TravelerBookings) mandan el access_token del usuario,
    // asi que resolver la identidad de verdad no rompe ningun camino vivo.
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "No autenticado" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 401,
        }
      );
    }

    // Use service role for all database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        id,
        user_id,
        travel_insurance_included,
        travel_insurance_cost,
        deposit_amount,
        service_charge
      `)
      .eq("id", bookingId)
      .single();

    if (bookingError || !booking) {
      console.error("Error fetching booking:", bookingError);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Reserva no encontrada"
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        }
      );
    }

    // La reserva se carga con service role, asi que la autorizacion va aqui:
    // dueño de la reserva o admin. Sin esto, tener un bookingId bastaba.
    const { data: callerProfile } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    const esDueno = booking.user_id === user.id;
    const esAdmin = callerProfile?.role === "admin" || callerProfile?.role === "super_admin";

    if (!esDueno && !esAdmin) {
      console.warn(
        `create-checkout-session denegado: usuario ${user.id} pidio cobrar la reserva ${bookingId}`
      );
      return new Response(
        JSON.stringify({ success: false, error: "No tienes permiso sobre esta reserva" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 403,
        }
      );
    }

    // El saldo y los puntos que se aplican son un DESCUENTO directo sobre lo que
    // Stripe cobra (buildDesgloseLineItems los resta de las lineas). Venian del
    // cuerpo de la peticion sin contraste: pedir toursRedCashUsed alto bajaba el
    // cobro aunque la billetera estuviera vacia. El webhook despues intenta
    // descontarlos y, si no alcanza, update_wallet_balance lanza
    // 'Insufficient balance' — pero ese error solo se loguea y la reserva se
    // confirma igual. O sea: el descuento se daba y nunca se pagaba.
    const cashSolicitado = Math.max(0, Number(toursRedCashUsed) || 0);
    const puntosSolicitados = Math.max(0, Math.floor(Number(pointsUsed) || 0));

    if (cashSolicitado > 0) {
      const { data: cashWallet } = await supabase
        .from("toursred_cash_wallets")
        .select("balance")
        .eq("user_id", booking.user_id)
        .eq("is_active", true)
        .maybeSingle();

      const cashDisponible = Number(cashWallet?.balance) || 0;
      // Tolerancia de un centavo por el redondeo del front, nada mas.
      if (cashSolicitado > cashDisponible + 0.009) {
        console.warn(
          `create-checkout-session: reserva ${bookingId} pidio aplicar ${cashSolicitado} de ToursRed Cash y el saldo real es ${cashDisponible}`
        );
        return new Response(
          JSON.stringify({
            success: false,
            error: "El saldo de ToursRed Cash no alcanza para el descuento solicitado.",
            details: "insufficient_wallet_balance",
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
          }
        );
      }
    }

    if (puntosSolicitados > 0) {
      const { data: pointsWallet } = await supabase
        .from("toursred_points_wallets")
        .select("balance")
        .eq("user_id", booking.user_id)
        .maybeSingle();

      const puntosDisponibles = Number(pointsWallet?.balance) || 0;
      if (puntosSolicitados > puntosDisponibles) {
        console.warn(
          `create-checkout-session: reserva ${bookingId} pidio aplicar ${puntosSolicitados} puntos y el saldo real es ${puntosDisponibles}`
        );
        return new Response(
          JSON.stringify({
            success: false,
            error: "No tienes suficientes ToursRed Points para el descuento solicitado.",
            details: "insufficient_points_balance",
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
          }
        );
      }
    }

    const { data: customers, error: customerError } = await supabase
      .from("stripe_customers")
      .select("customer_id")
      .eq("user_id", booking.user_id)
      .maybeSingle();

    if (customerError) {
      console.error("Error fetching customer:", customerError);
    }

    let customerId;

    if (!customers) {
      const { data: userProfile } = await supabase
        .from("users")
        .select("first_name, last_name, email")
        .eq("id", booking.user_id)
        .single();

      const customer = await stripe.customers.create({
        email: userProfile?.email,
        name: userProfile ? `${userProfile.first_name || ''} ${userProfile.last_name || ''}`.trim() : undefined,
        metadata: {
          user_id: booking.user_id,
        },
      });

      customerId = customer.id;

      const { error: insertError } = await supabase
        .from("stripe_customers")
        .insert({
          user_id: booking.user_id,
          customer_id: customer.id,
        });

      if (insertError) {
        console.error("Error saving customer:", insertError);
      }
    } else {
      customerId = customers.customer_id;
    }

    const sessionConfig: any = {
      customer: customerId,
      success_url: success_url || `${req.headers.get("origin")}/booking-success?booking_id=${bookingId}`,
      cancel_url: cancel_url || `${req.headers.get("origin")}/booking-cancel?booking_id=${bookingId}`,
      metadata: {
        booking_id: bookingId,
        membership_purchased: addMembership ? 'true' : 'false',
        membership_plan: membershipPlan,
        toursred_cash_used: cashSolicitado.toString(),
        points_used: puntosSolicitados.toString(),
        ...metadata,
      },
    };

    if (addMembership) {
      const { data: settings, error: settingsError } = await supabase
        .from('platform_settings')
        .select('stripe_monthly_price_id, stripe_annual_price_id')
        .maybeSingle();

      if (settingsError || !settings) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Failed to load platform settings"
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
          }
        );
      }

      const monthlyPriceId = settings.stripe_monthly_price_id;
      const annualPriceId = settings.stripe_annual_price_id;

      if (!monthlyPriceId || !annualPriceId) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Membership configuration is incomplete"
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
          }
        );
      }

      const priceId = membershipPlan === 'monthly' ? monthlyPriceId : annualPriceId;

      sessionConfig.mode = "subscription";
      sessionConfig.payment_method_types = ['card'];
      sessionConfig.line_items = [
        {
          price: priceId,
          quantity: 1,
        },
      ];
      sessionConfig.subscription_data = {
        metadata: {
          user_id: booking.user_id,
          booking_id: bookingId,
          plan_type: membershipPlan,
        },
      };

      // Build desglose line items (deposit, optionals, insurance, service charge)
      // using the same pure-lines + progressive-discount algorithm as the payment branch.
      // In this branch, `amount` already has membershipCost subtracted (TravelersInfoPage).
      const { data: optDataSub, error: optErrorSub } = await supabase
        .from("booking_optional_services")
        .select("id, service_kind, description, subtotal, service_charge, total_paid, is_cancelled, paid_at")
        .eq("booking_id", bookingId)
        .eq("is_cancelled", false)
        .is("paid_at", null);

      if (optErrorSub) {
        console.warn("Error fetching optional services:", optErrorSub.message);
      }

      const unpaidOptionalsSub = (optDataSub || []).filter(
        (opt: any) => opt.paid_at === null && Number(opt.subtotal) > 0
      );

      const desgloseItemsSub = buildDesgloseLineItems(
        booking,
        unpaidOptionalsSub,
        puntosSolicitados,
        cashSolicitado,
        currency,
        description
      );

      // En esta rama `amount` ya viene sin el costo de la membresia
      // (TravelersInfoPage lo resta), y el desglose tampoco la incluye: la
      // membresia va como linea de suscripcion aparte. Asi que se comparan
      // magnitudes equivalentes.
      const errorMonto = validarMontoDelCliente(amount, desgloseItemsSub, bookingId);
      if (errorMonto) {
        return new Response(
          JSON.stringify({ success: false, error: errorMonto, details: "amount_mismatch" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
          }
        );
      }

      for (const item of desgloseItemsSub) {
        sessionConfig.line_items.push(item);
      }
    } else {
      // Query booking_optional_services for this booking to build separate line items
      const { data: optionalServices, error: optError } = await supabase
        .from("booking_optional_services")
        .select("id, service_kind, description, subtotal, service_charge, total_paid, is_cancelled, paid_at")
        .eq("booking_id", bookingId)
        .eq("is_cancelled", false)
        .is("paid_at", null);

      if (optError) {
        console.warn("Error fetching optional services:", optError.message);
      }

      const unpaidOptionals = (optionalServices || []).filter(
        (opt: any) => opt.paid_at === null && Number(opt.subtotal) > 0
      );

      const lineItems = buildDesgloseLineItems(
        booking,
        unpaidOptionals,
        puntosSolicitados,
        cashSolicitado,
        currency,
        description
      );

      const errorMonto = validarMontoDelCliente(amount, lineItems, bookingId);
      if (errorMonto) {
        return new Response(
          JSON.stringify({ success: false, error: errorMonto, details: "amount_mismatch" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
          }
        );
      }

      sessionConfig.mode = "payment";
      sessionConfig.payment_method_types = ['card', 'oxxo', 'customer_balance'];
      sessionConfig.payment_method_options = {
        customer_balance: {
          funding_type: 'bank_transfer',
          bank_transfer: {
            type: 'mx_bank_transfer',
          },
        },
      };
      sessionConfig.line_items = lineItems;
      sessionConfig.payment_intent_data = {
        metadata: {
          booking_id: bookingId,
          toursred_cash_used: cashSolicitado.toString(),
          points_used: puntosSolicitados.toString(),
          ...metadata,
        },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    return new Response(
      JSON.stringify({
        success: true,
        sessionId: session.id,
        url: session.url,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error creating checkout session:", error);
    if (sentryDsn) {
      Sentry.captureException(error, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "An unexpected error occurred",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

// Margen que se acepta entre lo que el front dice que va a cobrar y lo que el
// servidor calcula desde la base. Existe solo para el ruido de redondeo al
// partir el desglose en lineas; cualquier cosa mayor es un bug del front o un
// intento de pagar de menos, y en los dos casos lo correcto es no cobrar.
const TOLERANCIA_MONTO_MXN = 1;

function sumarLineas(lineas: any[]): number {
  const centavos = lineas.reduce(
    (s: number, li: any) => s + Number(li?.price_data?.unit_amount || 0),
    0
  );
  return Math.round(centavos) / 100;
}

// Devuelve null si el monto cuadra, o el texto del error si no.
// Ojo: lo que se cobra SIEMPRE son las lineas del servidor. `amount` solo se usa
// para detectar desacuerdo, nunca para fijar el precio.
function validarMontoDelCliente(
  amount: number,
  lineas: any[],
  bookingId: string
): string | null {
  const totalServidor = sumarLineas(lineas);
  const diferencia = Math.round((Number(amount) - totalServidor) * 100) / 100;

  if (Math.abs(diferencia) > TOLERANCIA_MONTO_MXN) {
    console.error(
      `create-checkout-session: el monto del cliente no cuadra con el desglose del servidor. ` +
      `cliente=${amount} servidor=${totalServidor} diferencia=${diferencia} reserva=${bookingId}`
    );
    return "El monto a cobrar no coincide con el desglose de la reserva. Recarga la pagina e intenta de nuevo.";
  }

  if (Math.abs(diferencia) >= 0.01) {
    console.warn(
      `create-checkout-session: diferencia de ${diferencia} MXN entre el front y el servidor ` +
      `(cliente=${amount}, servidor=${totalServidor}, reserva=${bookingId}). Se cobra el total del servidor.`
    );
  }

  return null;
}

// Build Stripe line items with pure amounts and a progressive discount.
// Order of discount application: deposit → optionals → insurance → service charge.
// The service charge line is protected last so it only absorbs leftover discount.
function buildDesgloseLineItems(
  booking: any,
  unpaidOptionals: any[],
  pointsUsed: number,
  toursRedCashUsed: number,
  currency: string,
  description: string
): any[] {
  const totalDiscount = (Number(pointsUsed) || 0) / 100 + (Number(toursRedCashUsed) || 0);

  // --- Raw gross amounts (verified stored as pre-discount) ---
  const depositRaw = Number(booking.deposit_amount) || 0;
  const serviceChargeTourRaw = Number(booking.service_charge) || 0;
  const insuranceRaw =
    booking.travel_insurance_included && Number(booking.travel_insurance_cost) > 0
      ? Number(booking.travel_insurance_cost)
      : 0;

  // Optionals: subtotal is pure agency amount, service_charge is ToursRed's 5%
  const optionalLines = unpaidOptionals.map((opt: any) => ({
    id: opt.id,
    description: opt.description || (opt.service_kind === 'pickup' ? 'Pick Up' : opt.service_kind === 'language' ? 'Idioma/Intérprete' : 'Servicio opcional'),
    service_kind: opt.service_kind || 'optional_service',
    subtotal: Number(opt.subtotal) || 0,
    service_charge: Number(opt.service_charge) || 0,
  }));

  const optionalsSubtotalTotal = optionalLines.reduce((s: number, o: any) => s + o.subtotal, 0);
  const optionalsServiceChargeTotal = optionalLines.reduce((s: number, o: any) => s + o.service_charge, 0);

  // Combined service charge line: tour's service charge + all optionals' service charges
  const serviceChargeCombinedRaw = serviceChargeTourRaw + optionalsServiceChargeTotal;

  // --- Apply progressive discount in order: deposit → optionals → insurance → service charge ---
  let remainingDiscount = totalDiscount;

  const depositFinal = Math.max(0, Math.round((depositRaw - remainingDiscount) * 100) / 100);
  remainingDiscount = Math.max(0, Math.round((remainingDiscount - depositRaw) * 100) / 100);

  // Optionals: apply discount across all subtotals proportionally is over-complex;
  // apply sequentially per optional for transparency
  const optionalsAfterDiscount = optionalLines.map((o: any) => {
    if (remainingDiscount <= 0) return { ...o, final: o.subtotal };
    const applied = Math.min(o.subtotal, remainingDiscount);
    remainingDiscount = Math.max(0, Math.round((remainingDiscount - applied) * 100) / 100);
    return { ...o, final: Math.max(0, Math.round((o.subtotal - applied) * 100) / 100) };
  });

  const insuranceFinal = Math.max(0, Math.round((insuranceRaw - remainingDiscount) * 100) / 100);
  remainingDiscount = Math.max(0, Math.round((remainingDiscount - insuranceRaw) * 100) / 100);

  const serviceChargeFinal = Math.max(0, Math.round((serviceChargeCombinedRaw - remainingDiscount) * 100) / 100);

  // --- Build line items ---
  const lineItems: any[] = [];

  // 1. Depósito (tour portion) — pure, no service charge mixed in
  if (depositFinal > 0) {
    lineItems.push({
      price_data: {
        currency,
        product_data: { name: description || "Reserva de Tour" },
        unit_amount: Math.round(depositFinal * 100),
      },
      quantity: 1,
      metadata: { type: 'deposit' },
    });
  }

  // 2. Opcionales — pure subtotal per item, no service charge mixed in
  for (const opt of optionalsAfterDiscount) {
    if (opt.final > 0) {
      lineItems.push({
        price_data: {
          currency,
          product_data: { name: opt.description },
          unit_amount: Math.round(opt.final * 100),
        },
        quantity: 1,
        metadata: {
          type: opt.service_kind,
          bos_id: opt.id,
        },
      });
    }
  }

  // 3. Seguro de Viaje — pure insurance amount
  if (insuranceFinal > 0) {
    lineItems.push({
      price_data: {
        currency,
        product_data: { name: "Seguro de Viaje" },
        unit_amount: Math.round(insuranceFinal * 100),
      },
      quantity: 1,
      metadata: { type: 'insurance' },
    });
  }

  // 4. Cargo por Servicio (combined: tour + optionals service charges)
  if (serviceChargeFinal > 0) {
    lineItems.push({
      price_data: {
        currency,
        product_data: { name: "Cargo por Servicio" },
        unit_amount: Math.round(serviceChargeFinal * 100),
      },
      quantity: 1,
      metadata: { type: 'service_charge' },
    });
  }

  // Fallback: if all lines were discounted to 0, create a single zero-amount line
  // to avoid Stripe rejecting an empty line_items array.
  if (lineItems.length === 0) {
    lineItems.push({
      price_data: {
        currency,
        product_data: { name: description || "Reserva de Tour" },
        unit_amount: 0,
      },
      quantity: 1,
    });
  }

  // Aqui vivia un bloque rotulado "Safety" que hacia lo contrario de asegurar:
  // calculaba la diferencia entre el total del servidor y el `amount` que mandaba
  // el cliente, y MOVIA la linea del deposito para que el total fuera el del
  // cliente. Sin tope. Un `amount: 1` sobre un tour de $30,000 se cobraba como $1.
  // La intencion era absorber centavos de redondeo; el efecto era dejar el precio
  // en manos de quien llama. El contraste se hace ahora fuera de esta funcion, en
  // validarMontoDelCliente(), y ya no ajusta nada: si no cuadra, se rechaza.

  return lineItems;
}