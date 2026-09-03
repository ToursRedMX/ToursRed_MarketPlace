import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@22.3.0";
import { enforceStepUp } from "../_shared/stepUpCheck.ts";
import * as Sentry from "npm:@sentry/deno@9";

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

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "No autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      booking_supplement_id,
      payment_method,
      stripe_payment_intent_id,
      mercadopago_payment_id,
      paypal_order_id,
      conekta_method,
      bnpl_product_type,
      openpay_method,   // "card" | "spei" | "cash"
    } = await req.json();

    if (!booking_supplement_id || !payment_method) {
      return new Response(JSON.stringify({ error: "booking_supplement_id y payment_method son requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step-up auth: traveler is spending their own wallet/points directly (self-service).
    // Only enforce for wallet/points methods — card/redirect processors already require
    // the traveler to authenticate with their bank/card issuer.
    if (payment_method === "toursred_cash" || payment_method === "points") {
      const stepUpBlock = await enforceStepUp(userClient, supabaseServiceKey, supabaseUrl, user.id);
      if (stepUpBlock) return stepUpBlock;
    }

    // Load supplement request with full context
    const { data: suppReq } = await supabase
      .from("booking_supplements")
      .select(`
        id, booking_id, status, quantity, unit_price, service_charge,
        membership_exemption_used, supplement_commission, total_paid, expires_at,
        tour_supplements!inner(id, name, tour_id),
        bookings!inner(id, user_id, status)
      `)
      .eq("id", booking_supplement_id)
      .maybeSingle();

    if (!suppReq) {
      return new Response(JSON.stringify({ error: "Solicitud de suplemento no encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if ((suppReq.bookings as any)?.status === "cancellation_processing") {
      return new Response(JSON.stringify({ error: "La reserva está en proceso de cancelación" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if ((suppReq.bookings as any).user_id !== user.id) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (["pending_payment", "approved"].includes(suppReq.status) === false) {
      if (suppReq.status === "paid") {
        const { data: existingCfdi } = await supabase
          .from("cfdi_invoices")
          .select("id")
          .eq("booking_supplement_id", booking_supplement_id)
          .eq("invoice_type", "supplement")
          .maybeSingle();

        if (!existingCfdi) {
          const { data: cfdiSettings } = await supabase
            .from("platform_settings")
            .select("pac_provider")
            .maybeSingle();
          const { data: secrets } = await supabase
            .from("platform_secrets")
            .select("pac_api_key_encrypted")
            .maybeSingle();
          if (cfdiSettings?.pac_provider && cfdiSettings.pac_provider !== "none" && secrets?.pac_api_key_encrypted) {
            try {
              await fetch(`${supabaseUrl}/functions/v1/generate-supplement-cfdi`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
                body: JSON.stringify({ booking_supplement_id, payment_form: '04' }),
              });
            } catch (_) { /* non-fatal */ }
          }
        }

        return new Response(JSON.stringify({ success: true, already_paid: true }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `Estado inválido para pago: ${suppReq.status}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (suppReq.status === "approved" && suppReq.expires_at && new Date(suppReq.expires_at) < new Date()) {
      await supabase.from("booking_supplements").update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: "expiry",
        updated_at: new Date().toISOString(),
      }).eq("id", booking_supplement_id);
      return new Response(JSON.stringify({ error: "El tiempo para pagar expiró. Solicita el suplemento de nuevo." }), {
        status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: platformSettings } = await supabase
      .from("platform_settings")
      .select("service_charge_percentage, supplement_commission_percentage, mercadopago_access_token, paypal_client_id, paypal_client_secret, paypal_sandbox")
      .maybeSingle();

    const serviceChargePct = platformSettings?.service_charge_percentage ?? 5;
    const supplementCommissionPct = platformSettings?.supplement_commission_percentage ?? 10;
    const subtotal = Number(suppReq.unit_price) * suppReq.quantity;
    const isWalletPayment = payment_method === "toursred_cash" || payment_method === "points";

    let grossServiceCharge: number;
    let exemptionApplied = 0;
    let netServiceCharge: number;

    if (isWalletPayment) {
      grossServiceCharge = 0;
      netServiceCharge = 0;
    } else {
      grossServiceCharge = parseFloat((subtotal * serviceChargePct / 100).toFixed(2));
      const { data: exemptionResult } = await supabase
        .rpc("apply_membership_service_fee_exemption", { p_user_id: user.id, p_gross_service_charge: grossServiceCharge });
      exemptionApplied = parseFloat(exemptionResult?.exemption_applied ?? "0");
      netServiceCharge = parseFloat(exemptionResult?.net_service_charge ?? grossServiceCharge.toString());
    }

    const supplementCommission = parseFloat((subtotal * supplementCommissionPct / 100).toFixed(2));
    const totalToPay = parseFloat((subtotal + netServiceCharge).toFixed(2));

    const supplementName = (suppReq.tour_supplements as any)?.name ?? "Suplemento";

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
        pointsEarned = isWalletPayment ? Math.floor(subtotal) * 2 : Math.floor(subtotal);
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
                description: `Puntos por suplemento: ${supplementName}`,
                reference_id: booking_supplement_id,
                reference_type: "supplement",
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

      await supabase.from("booking_supplements").update({
        status: "paid",
        payment_method: method,
        payment_intent_id: intentId,
        service_charge: netServiceCharge,
        membership_exemption_used: exemptionApplied,
        supplement_commission: supplementCommission,
        total_paid: totalToPay,
        paid_at: new Date().toISOString(),
        points_earned: pointsEarned,
        updated_at: new Date().toISOString(),
      }).eq("id", booking_supplement_id);

      if (method === "stripe" && intentId) {
        const { data: existingSuppTx } = await supabase
          .from("payment_transactions")
          .select("id")
          .eq("stripe_payment_intent_id", intentId)
          .maybeSingle();
        if (!existingSuppTx) {
          await supabase.from("payment_transactions").insert({
            booking_id: suppReq.booking_id,
            stripe_payment_intent_id: intentId,
            amount: totalToPay,
            currency: "mxn",
            status: "succeeded",
            payment_processor: "stripe",
            processor_fee: 0,
            net_amount: totalToPay,
            charge_context: "supplement",
            charge_reference_id: booking_supplement_id,
          });
        }
      } else if (method === "mercadopago" && intentId) {
        const { data: existingSuppTx } = await supabase
          .from("payment_transactions")
          .select("id")
          .eq("mercadopago_payment_id", intentId)
          .maybeSingle();
        if (!existingSuppTx) {
          await supabase.from("payment_transactions").insert({
            booking_id: suppReq.booking_id,
            mercadopago_payment_id: intentId,
            amount: totalToPay,
            currency: "mxn",
            status: "succeeded",
            payment_processor: "mercadopago",
            processor_fee: 0,
            net_amount: totalToPay,
            charge_context: "supplement",
            charge_reference_id: booking_supplement_id,
          });
        }
      } else if (method === "paypal" && intentId) {
        const { data: existingSuppTx } = await supabase
          .from("payment_transactions")
          .select("id")
          .eq("paypal_capture_id", intentId)
          .maybeSingle();
        if (!existingSuppTx) {
          await supabase.from("payment_transactions").insert({
            booking_id: suppReq.booking_id,
            paypal_capture_id: intentId,
            amount: totalToPay,
            currency: "mxn",
            status: "succeeded",
            payment_processor: "paypal",
            processor_fee: 0,
            net_amount: totalToPay,
            charge_context: "supplement",
            charge_reference_id: booking_supplement_id,
          });
        }
      } else if (method === "openpay" && intentId) {
        const { data: existingSuppTx } = await supabase
          .from("payment_transactions")
          .select("id")
          .eq("openpay_charge_id", intentId)
          .maybeSingle();
        if (!existingSuppTx) {
          await supabase.from("payment_transactions").insert({
            booking_id: suppReq.booking_id,
            openpay_charge_id: intentId,
            amount: totalToPay,
            currency: "mxn",
            status: "succeeded",
            payment_processor: "openpay",
            processor_fee: 0,
            net_amount: totalToPay,
            charge_context: "supplement",
            charge_reference_id: booking_supplement_id,
          });
        }
      }

      const { data: cfdiSettings } = await supabase
        .from("platform_settings")
        .select("pac_provider")
        .maybeSingle();
      const { data: secrets } = await supabase
        .from("platform_secrets")
        .select("pac_api_key_encrypted")
        .maybeSingle();
      if (cfdiSettings?.pac_provider && cfdiSettings.pac_provider !== "none" && secrets?.pac_api_key_encrypted) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/generate-supplement-cfdi`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
            body: JSON.stringify({ booking_supplement_id }),
          });
        } catch (cfdiErr) {
          console.error("CFDI generation error (non-fatal):", cfdiErr);
        }
      }

      return pointsEarned;
    };

    if (payment_method === "toursred_cash") {
      const { data: wallet } = await supabase
        .from("toursred_cash_wallets")
        .select("id, balance")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      const walletBalance = Number(wallet?.balance ?? 0);
      if (walletBalance < totalToPay) {
        return new Response(JSON.stringify({
          error: `Saldo insuficiente. Tienes $${walletBalance.toFixed(2)} y necesitas $${totalToPay.toFixed(2)}`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { error: walletError } = await supabase.rpc("update_wallet_balance", {
        p_user_id: user.id,
        p_amount: -totalToPay,
        p_type: "debit",
        p_description: `Suplemento: ${supplementName} (${suppReq.quantity}x $${Number(suppReq.unit_price).toFixed(2)})`,
        p_reference_id: booking_supplement_id,
        p_reference_type: "supplement_payment",
        p_idempotency_key: `${booking_supplement_id}_charge`,
      });

      if (walletError) {
        return new Response(JSON.stringify({ error: "Error al procesar el pago con ToursRed Cash" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const pointsEarned = await finalizePayment("toursred_cash", null);
      return new Response(JSON.stringify({
        success: true,
        total_charged: totalToPay,
        points_earned: pointsEarned,
        message: `Pago completado. Se descontaron $${totalToPay.toFixed(2)} de tu ToursRed Cash.${pointsEarned > 0 ? ` Ganaste ${pointsEarned} puntos.` : ""}`,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (payment_method === "points") {
      const pointsNeeded = Math.ceil(totalToPay * 100);
      const { data: pWallet } = await supabase
        .from("toursred_points_wallets")
        .select("id, balance")
        .eq("user_id", user.id)
        .maybeSingle();

      const pointsBalance = Number(pWallet?.balance ?? 0);
      if (pointsBalance < pointsNeeded) {
        return new Response(JSON.stringify({
          error: `Puntos insuficientes. Tienes ${pointsBalance} puntos y necesitas ${pointsNeeded}`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { error: deductError } = await supabase.rpc("deduct_points", {
        p_user_id: user.id,
        p_amount: pointsNeeded,
        p_description: `Pago de suplemento: ${supplementName}`,
        p_reference_id: booking_supplement_id,
        p_reference_type: "supplement_payment",
      });

      if (deductError) {
        return new Response(JSON.stringify({ error: "Error al procesar el pago con puntos" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await finalizePayment("points", null);
      return new Response(JSON.stringify({
        success: true,
        points_used: pointsNeeded,
        message: `Pago completado con ${pointsNeeded} puntos ToursRed.`,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (payment_method === "stripe") {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
      if (!stripeKey) {
        return new Response(JSON.stringify({ error: "Stripe no configurado" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });

      const origin = req.headers.get("origin") || req.headers.get("referer")?.split("/").slice(0, 3).join("/") || "https://toursred.com";

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "mxn",
            product_data: {
              name: supplementName,
              description: `${suppReq.quantity}x suplemento`,
            },
            unit_amount: Math.round(totalToPay * 100),
          },
          quantity: 1,
        }],
        metadata: {
          booking_supplement_id,
          payment_for: "supplement",
          user_id: user.id,
        },
        success_url: `${origin}/supplement-success?supplement_id=${booking_supplement_id}`,
        cancel_url: `${origin}/traveler/bookings`,
      });

      return new Response(JSON.stringify({
        success: true,
        url: session.url,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (payment_method === "mercadopago") {
      const mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") || platformSettings?.mercadopago_access_token;
      if (!mpAccessToken) {
        return new Response(JSON.stringify({ error: "MercadoPago no configurado" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const origin = req.headers.get("origin") || req.headers.get("referer")?.split("/").slice(0, 3).join("/") || "https://toursred.com";
      const notificationUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/mercadopago-webhook`;

      if (!mercadopago_payment_id) {
        const preferencePayload = {
          items: [{
            id: booking_supplement_id,
            title: supplementName,
            description: "Pago de suplemento para reserva",
            quantity: 1,
            unit_price: totalToPay,
            currency_id: "MXN",
          }],
          external_reference: booking_supplement_id,
          notification_url: notificationUrl,
          back_urls: {
            success: `${origin}/payment-return?provider=mercadopago&booking_supplement_id=${booking_supplement_id}&tr_status=success`,
            failure: `${origin}/traveler/bookings`,
            pending: `${origin}/payment-return?provider=mercadopago&booking_supplement_id=${booking_supplement_id}&tr_status=pending`,
          },
          auto_return: "approved",
          payment_methods: { excluded_payment_types: [{ id: "ticket" }] },
          metadata: { booking_supplement_id, payment_for: "supplement", user_id: user.id },
        };

        const prefResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${mpAccessToken}` },
          body: JSON.stringify(preferencePayload),
        });
        const prefData = await prefResponse.json();
        if (!prefResponse.ok) {
          return new Response(JSON.stringify({ error: prefData.message || "Error al crear preferencia de MercadoPago" }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ success: true, url: prefData.init_point }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (mercadopago_payment_id) {
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
        if (mpPayment.external_reference !== booking_supplement_id) {
          return new Response(JSON.stringify({ error: "La referencia externa del pago no coincide" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const mpAmount = parseFloat(mpPayment.transaction_amount || "0");
        if (Math.abs(mpAmount - totalToPay) > 0.50) {
          return new Response(JSON.stringify({
            error: `El monto del pago (${mpAmount}) no coincide con el esperado (${totalToPay})`,
          }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const pointsEarned = await finalizePayment("mercadopago", String(mercadopago_payment_id));
        return new Response(JSON.stringify({
          success: true, total_charged: totalToPay, points_earned: pointsEarned,
          message: "Pago con MercadoPago completado.",
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (payment_method === "paypal") {
      if (!paypal_order_id) {
        return new Response(JSON.stringify({ error: "paypal_order_id es requerido para PayPal" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const paypalClientId = platformSettings?.paypal_client_id;
      const paypalClientSecret = platformSettings?.paypal_client_secret;
      const isSandbox = platformSettings?.paypal_sandbox ?? true;
      if (!paypalClientId || !paypalClientSecret) {
        return new Response(JSON.stringify({ error: "PayPal no configurado" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const base = isSandbox ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
      const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
        method: "POST",
        headers: { Authorization: `Basic ${btoa(`${paypalClientId}:${paypalClientSecret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
      });
      const { access_token } = await tokenRes.json();

      const captureRes = await fetch(`${base}/v2/checkout/orders/${paypal_order_id}/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${access_token}` },
      });
      const captureData = await captureRes.json();

      if (!captureRes.ok || captureData.status !== "COMPLETED") {
        return new Response(JSON.stringify({ error: "Error al capturar el pago PayPal" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const capturedAmountPp = parseFloat(captureData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? "0");
      if (Math.abs(capturedAmountPp - totalToPay) > 0.5) {
        return new Response(JSON.stringify({
          error: `El monto capturado (${capturedAmountPp}) no coincide con el esperado (${totalToPay})`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const transactionId = captureData.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? paypal_order_id;
      const pointsEarned = await finalizePayment("paypal", transactionId);
      return new Response(JSON.stringify({
        success: true, total_charged: totalToPay, points_earned: pointsEarned,
        message: "Pago con PayPal completado.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (payment_method === "openpay") {
      const origin = req.headers.get("origin") || req.headers.get("referer")?.split("/").slice(0, 3).join("/") || "https://toursred.com";
      const opResponse = await fetch(`${supabaseUrl}/functions/v1/create-openpay-checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
        body: JSON.stringify({
          bookingId: suppReq.booking_id,
          chargeReferenceId: booking_supplement_id,
          amount: totalToPay,
          description: `Suplemento: ${supplementName} (${suppReq.quantity}x)`,
          context: "supplement",
          method: openpay_method || "card",
          redirectUrl: `${origin}/payment-pending/${booking_supplement_id}?context=supplement`,
        }),
      });
      const opResult = await opResponse.json();
      if (!opResult.success) {
        return new Response(JSON.stringify({ error: opResult.error || "Error al crear cargo de Openpay" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        success: true,
        url: opResult.url,
        payment_method: opResult.payment_method,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (payment_method === "conekta") {
      if (!conekta_method || !["card", "cash", "spei", "bnpl"].includes(conekta_method)) {
        return new Response(JSON.stringify({ error: "conekta_method es requerido y debe ser card, cash, spei o bnpl" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (conekta_method === "bnpl") {
        if (!bnpl_product_type || !["aplazo_bnpl", "creditea_bnpl", "coppel_bnpl"].includes(bnpl_product_type)) {
          return new Response(JSON.stringify({ error: "bnpl_product_type es requerido y debe ser aplazo_bnpl, creditea_bnpl o coppel_bnpl" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (totalToPay < 1200 || totalToPay > 16000) {
          return new Response(JSON.stringify({ error: "El monto para BNPL debe estar entre $1,200 y $16,000 MXN" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const conektaPrivateKey = Deno.env.get("CONEKTA_PRIVATE_KEY");
      if (!conektaPrivateKey) {
        return new Response(JSON.stringify({ error: "Conekta no configurado" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: userProfileConekta } = await supabase.from("users").select("first_name, last_name").eq("id", user.id).maybeSingle();
      const conektaCustomerName = `${userProfileConekta?.first_name || ""} ${userProfileConekta?.last_name || ""}`.trim() || "Cliente";

      const origin = req.headers.get("origin") || req.headers.get("referer")?.split("/").slice(0, 3).join("/") || "https://toursred.com";
      const successUrl = `${origin}/supplement-success?supplement_id=${booking_supplement_id}`;
      const failureUrl = `${origin}/traveler/bookings`;
      const cancelUrl = `${origin}/traveler/bookings`;
      const amountInCents = Math.round(totalToPay * 100);

      const orderPayload: any = {
        currency: "MXN",
        amount: amountInCents,
        customer_info: { name: conektaCustomerName, email: user.email || "no-email@toursred.com" },
        line_items: [{
          name: supplementName, unit_price: amountInCents, quantity: 1,
          ...(conekta_method === "bnpl" ? { tags: ["bnpl"] } : {}),
        }],
        checkout: {
          type: "HostedPayment",
          allowed_payment_methods: [conekta_method === "spei" ? "bank_transfer" : conekta_method],
          success_url: successUrl, failure_url: failureUrl, cancel_url: cancelUrl,
          expires_at: Math.floor(Date.now() / 1000) + 71 * 3600,
        },
        metadata: {
          booking_id: suppReq.booking_id, payment_method_type: conekta_method, context: "supplement",
          charge_reference_id: booking_supplement_id,
          extra_subtotal: subtotal.toString(),
          ...(conekta_method === "bnpl" ? { bnpl_product_type } : {}),
        },
      };

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
        const errorBody = await apiResponse.text();
        console.error("Conekta API error (supplement):", errorBody);
        let errorMsg = "Error al crear orden de Conekta";
        try { const parsed = JSON.parse(errorBody); errorMsg = parsed?.details?.[0]?.message || parsed?.message || errorMsg; } catch {}
        return new Response(JSON.stringify({ error: errorMsg }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const order = await apiResponse.json();
      const orderId = order.id;
      const checkoutUrl = order.checkout?.url;

      if (!orderId) {
        return new Response(JSON.stringify({ error: "Respuesta inválida de Conekta" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const idempotencyKey = `${booking_supplement_id}_supplement_${Date.now()}`;
      await supabase.from("payment_transactions").insert({
        booking_id: suppReq.booking_id, amount: totalToPay, currency: "mxn", status: "pending",
        payment_method_type: conekta_method, payment_processor: "conekta", processor_fee: 0,
        net_amount: totalToPay, conekta_order_id: orderId,
        bnpl_product_type: conekta_method === "bnpl" ? bnpl_product_type : null,
        p_idempotency_key: idempotencyKey, charge_context: "supplement",
        charge_reference_id: booking_supplement_id,
        metadata: { conekta_order: order, checkout_url: checkoutUrl, subtotal },
      });

      return new Response(JSON.stringify({ success: true, url: checkoutUrl, order_id: orderId }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
