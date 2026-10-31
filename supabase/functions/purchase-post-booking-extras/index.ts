import "jsr:@supabase/functions-js@2.112.4/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import Stripe from "npm:stripe@22.3.0";
import { isConfigured as isOpenpayConfigured, getDashboardUrl, getMerchantId, createOrReuseCustomer as createOrReuseOpenpayCustomer, createSpeiCharge, createCashCharge, createCardCheckoutCharge } from "../_shared/openpay.ts";
import { enforceStepUp } from "../_shared/stepUpCheck.ts";
import * as Sentry from "npm:@sentry/deno@9.47.1";
import { origenParaRedirigir } from "../_shared/cors.ts";
import { opcionesConContexto, sinUserAgentDeNavegador } from "../_shared/contextoAuditoria.ts";
import { mensajeDeError } from "../_shared/errores.ts";
import { capturarOrdenPaypal, crearOrdenPaypal } from "../_shared/ordenPaypal.ts";
import { ajustarVencimientoDeApartado, apartarPuntosDeCargo, consumirPuntosDeCargo, expiracionDelCobroConPuntos, expiracionMercadoPago, MINUTOS_APARTADO, MINUTOS_APARTADO_CONEKTA, MINUTOS_APARTADO_OPENPAY, MINUTOS_APARTADO_PAYPAL, puntosDeCargo, puntosGanadosSinPasarela, validarFormaDePuntos, validarPuntos } from "../_shared/puntosConTope.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    release: Deno.env.get("SENTRY_RELEASE"),
    tracesSampleRate: 0.1,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, sinUserAgentDeNavegador(opcionesConContexto(req)));
    const userClient = createClient(supabaseUrl, supabaseAnonKey, opcionesConContexto(req, {
      global: { headers: { Authorization: authHeader } },
    }));

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "No autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      booking_id,
      type, // 'optional_service' | 'insurance'
      tour_optional_service_id,
      quantity,
      payment_method,
      mercadopago_payment_id,
      paypal_order_id,
      conekta_method,        // "card" | "cash" | "spei" | "bnpl"
      bnpl_product_type,     // "aplazo_bnpl" | "creditea_bnpl" | "coppel_bnpl"
      openpay_method,        // "card" | "spei" | "cash"
      insurance_days,
      points_to_use,         // puntos que paga, junto con otro metodo (tope 50%)
      booking_optional_service_id, // al confirmar MercadoPago/PayPal: la fila creada al abrir el cobro
    } = await req.json();

    if (!booking_id || !type || !payment_method) {
      return new Response(JSON.stringify({ error: "booking_id, type y payment_method son requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "optional_service" && (!tour_optional_service_id || !quantity || quantity < 1)) {
      return new Response(JSON.stringify({ error: "tour_optional_service_id y quantity son requeridos para servicios opcionales" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Los puntos ya no pagan solos (tope del 50%, regla de Axel del 16-oct-2026).
    // Se rechaza antes del codigo MFA para no gastarle uno al viajero.
    const formaPuntos = validarFormaDePuntos(payment_method, points_to_use);
    if (!formaPuntos.ok) {
      return new Response(JSON.stringify({ error: formaPuntos.error }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step-up auth: traveler is spending their own wallet/points directly (self-service).
    // Los puntos con tarjeta tambien son gasto de saldo: mismo codigo MFA.
    if (payment_method === "toursred_cash" || payment_method === "points" || formaPuntos.puntos > 0) {
      const stepUpBlock = await enforceStepUp(userClient, supabaseServiceKey, supabaseUrl, user.id);
      if (stepUpBlock) return stepUpBlock;
    }

    const { data: booking } = await supabase
      .from("bookings")
      .select(`
        id, user_id, tour_id, agency_id, status, travelers_count,
        count_adultos, count_ninos, count_infantes, count_adultos_mayores,
        travel_insurance_included, travel_insurance_cost,
        selected_date,
        tours:tour_id(id, start_date, end_date)
      `)
      .eq("id", booking_id)
      .maybeSingle();

    if (!booking) {
      return new Response(JSON.stringify({ error: "Reserva no encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (booking.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (["cancelled", "cancellation_processing", "draft"].includes(booking.status)) {
      return new Response(JSON.stringify({ error: "No se pueden agregar extras a esta reserva" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: platformSettings } = await supabase
      .from("platform_settings")
      .select(`
        service_charge_percentage, agency_commission_percentage, optional_service_commission_percentage,
        travel_insurance_price_per_day_per_traveler,
        paypal_client_id, paypal_sandbox,
        pac_provider
      `)
      .maybeSingle();
    const { data: platformSecrets } = await supabase
      .from("platform_secrets")
      .select("mercadopago_access_token, paypal_client_secret, pac_api_key_encrypted")
      .maybeSingle();

    const serviceChargePct = platformSettings?.service_charge_percentage ?? 5;
    const agencyCommissionPct = platformSettings?.optional_service_commission_percentage ?? 15;

    let bookingOptionalServiceId: string | null = null;
    let itemName = "";
    let subtotal = 0;
    let grossServiceCharge = 0;
    let netServiceCharge = 0;
    let exemptionApplied = 0;
    let totalToPay = 0;
    let agencyCommission = 0;
    let puntosUsados = 0;
    let pesosEnPuntos = 0;

    // Tope del 50% sobre el subtotal del extra. Va antes de insertar la fila del
    // servicio opcional, para no dejar una fila huerfana si se rechaza.
    const rechazoPorTope = (base: number): Response | null => {
      const r = validarPuntos(payment_method, points_to_use, base);
      if (!r.ok) {
        return new Response(JSON.stringify({ error: r.error }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      puntosUsados = r.puntos;
      pesosEnPuntos = r.pesos;
      return null;
    };

    if (type === "optional_service" && booking_optional_service_id && (mercadopago_payment_id || paypal_order_id)) {
      // Confirmacion al regresar de MercadoPago/PayPal (16-oct-2026). La fila del
      // servicio se creo al abrir el cobro, con sus montos. Antes se insertaba
      // OTRA aqui: su id no coincidia con el external_reference del pago, se
      // borraba y el viajero veia un error aunque habia pagado.
      const { data: bosPrevio } = await supabase
        .from("booking_optional_services")
        .select("id, booking_id, subtotal, service_charge, total_paid, membership_exemption_used, agency_commission, paid_at, is_cancelled, tour_optional_services(name)")
        .eq("id", booking_optional_service_id)
        .maybeSingle();
      if (!bosPrevio || bosPrevio.booking_id !== booking_id || bosPrevio.is_cancelled) {
        return new Response(JSON.stringify({ error: "Servicio opcional no encontrado" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (bosPrevio.paid_at) {
        return new Response(JSON.stringify({ success: true, already_paid: true, booking_optional_service_id: bosPrevio.id }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      itemName = (bosPrevio.tour_optional_services as unknown as { name?: string } | null)?.name ?? "Servicio opcional";
      subtotal = Number(bosPrevio.subtotal) || 0;
      netServiceCharge = Number(bosPrevio.service_charge) || 0;
      grossServiceCharge = netServiceCharge;
      exemptionApplied = Number(bosPrevio.membership_exemption_used) || 0;
      agencyCommission = Number(bosPrevio.agency_commission) || 0;
      totalToPay = Number(bosPrevio.total_paid) || parseFloat((subtotal + netServiceCharge).toFixed(2));
      bookingOptionalServiceId = bosPrevio.id;
    } else if (type === "optional_service") {
      const { data: service } = await supabase
        .from("tour_optional_services")
        .select("id, name, price_per_person, max_capacity, is_active, tour_id")
        .eq("id", tour_optional_service_id)
        .maybeSingle();

      if (!service || !service.is_active) {
        return new Response(JSON.stringify({ error: "Servicio opcional no encontrado o inactivo" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (service.tour_id !== booking.tour_id) {
        return new Response(JSON.stringify({ error: "El servicio no pertenece al tour de esta reserva" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (service.max_capacity != null) {
        const { data: usedData } = await supabase
          .from("booking_optional_services")
          .select("quantity")
          .eq("tour_optional_service_id", tour_optional_service_id)
          .eq("is_cancelled", false);
        const used = (usedData || []).reduce((s: number, r: { quantity: number }) => s + Number(r.quantity), 0);
        const available = service.max_capacity - used;
        if (quantity > available) {
          return new Response(JSON.stringify({
            error: `Solo hay ${available} lugar(es) disponibles para este servicio`,
            available_spots: available,
          }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      itemName = service.name;
      subtotal = parseFloat((Number(service.price_per_person) * quantity).toFixed(2));
      const topeOpcional = rechazoPorTope(subtotal);
      if (topeOpcional) return topeOpcional;
      const isWallet = payment_method === "toursred_cash" || payment_method === "points";
      if (isWallet) {
        grossServiceCharge = 0;
        netServiceCharge = 0;
        exemptionApplied = 0;
      } else {
        grossServiceCharge = parseFloat((subtotal * serviceChargePct / 100).toFixed(2));
        const { data: exemptionResult } = await supabase.rpc("apply_membership_service_fee_exemption", { p_user_id: user.id, p_gross_service_charge: grossServiceCharge });
        exemptionApplied = parseFloat(exemptionResult?.exemption_applied ?? "0");
        netServiceCharge = parseFloat(exemptionResult?.net_service_charge ?? grossServiceCharge.toString());
      }
      agencyCommission = parseFloat((subtotal * agencyCommissionPct / 100).toFixed(2));
      totalToPay = parseFloat((subtotal + netServiceCharge).toFixed(2));

      const { data: bosRecord, error: bosError } = await supabase
        .from("booking_optional_services")
        .insert({
          booking_id,
          tour_optional_service_id,
          quantity,
          unit_price: service.price_per_person,
          subtotal,
          service_charge: netServiceCharge,
          total_paid: totalToPay,
          agency_commission: agencyCommission,
          membership_exemption_used: exemptionApplied,
        })
        .select("id")
        .single();

      if (bosError || !bosRecord) {
        return new Response(JSON.stringify({ error: "Error al registrar el servicio", detail: bosError?.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      bookingOptionalServiceId = bosRecord.id;

    } else if (type === "insurance") {
      if (booking.travel_insurance_included) {
        return new Response(JSON.stringify({ error: "El seguro ya fue contratado para esta reserva" }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const pricePerDayPerTraveler = parseFloat(platformSettings?.travel_insurance_price_per_day_per_traveler ?? "79");
      const tourData = booking.tours as unknown as { start_date: string; end_date: string } | null;

      const totalTravelers = Math.max(
        1,
        (booking.travelers_count || 0) ||
        ((booking.count_adultos || 0) + (booking.count_ninos || 0) +
         (booking.count_infantes || 0) + (booking.count_adultos_mayores || 0))
      );

      let tourDays = insurance_days && Number(insurance_days) > 0 ? Math.min(30, Number(insurance_days)) : 0;
      if (!tourDays) {
        const refDate = booking.selected_date || tourData?.start_date;
        const endDate = tourData?.end_date;
        tourDays = 1;
        if (refDate && endDate) {
          const start = new Date(refDate);
          const end = new Date(endDate);
          const diffMs = end.getTime() - start.getTime();
          tourDays = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1);
        }
      }

      const insuranceCost = parseFloat((pricePerDayPerTraveler * tourDays * totalTravelers).toFixed(2));
      itemName = "Seguro de asistencia de viaje";
      subtotal = insuranceCost;
      const topeSeguro = rechazoPorTope(subtotal);
      if (topeSeguro) return topeSeguro;
      const isWallet = payment_method === "toursred_cash" || payment_method === "points";
      if (isWallet) {
        grossServiceCharge = 0;
        netServiceCharge = 0;
        exemptionApplied = 0;
      } else {
        grossServiceCharge = parseFloat((insuranceCost * serviceChargePct / 100).toFixed(2));
        const { data: exemptionResult } = await supabase.rpc("apply_membership_service_fee_exemption", { p_user_id: user.id, p_gross_service_charge: grossServiceCharge });
        exemptionApplied = parseFloat(exemptionResult?.exemption_applied ?? "0");
        netServiceCharge = parseFloat(exemptionResult?.net_service_charge ?? grossServiceCharge.toString());
      }
      totalToPay = parseFloat((insuranceCost + netServiceCharge).toFixed(2));
      agencyCommission = 0;

    } else {
      return new Response(JSON.stringify({ error: "Tipo de extra no válido. Use 'optional_service' o 'insurance'" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const finalizePayment = async (method: string, intentId: string | null) => {
      let pointsEarned = 0;
      const { data: activeMembership } = await supabase
        .from("memberships")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "active")
        .gt("current_period_end", new Date().toISOString())
        .maybeSingle();

      if (activeMembership) {
        // Doble solo con ToursRed Cash: lo pagado con puntos da puntos sencillos
        // (regla de Axel, 16-oct-2026; los puntos no son monedero).
        pointsEarned = payment_method === "toursred_cash" ? puntosGanadosSinPasarela(subtotal, pesosEnPuntos) : Math.floor(subtotal);
        if (pointsEarned > 0) {
          const { data: walletId } = await supabase.rpc("get_or_create_points_wallet", { p_user_id: user.id });
          if (walletId) {
            const { data: pWallet } = await supabase
              .from("toursred_points_wallets")
              .select("id, balance, total_earned")
              .eq("id", walletId)
              .maybeSingle();
            if (pWallet) {
              const newBalance = pWallet.balance + pointsEarned;
              await supabase.from("toursred_points_transactions").insert({
                wallet_id: walletId,
                user_id: user.id,
                amount: pointsEarned,
                balance_after: newBalance,
                type: "earned",
                description: `Puntos por extra: ${itemName}`,
                reference_id: bookingOptionalServiceId || booking_id,
                reference_type: type === "optional_service" ? "optional_service_payment" : "insurance_payment",
                expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
              });
              await supabase.from("toursred_points_wallets").update({
                balance: newBalance,
                total_earned: pWallet.total_earned + pointsEarned,
              }).eq("id", walletId);
            }
          }
        }
      }

      if (type === "insurance") {
        const insuranceUpdate: Record<string, unknown> = {
          travel_insurance_included: true,
          travel_insurance_cost: subtotal,
          updated_at: new Date().toISOString(),
        };
        if (insurance_days && Number(insurance_days) > 0) {
          insuranceUpdate.insurance_days = Math.min(30, Number(insurance_days));
        }
        // El seguro comprado despues no tiene fila propia: lo que se pago con
        // saldo queda en la reserva para que su poliza no lo cargue a Bancos.
        if (method === "toursred_cash") {
          insuranceUpdate.travel_insurance_points_used = puntosUsados;
          insuranceUpdate.travel_insurance_cash_used = parseFloat((totalToPay - pesosEnPuntos).toFixed(2));
        }
        await supabase.from("bookings").update(insuranceUpdate).eq("id", booking_id);
      }

      EdgeRuntime.waitUntil(
        fetch(`${supabaseUrl}/functions/v1/send-extras-purchase-notification`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
          body: JSON.stringify({
            booking_id,
            extra_type: type,
            bos_id: bookingOptionalServiceId,
          }),
        }).catch((e) => console.error("send-extras-purchase-notification error:", e))
      );

      const cfdiFunction = type === "optional_service"
        ? "generate-optional-service-cfdi"
        : "generate-post-booking-insurance-cfdi";

      // points_used va en el body porque el CFDI se dispara antes de que la fila
      // del extra guarde sus puntos (mas abajo): leerlo de la base daria cero.
      const cfdiBody = type === "optional_service"
        ? { booking_optional_service_id: bookingOptionalServiceId, service_charge: netServiceCharge, total_paid: totalToPay, payment_method: method, points_used: puntosUsados }
        : { booking_id, service_charge: netServiceCharge, total_paid: totalToPay, payment_method: method, points_used: puntosUsados };

      if (platformSettings?.pac_provider && platformSettings.pac_provider !== "none") {
        EdgeRuntime.waitUntil(
          fetch(`${supabaseUrl}/functions/v1/${cfdiFunction}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
            body: JSON.stringify(cfdiBody),
          }).catch((e) => console.error(`${cfdiFunction} error:`, e))
        );
      }

      if (bookingOptionalServiceId) {
        await supabase.from("booking_optional_services")
          .update({ paid_at: new Date().toISOString(), payment_method: method, points_used: puntosUsados })
          .eq("id", bookingOptionalServiceId);
      }

      const extraChargeContext = type === "insurance" ? "insurance" : "optional_service";
      const extraRefId = bookingOptionalServiceId || booking_id;
      if (method === "stripe" && intentId) {
        const { data: existingExtraTx } = await supabase
          .from("payment_transactions")
          .select("id")
          .eq("stripe_payment_intent_id", intentId)
          .maybeSingle();
        if (!existingExtraTx) {
          await supabase.from("payment_transactions").insert({
            booking_id,
            stripe_payment_intent_id: intentId,
            amount: parseFloat((totalToPay - pesosEnPuntos).toFixed(2)),
            currency: "mxn",
            status: "succeeded",
            payment_processor: "stripe",
            processor_fee: 0,
            net_amount: parseFloat((totalToPay - pesosEnPuntos).toFixed(2)),
            charge_context: extraChargeContext,
            charge_reference_id: extraRefId,
          });
        }
      } else if (method === "mercadopago" && intentId) {
        const { data: existingExtraTx } = await supabase
          .from("payment_transactions")
          .select("id")
          .eq("mercadopago_payment_id", intentId)
          .maybeSingle();
        if (!existingExtraTx) {
          await supabase.from("payment_transactions").insert({
            booking_id,
            mercadopago_payment_id: intentId,
            amount: parseFloat((totalToPay - pesosEnPuntos).toFixed(2)),
            currency: "mxn",
            status: "succeeded",
            payment_processor: "mercadopago",
            processor_fee: 0,
            net_amount: parseFloat((totalToPay - pesosEnPuntos).toFixed(2)),
            charge_context: extraChargeContext,
            charge_reference_id: extraRefId,
          });
        }
      } else if (method === "paypal" && intentId) {
        const { data: existingExtraTx } = await supabase
          .from("payment_transactions")
          .select("id")
          .eq("paypal_capture_id", intentId)
          .maybeSingle();
        if (!existingExtraTx) {
          await supabase.from("payment_transactions").insert({
            booking_id,
            paypal_capture_id: intentId,
            amount: parseFloat((totalToPay - pesosEnPuntos).toFixed(2)),
            currency: "mxn",
            status: "succeeded",
            payment_processor: "paypal",
            processor_fee: 0,
            net_amount: parseFloat((totalToPay - pesosEnPuntos).toFixed(2)),
            charge_context: extraChargeContext,
            charge_reference_id: extraRefId,
          });
        }
      }

      return pointsEarned;
    };

    // Lo que cobra la pasarela: el total menos lo que pagan los puntos.
    const montoPasarela = parseFloat((totalToPay - pesosEnPuntos).toFixed(2));

    if (payment_method === "toursred_cash") {
      // Lo que no cubren los puntos sale del Cash. Los puntos ya pasaron el tope.
      const cashACobrar = parseFloat((totalToPay - pesosEnPuntos).toFixed(2));
      const borrarFilaPendiente = async () => {
        if (bookingOptionalServiceId) {
          await supabase.from("booking_optional_services").delete().eq("id", bookingOptionalServiceId);
        }
      };

      const { data: wallet } = await supabase
        .from("toursred_cash_wallets")
        .select("id, balance")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      const walletBalance = Number(wallet?.balance ?? 0);
      if (walletBalance < cashACobrar) {
        await borrarFilaPendiente();
        return new Response(JSON.stringify({
          error: `Saldo insuficiente. Tienes $${walletBalance.toFixed(2)} y necesitas $${cashACobrar.toFixed(2)}`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (puntosUsados > 0) {
        const { data: pWallet } = await supabase
          .from("toursred_points_wallets")
          .select("balance")
          .eq("user_id", user.id)
          .maybeSingle();
        const pointsBalance = Number(pWallet?.balance ?? 0);
        if (pointsBalance < puntosUsados) {
          await borrarFilaPendiente();
          return new Response(JSON.stringify({
            error: `Puntos insuficientes. Tienes ${pointsBalance} puntos y quieres usar ${puntosUsados}`,
          }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      // Puntos y Cash en UNA transaccion: si uno falla, no se cobra ninguno.
      const { error: walletError } = await supabase.rpc("cobrar_saldo_y_puntos", {
        p_user_id: user.id,
        p_cash: cashACobrar,
        p_points: puntosUsados,
        p_reference_id: bookingOptionalServiceId || booking_id,
        p_reference_type: type === "optional_service" ? "optional_service_payment" : "insurance_payment",
        p_description: `${type === "insurance" ? "Seguro de viaje" : `Servicio extra: ${itemName}`} - Reserva ${booking_id.slice(0, 8).toUpperCase()}`,
        p_idempotency_key: `${bookingOptionalServiceId || booking_id}_charge`,
      });

      if (walletError) {
        await borrarFilaPendiente();
        return new Response(JSON.stringify({ error: "Error al procesar el pago con ToursRed Cash" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const pointsEarned = await finalizePayment("toursred_cash", null);

      // Los cobros con saldo no pasan por ningun webhook, que es donde se crea la
      // poliza de los cobros con pasarela: sin esto, ninguno tenia asiento.
      const { error: asientoError } = type === "optional_service"
        ? await supabase.rpc("create_accounting_entry_for_optional_service", { p_bos_id: bookingOptionalServiceId })
        : await supabase.rpc("create_accounting_entry_for_insurance_purchase", { p_booking_id: booking_id });
      if (asientoError) console.error("Error creando poliza del extra (Cash):", asientoError.message);

      const detallePuntos = puntosUsados > 0 ? ` y ${puntosUsados.toLocaleString("es-MX")} puntos` : "";
      return new Response(JSON.stringify({
        success: true, total_charged: totalToPay, cash_charged: cashACobrar,
        points_used: puntosUsados, points_earned: pointsEarned,
        booking_optional_service_id: bookingOptionalServiceId,
        message: `Pago completado. Se descontaron $${cashACobrar.toFixed(2)} de tu ToursRed Cash${detallePuntos}.`,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (payment_method === "stripe") {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
      if (!stripeKey) {
        if (bookingOptionalServiceId) await supabase.from("booking_optional_services").delete().eq("id", bookingOptionalServiceId);
        return new Response(JSON.stringify({ error: "Stripe no configurado" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
      const origin = origenParaRedirigir(req);

      const successUrl = type === "insurance"
        ? `${origin}/extras-success?type=insurance&booking_id=${booking_id}`
        : `${origin}/extras-success?type=optional_service&bos_id=${bookingOptionalServiceId}&booking_id=${booking_id}`;

      // Puntos + tarjeta (16-oct-2026): los puntos se apartan ANTES de abrir el
      // cobro y la tarjeta cobra el resto. stripe-webhook los consume al
      // confirmar; si la sesion expira sin pagarse, el cron los libera.
      const montoTarjeta = parseFloat((totalToPay - pesosEnPuntos).toFixed(2));
      let apartadoId: string | null = null;
      if (puntosUsados > 0) {
        const apartado = await apartarPuntosDeCargo(
          supabase, user.id,
          type === "insurance" ? "insurance" : "optional_service",
          type === "insurance" ? booking_id : bookingOptionalServiceId!,
          puntosUsados,
        );
        if (!apartado.ok) {
          if (bookingOptionalServiceId) await supabase.from("booking_optional_services").delete().eq("id", bookingOptionalServiceId);
          return new Response(JSON.stringify({ error: apartado.error }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        apartadoId = apartado.id;
      }

      let session;
      try {
        session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          line_items: [{
            price_data: {
              currency: "mxn",
              product_data: { name: itemName },
              unit_amount: Math.round(montoTarjeta * 100),
            },
            quantity: 1,
          }],
          // Con puntos apartados, el cobro expira antes que el apartado.
          ...(apartadoId ? { expires_at: expiracionDelCobroConPuntos() } : {}),
          metadata: {
            booking_id,
            booking_optional_service_id: bookingOptionalServiceId || "",
            extra_type: type,
            payment_for: "post_booking_extra",
            user_id: user.id,
            points_used: String(puntosUsados),
          },
          success_url: successUrl,
          cancel_url: `${origin}/traveler/bookings`,
        });
      } catch (stripeErr) {
        if (apartadoId) await supabase.rpc("liberar_puntos_de_cargo", { p_apartado_id: apartadoId });
        throw stripeErr;
      }

      return new Response(JSON.stringify({
        success: true, url: session.url,
        booking_optional_service_id: bookingOptionalServiceId,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (payment_method === "mercadopago") {
      const mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") || platformSecrets?.mercadopago_access_token;
      if (!mpAccessToken) {
        if (bookingOptionalServiceId) await supabase.from("booking_optional_services").delete().eq("id", bookingOptionalServiceId);
        return new Response(JSON.stringify({ error: "MercadoPago no configurado" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const origin = origenParaRedirigir(req);
      const notificationUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/mercadopago-webhook`;
      const extraChargeContext = type === "insurance" ? "insurance" : "optional_service";
      const extraRefId = bookingOptionalServiceId || booking_id;

      // (a) Crear la preferencia.
      if (!mercadopago_payment_id) {
        let apartadoId: string | null = null;
        if (puntosUsados > 0) {
          const apartado = await apartarPuntosDeCargo(supabase, user.id, type === "insurance" ? "insurance" : "optional_service", type === "insurance" ? booking_id : bookingOptionalServiceId!, puntosUsados, MINUTOS_APARTADO);
          if (!apartado.ok) {
            if (bookingOptionalServiceId) await supabase.from("booking_optional_services").delete().eq("id", bookingOptionalServiceId);
            return new Response(JSON.stringify({ error: apartado.error }), {
              status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          apartadoId = apartado.id;
        }

        // extra_type y bos_id: PaymentReturnPage los necesita para confirmar
        // (antes faltaban y el regreso no sabia que extra era).
        const retorno = `${origin}/payment-return?provider=mercadopago&booking_id=${booking_id}&extra_type=${type}&bos_id=${bookingOptionalServiceId || ""}&context=${extraChargeContext}`;
        const preferencePayload = {
          items: [{
            title: itemName,
            unit_price: montoPasarela,
            quantity: 1,
            currency_id: "MXN",
          }],
          external_reference: extraRefId,
          notification_url: notificationUrl,
          back_urls: {
            success: `${retorno}&status=success`,
            failure: `${retorno}&status=failure`,
            pending: `${retorno}&status=pending`,
          },
          auto_return: "approved",
          payment_methods: { excluded_payment_types: [{ id: "ticket" }] },
          ...(apartadoId ? { expires: true, expiration_date_to: expiracionMercadoPago() } : {}),
          metadata: { booking_id, booking_optional_service_id: bookingOptionalServiceId || "", extra_type: type, payment_for: "post_booking_extra", user_id: user.id, points_used: puntosUsados },
        };

        const prefResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${mpAccessToken}` },
          body: JSON.stringify(preferencePayload),
        });
        const prefData = await prefResponse.json();
        if (!prefResponse.ok) {
          if (apartadoId) await supabase.rpc("liberar_puntos_de_cargo", { p_apartado_id: apartadoId });
            if (bookingOptionalServiceId) await supabase.from("booking_optional_services").delete().eq("id", bookingOptionalServiceId);
          return new Response(JSON.stringify({ error: prefData.message || "Error al crear preferencia de MercadoPago" }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ success: true, url: prefData.init_point, booking_optional_service_id: bookingOptionalServiceId }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // (b) Confirmar el pago al regresar.
      const verifyResponse = await fetch(`https://api.mercadopago.com/v1/payments/${mercadopago_payment_id}`, {
        headers: { Authorization: `Bearer ${mpAccessToken}` },
      });
      const mpPayment = await verifyResponse.json();
      if (!verifyResponse.ok || mpPayment.status !== "approved") {
        return new Response(JSON.stringify({
          error: "El pago no fue aprobado por MercadoPago",
          mp_status: mpPayment.status,
          status_detail: mpPayment.status_detail,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (mpPayment.external_reference !== extraRefId) {
        return new Response(JSON.stringify({ error: "La referencia externa del pago no coincide" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const puntosApartadosMp = await puntosDeCargo(supabase, type === "insurance" ? "insurance" : "optional_service", type === "insurance" ? booking_id : bookingOptionalServiceId!);
      const esperadoMp = parseFloat((totalToPay - puntosApartadosMp / 100).toFixed(2));
      const mpAmount = parseFloat(mpPayment.transaction_amount || "0");
      if (Math.abs(mpAmount - esperadoMp) > 0.50) {
        return new Response(JSON.stringify({
          error: `El monto del pago (${mpAmount}) no coincide con el esperado (${esperadoMp})`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      puntosUsados = await consumirPuntosDeCargo(supabase, type === "insurance" ? "insurance" : "optional_service", type === "insurance" ? booking_id : bookingOptionalServiceId!);
      pesosEnPuntos = puntosUsados / 100;
      const pointsEarned = await finalizePayment("mercadopago", String(mercadopago_payment_id));
      return new Response(JSON.stringify({
        success: true, total_charged: esperadoMp, points_used: puntosUsados, points_earned: pointsEarned,
        booking_optional_service_id: bookingOptionalServiceId,
        message: "Pago con MercadoPago completado.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (payment_method === "paypal") {
      const paypalClientId = Deno.env.get("PAYPAL_CLIENT_ID") || platformSettings?.paypal_client_id;
      const paypalClientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET") || platformSecrets?.paypal_client_secret;
      if (!paypalClientId || !paypalClientSecret) {
        if (bookingOptionalServiceId) await supabase.from("booking_optional_services").delete().eq("id", bookingOptionalServiceId);
        return new Response(JSON.stringify({ error: "PayPal no configurado" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const credPaypal = { clientId: paypalClientId, clientSecret: paypalClientSecret, sandbox: platformSettings?.paypal_sandbox ?? true };

      // (a) Crear el pedido (16-oct-2026: antes lo creaba create-paypal-order,
      // que para un servicio opcional buscaba una fila que todavia no existia y
      // respondia 409).
      if (!paypal_order_id) {
        let apartadoId: string | null = null;
        if (puntosUsados > 0) {
          const apartado = await apartarPuntosDeCargo(supabase, user.id, type === "insurance" ? "insurance" : "optional_service", type === "insurance" ? booking_id : bookingOptionalServiceId!, puntosUsados, MINUTOS_APARTADO_PAYPAL);
          if (!apartado.ok) {
            if (bookingOptionalServiceId) await supabase.from("booking_optional_services").delete().eq("id", bookingOptionalServiceId);
            return new Response(JSON.stringify({ error: apartado.error }), {
              status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          apartadoId = apartado.id;
        }
        const origin = origenParaRedirigir(req);
        try {
          const orden = await crearOrdenPaypal(credPaypal, {
            monto: montoPasarela,
            descripcion: type === "insurance" ? "Seguro de viaje" : `Servicio: ${itemName}`,
            referencia: bookingOptionalServiceId || booking_id,
            returnUrl: `${origin}/payment-return?provider=paypal&booking_id=${booking_id}&extra_type=${type}&bos_id=${bookingOptionalServiceId || ""}&tr_status=success`,
            cancelUrl: `${origin}/traveler/bookings`,
            requestId: `extra_${bookingOptionalServiceId || booking_id}_${Date.now()}`,
          });
          return new Response(JSON.stringify({ success: true, url: orden.url, order_id: orden.id, booking_optional_service_id: bookingOptionalServiceId }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (ppErr) {
          if (apartadoId) await supabase.rpc("liberar_puntos_de_cargo", { p_apartado_id: apartadoId });
            if (bookingOptionalServiceId) await supabase.from("booking_optional_services").delete().eq("id", bookingOptionalServiceId);
          console.error("PayPal (extra):", ppErr);
          return new Response(JSON.stringify({ error: "Error al crear la orden de PayPal" }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // (b) Capturar al regresar.
      const captura = await capturarOrdenPaypal(credPaypal, paypal_order_id);
      if (!captura.ok) {
        return new Response(JSON.stringify({ error: "Error al capturar el pago PayPal" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const puntosApartadosPp = await puntosDeCargo(supabase, type === "insurance" ? "insurance" : "optional_service", type === "insurance" ? booking_id : bookingOptionalServiceId!);
      const esperadoPp = parseFloat((totalToPay - puntosApartadosPp / 100).toFixed(2));
      if (Math.abs(captura.monto - esperadoPp) > 0.5) {
        return new Response(JSON.stringify({
          error: `El monto capturado (${captura.monto}) no coincide con el esperado (${esperadoPp})`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      puntosUsados = await consumirPuntosDeCargo(supabase, type === "insurance" ? "insurance" : "optional_service", type === "insurance" ? booking_id : bookingOptionalServiceId!);
      pesosEnPuntos = puntosUsados / 100;
      const pointsEarned = await finalizePayment("paypal", captura.capturaId);
      return new Response(JSON.stringify({
        success: true, total_charged: esperadoPp, points_used: puntosUsados, points_earned: pointsEarned,
        booking_optional_service_id: bookingOptionalServiceId,
        message: "Pago con PayPal completado.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (payment_method === "conekta") {
      if (!conekta_method || !["card", "cash", "spei", "bnpl"].includes(conekta_method)) {
        if (bookingOptionalServiceId) await supabase.from("booking_optional_services").delete().eq("id", bookingOptionalServiceId);
        return new Response(JSON.stringify({ error: "conekta_method es requerido y debe ser card, cash, spei o bnpl" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (conekta_method === "bnpl") {
        if (!bnpl_product_type || !["aplazo_bnpl", "creditea_bnpl", "coppel_bnpl"].includes(bnpl_product_type)) {
          if (bookingOptionalServiceId) await supabase.from("booking_optional_services").delete().eq("id", bookingOptionalServiceId);
          return new Response(JSON.stringify({ error: "bnpl_product_type es requerido y debe ser aplazo_bnpl, creditea_bnpl o coppel_bnpl" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (montoPasarela < 1200 || montoPasarela > 16000) {
          if (bookingOptionalServiceId) await supabase.from("booking_optional_services").delete().eq("id", bookingOptionalServiceId);
          return new Response(JSON.stringify({ error: "El monto para BNPL debe estar entre $1,200 y $16,000 MXN" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const conektaPrivateKey = Deno.env.get("CONEKTA_PRIVATE_KEY");
      if (!conektaPrivateKey) {
        if (bookingOptionalServiceId) await supabase.from("booking_optional_services").delete().eq("id", bookingOptionalServiceId);
        return new Response(JSON.stringify({ error: "Conekta no configurado" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: userProfileConekta } = await supabase
        .from("users").select("first_name, last_name").eq("id", user.id).maybeSingle();
      const conektaCustomerName = `${userProfileConekta?.first_name || ""} ${userProfileConekta?.last_name || ""}`.trim() || "Cliente";

      const origin = origenParaRedirigir(req);
      const extraChargeContext = type === "insurance" ? "insurance" : "optional_service";
      const extraRefId = bookingOptionalServiceId || booking_id;
      const successUrl = `${origin}/payment-return?provider=conekta&booking_id=${booking_id}&status=success&context=${extraChargeContext}`;
      const failureUrl = `${origin}/payment-return?provider=conekta&booking_id=${booking_id}&status=failure&context=${extraChargeContext}`;
      const cancelUrl = `${origin}/payment-return?provider=conekta&booking_id=${booking_id}&status=cancel&context=${extraChargeContext}`;
      const amountInCents = Math.round(montoPasarela * 100);

      const orderPayload: Record<string, unknown> = {
        currency: "MXN",
        amount: amountInCents,
        customer_info: { name: conektaCustomerName, email: user.email || "no-email@toursred.com" },
        line_items: [{
          name: itemName, unit_price: amountInCents, quantity: 1,
          ...(conekta_method === "bnpl" ? { tags: ["bnpl"] } : {}),
        }],
        checkout: {
          type: "HostedPayment",
          allowed_payment_methods: [conekta_method === "spei" ? "bank_transfer" : conekta_method],
          success_url: successUrl, failure_url: failureUrl, cancel_url: cancelUrl,
          expires_at: Math.floor(Date.now() / 1000) + 71 * 3600,
        },
        metadata: {
          points_used: String(puntosUsados),
          booking_id, payment_method_type: conekta_method, context: extraChargeContext,
          charge_reference_id: extraRefId,
          extra_subtotal: subtotal.toString(),
          ...(type === "insurance" && insurance_days ? { insurance_days: String(Math.min(30, Number(insurance_days))) } : {}),
          ...(conekta_method === "bnpl" ? { bnpl_product_type } : {}),
        },
      };

      // Puntos + Conekta (16-oct-2026): los puntos se apartan ANTES de crear el
      // cobro y el procesador cobra el resto (montoPasarela). El webhook los
      // consume al confirmar; si el cobro vence sin pagarse, el cron los libera.
      let apartadoId: string | null = null;
      if (puntosUsados > 0) {
        const apartado = await apartarPuntosDeCargo(supabase, user.id, type === "insurance" ? "insurance" : "optional_service", type === "insurance" ? booking_id : bookingOptionalServiceId!, puntosUsados, MINUTOS_APARTADO_CONEKTA);
        if (!apartado.ok) {
          if (bookingOptionalServiceId) await supabase.from("booking_optional_services").delete().eq("id", bookingOptionalServiceId);
          return new Response(JSON.stringify({ error: apartado.error }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        apartadoId = apartado.id;
      }

      const conektaApiBase = Deno.env.get("CONEKTA_API_BASE") || "https://api.conekta.io";
      const apiResponse = await fetch(`${conektaApiBase}/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/vnd.conekta-v2.2.0+json",
          "Authorization": `Bearer ${conektaPrivateKey}`,
          "X-Conekta-Client-Info": '{"name":"toursred","version":"1.0.0"}',
        },
        body: JSON.stringify(orderPayload),
      });

      if (!apiResponse.ok) {
        if (apartadoId) await supabase.rpc("liberar_puntos_de_cargo", { p_apartado_id: apartadoId });
        if (bookingOptionalServiceId) await supabase.from("booking_optional_services").delete().eq("id", bookingOptionalServiceId);
        const errorBody = await apiResponse.text();
        console.error("Conekta API error (post-booking extra):", errorBody);
        let errorMsg = "Error al crear orden de Conekta";
        try { const parsed = JSON.parse(errorBody); errorMsg = parsed?.details?.[0]?.message || parsed?.message || errorMsg; } catch { /* cuerpo no-JSON, se queda el mensaje generico */ }
        return new Response(JSON.stringify({ error: errorMsg }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const order = await apiResponse.json();
      const orderId = order.id;
      const checkoutUrl = order.checkout?.url;

      if (!orderId) {
        if (apartadoId) await supabase.rpc("liberar_puntos_de_cargo", { p_apartado_id: apartadoId });
        if (bookingOptionalServiceId) await supabase.from("booking_optional_services").delete().eq("id", bookingOptionalServiceId);
        return new Response(JSON.stringify({ error: "Respuesta inválida de Conekta" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const idempotencyKey = `${extraRefId}_${extraChargeContext}_${Date.now()}`;
      await supabase.from("payment_transactions").insert({
        booking_id, amount: montoPasarela, currency: "mxn", status: "pending",
        payment_method_type: conekta_method, payment_processor: "conekta", processor_fee: 0,
        net_amount: montoPasarela, conekta_order_id: orderId,
        bnpl_product_type: conekta_method === "bnpl" ? bnpl_product_type : null,
        p_idempotency_key: idempotencyKey, charge_context: extraChargeContext,
        charge_reference_id: extraRefId,
        metadata: { conekta_order: order, checkout_url: checkoutUrl, subtotal },
      });

      return new Response(JSON.stringify({
        success: true, url: checkoutUrl, order_id: orderId,
        booking_optional_service_id: bookingOptionalServiceId,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (payment_method === "openpay") {
      if (!openpay_method || !["card", "spei", "cash"].includes(openpay_method)) {
        if (bookingOptionalServiceId) await supabase.from("booking_optional_services").delete().eq("id", bookingOptionalServiceId);
        return new Response(JSON.stringify({ error: "openpay_method es requerido y debe ser card, spei o cash" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!isOpenpayConfigured()) {
        if (bookingOptionalServiceId) await supabase.from("booking_optional_services").delete().eq("id", bookingOptionalServiceId);
        return new Response(JSON.stringify({ error: "Openpay no está configurado" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: userRecordOp } = await supabase
        .from("users").select("id, first_name, last_name, email, phone_number").eq("id", user.id).maybeSingle();

      let customerIdOp: string;
      try {
        customerIdOp = await createOrReuseOpenpayCustomer(supabase, user.id, {
          first_name: userRecordOp?.first_name, last_name: userRecordOp?.last_name,
          email: userRecordOp?.email || user.email || "", phone_number: userRecordOp?.phone_number,
        });
      } catch (e) {
        if (bookingOptionalServiceId) await supabase.from("booking_optional_services").delete().eq("id", bookingOptionalServiceId);
        return new Response(JSON.stringify({ error: mensajeDeError(e) }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const origin = origenParaRedirigir(req);
      const extraChargeContext = type === "insurance" ? "insurance" : "optional_service";
      const extraRefId = bookingOptionalServiceId || booking_id;
      const successUrlOp = `${origin}/payment-pending/${extraRefId}?context=${extraChargeContext}`;
      const orderIdOp = `${extraChargeContext}_${extraRefId}_${Date.now()}`;
      const roundedAmt = Math.round(montoPasarela * 100) / 100;

      // Puntos + OpenPay (16-oct-2026): los puntos se apartan ANTES de crear el
      // cobro y el procesador cobra el resto (montoPasarela). El webhook los
      // consume al confirmar; si el cobro vence sin pagarse, el cron los libera.
      let apartadoId: string | null = null;
      if (puntosUsados > 0) {
        const apartado = await apartarPuntosDeCargo(supabase, user.id, type === "insurance" ? "insurance" : "optional_service", type === "insurance" ? booking_id : bookingOptionalServiceId!, puntosUsados, MINUTOS_APARTADO_OPENPAY);
        if (!apartado.ok) {
          if (bookingOptionalServiceId) await supabase.from("booking_optional_services").delete().eq("id", bookingOptionalServiceId);
          return new Response(JSON.stringify({ error: apartado.error }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        apartadoId = apartado.id;
      }

      let chargeOp;
      try {
        if (openpay_method === "spei") {
          chargeOp = await createSpeiCharge(customerIdOp, roundedAmt, orderIdOp, itemName);
        } else if (openpay_method === "cash") {
          chargeOp = await createCashCharge(customerIdOp, roundedAmt, orderIdOp, itemName);
        } else {
          chargeOp = await createCardCheckoutCharge(customerIdOp, roundedAmt, orderIdOp, itemName, successUrlOp, {
            charge_context: extraChargeContext, charge_reference_id: extraRefId,
          });
        }
      } catch (e) {
        if (apartadoId) await supabase.rpc("liberar_puntos_de_cargo", { p_apartado_id: apartadoId });
        if (bookingOptionalServiceId) await supabase.from("booking_optional_services").delete().eq("id", bookingOptionalServiceId);
        return new Response(JSON.stringify({ error: mensajeDeError(e) }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Efectivo y SPEI se pagan despues: el apartado vence despues de su fecha limite.
      if (apartadoId) await ajustarVencimientoDeApartado(supabase, apartadoId, chargeOp.due_date);

      const paymentMethodMetadataOp: Record<string, unknown> = {
        openpay_method, openpay_charge_id: chargeOp.id, openpay_status: chargeOp.status,
      };
      if (openpay_method === "spei") {
        if (chargeOp.payment_method?.clabe) paymentMethodMetadataOp.clabe = chargeOp.payment_method.clabe;
        if (chargeOp.payment_method?.bank) paymentMethodMetadataOp.bank = chargeOp.payment_method.bank;
        if (chargeOp.payment_method?.name) paymentMethodMetadataOp.reference = chargeOp.payment_method.name;
        paymentMethodMetadataOp.spei_pdf_url = `${getDashboardUrl()}/spei-pdf/${getMerchantId()}/${chargeOp.id}`;
      } else if (openpay_method === "cash") {
        if (chargeOp.payment_method?.reference) paymentMethodMetadataOp.reference = chargeOp.payment_method.reference;
        if (chargeOp.due_date) paymentMethodMetadataOp.expiry_date = chargeOp.due_date;
        if (chargeOp.payment_method?.barcode_url) paymentMethodMetadataOp.barcode_url = chargeOp.payment_method.barcode_url;
        if (chargeOp.payment_method?.reference) paymentMethodMetadataOp.cash_pdf_url = `${getDashboardUrl()}/paynet-pdf/${getMerchantId()}/${chargeOp.payment_method.reference}`;
      }

      await supabase.from("payment_transactions").insert({
        booking_id, amount: montoPasarela, currency: "mxn", status: "pending",
        payment_method_type: openpay_method, payment_processor: "openpay",
        processor_fee: 0, net_amount: montoPasarela, openpay_charge_id: chargeOp.id,
        charge_context: extraChargeContext, charge_reference_id: extraRefId,
        metadata: { ...paymentMethodMetadataOp, subtotal },
      });

      const checkoutUrlOp = chargeOp.payment_method?.url;
      return new Response(JSON.stringify({
        success: true,
        url: openpay_method === "card" ? checkoutUrlOp : undefined,
        payment_method: openpay_method !== "card" ? chargeOp.payment_method : undefined,
        booking_optional_service_id: bookingOptionalServiceId,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (bookingOptionalServiceId) await supabase.from("booking_optional_services").delete().eq("id", bookingOptionalServiceId);
    return new Response(JSON.stringify({ error: `Método de pago no soportado: ${payment_method}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    if (sentryDsn) {
      Sentry.captureException(err, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
