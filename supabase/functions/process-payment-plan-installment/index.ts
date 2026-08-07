import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@22.3.0";
import { isConfigured as isOpenpayConfigured, getDashboardUrl, getMerchantId, createOrReuseCustomer as createOrReuseOpenpayCustomer, createSpeiCharge, createCashCharge, createCardCheckoutCharge } from "../_shared/openpay.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "No autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      plan_id,
      amount,
      payment_method,
      stripe_payment_intent_id,
      paypal_order_id,
      mp_form_data,
      mercadopago_payment_id,
      conekta_method,
      bnpl_product_type,
      openpay_method,   // "card" | "spei" | "cash"
      pay_full_balance = false,
    } = await req.json();

    if (!plan_id || !amount || !payment_method) {
      return new Response(JSON.stringify({ error: "plan_id, amount y payment_method son requeridos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payAmount = Number(amount);
    if (payAmount <= 0) {
      return new Response(JSON.stringify({ error: "El monto debe ser mayor a cero" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load plan with booking and tour context
    const { data: plan } = await supabase
      .from("booking_payment_plans")
      .select(`
        id, booking_id, mode, total_plan_amount, total_amount_paid, pending_balance, status,
        bookings!inner(
          id, user_id, tour_id, booking_code, status,
          tours!inner(
            id, name, agency_id,
            late_payment_penalty_pct, late_payment_penalty_fixed, late_payment_grace_days
          )
        )
      `)
      .eq("id", plan_id)
      .maybeSingle();

    if (!plan) {
      return new Response(JSON.stringify({ error: "Plan de pago no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const booking = plan.bookings as any;
    const tour = booking.tours as any;

    if (booking.status === "cancellation_processing") {
      return new Response(JSON.stringify({ error: "La reserva está en proceso de cancelación" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (booking.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["active"].includes(plan.status)) {
      return new Response(JSON.stringify({ error: `El plan no está activo (estado: ${plan.status})` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pendingBalance = Number(plan.pending_balance);
    const effectiveAmount = pay_full_balance ? pendingBalance : Math.min(payAmount, pendingBalance);

    if (effectiveAmount <= 0) {
      return new Response(JSON.stringify({ error: "El plan ya está completamente pagado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Platform settings
    const { data: platformSettings } = await supabase
      .from("platform_settings")
      .select("payment_plan_service_charge_pct, mercadopago_access_token, paypal_client_id, paypal_client_secret, paypal_sandbox, pac_provider, pac_api_key_encrypted")
      .maybeSingle();

    const serviceChargePct = Number(platformSettings?.payment_plan_service_charge_pct ?? 5);
    const isWalletPayment = payment_method === "toursred_cash" || payment_method === "points";

    let grossServiceCharge: number;
    let exemptionApplied = 0;
    let netServiceCharge: number;

    if (isWalletPayment) {
      grossServiceCharge = 0;
      netServiceCharge = 0;
    } else {
      grossServiceCharge = parseFloat((effectiveAmount * serviceChargePct / 100).toFixed(2));
      const { data: exemptionResult } = await supabase
        .rpc("apply_membership_service_fee_exemption", { p_user_id: user.id, p_gross_service_charge: grossServiceCharge });
      exemptionApplied = parseFloat(exemptionResult?.exemption_applied ?? "0");
      netServiceCharge = parseFloat(exemptionResult?.net_service_charge ?? grossServiceCharge.toString());
    }

    const totalToPay = parseFloat((effectiveAmount + netServiceCharge).toFixed(2));

    // Load overdue and pending installments ordered by due_date (oldest first)
    const { data: installments } = await supabase
      .from("booking_payment_plan_installments")
      .select("id, installment_number, label, amount_due, amount_paid, due_date, status, penalty_applied")
      .eq("plan_id", plan_id)
      .in("status", ["overdue", "overdue_grace", "pending", "partially_paid"])
      .order("due_date", { ascending: true });

    if (!installments || installments.length === 0) {
      return new Response(JSON.stringify({ error: "No hay parcialidades pendientes de pago" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tourName = tour?.name ?? "Tour";
    const bookingCode = booking.booking_code ?? booking.id;

    // Helper: allocate payment via shared SQL function (idempotent, handles allocations + points)
    const finalizePayment = async (provider: string, providerTransactionId: string | null, presetTxId?: string): Promise<{ pointsEarned: number; transactionId: string }> => {
      const { data: result, error: allocError } = await supabase.rpc("allocate_payment_plan_installment", {
        p_plan_id: plan_id,
        p_amount: effectiveAmount,
        p_provider: provider,
        p_service_charge: netServiceCharge,
        p_gross_service_charge: grossServiceCharge,
        p_provider_transaction_id: providerTransactionId || presetTxId || null,
        p_user_id: user.id,
        p_membership_exemption_used: exemptionApplied > 0,
        p_is_wallet_payment: isWalletPayment,
      });

      if (allocError || !result) throw new Error(`allocate_payment_plan_installment failed: ${allocError?.message}`);

      const txId = result.transaction_id as string;
      const pointsEarned = result.points_earned as number;
      const returnedAllocations = (result.allocations as any[]) || [];

      // Record in payment_transactions for refund tracking (processor payments only)
      if (provider === "stripe" && providerTransactionId) {
        const { data: existingPlanTx } = await supabase
          .from("payment_transactions")
          .select("id")
          .eq("stripe_payment_intent_id", providerTransactionId)
          .maybeSingle();
        if (!existingPlanTx) {
          await supabase.from("payment_transactions").insert({
            booking_id: booking.id,
            stripe_payment_intent_id: providerTransactionId,
            amount: totalToPay,
            currency: "mxn",
            status: "succeeded",
            payment_processor: "stripe",
            processor_fee: 0,
            net_amount: totalToPay,
            charge_context: "payment_plan_installment",
            charge_reference_id: txId,
          });
        }
      } else if (provider === "mercadopago" && providerTransactionId) {
        const { data: existingPlanTx } = await supabase
          .from("payment_transactions")
          .select("id")
          .eq("mercadopago_payment_id", providerTransactionId)
          .maybeSingle();
        if (!existingPlanTx) {
          await supabase.from("payment_transactions").insert({
            booking_id: booking.id,
            mercadopago_payment_id: providerTransactionId,
            amount: totalToPay,
            currency: "mxn",
            status: "succeeded",
            payment_processor: "mercadopago",
            processor_fee: 0,
            net_amount: totalToPay,
            charge_context: "payment_plan_installment",
            charge_reference_id: txId,
          });
        }
      } else if (provider === "paypal" && providerTransactionId) {
        const { data: existingPlanTx } = await supabase
          .from("payment_transactions")
          .select("id")
          .eq("paypal_capture_id", providerTransactionId)
          .maybeSingle();
        if (!existingPlanTx) {
          await supabase.from("payment_transactions").insert({
            booking_id: booking.id,
            paypal_capture_id: providerTransactionId,
            amount: totalToPay,
            currency: "mxn",
            status: "succeeded",
            payment_processor: "paypal",
            processor_fee: 0,
            net_amount: totalToPay,
            charge_context: "payment_plan_installment",
            charge_reference_id: txId,
          });
        }
      }

      // Trigger CFDI generation for each newly-paid installment
      if (platformSettings?.pac_provider && platformSettings.pac_provider !== "none" && platformSettings.pac_api_key_encrypted) {
        for (const alloc of returnedAllocations) {
          const inst = installments!.find((i) => i.id === alloc.installment_id);
          if (!inst) continue;
          const instAfterPaid = parseFloat((Number(inst.amount_paid) + alloc.amount_allocated).toFixed(2));
          const instTotalDue = parseFloat((Number(inst.amount_due) + Number(inst.penalty_applied)).toFixed(2));
          if (instAfterPaid >= instTotalDue) {
            EdgeRuntime.waitUntil(
              fetch(`${supabaseUrl}/functions/v1/generate-booking-installment-cfdi`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
                body: JSON.stringify({
                  installment_id: alloc.installment_id,
                  transaction_id: txId,
                }),
              }).catch((err) => console.error('Error generating installment CFDI:', err.message, err.stack))
            );
          }
        }
      }

      return { pointsEarned, transactionId: txId };
    };

    // ===================== PAYMENT ROUTING =====================

    // 1. ToursRed Cash
    if (payment_method === "toursred_cash") {
      const { data: wallet } = await supabase
        .from("toursred_cash_wallets")
        .select("id, balance")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (Number(wallet?.balance ?? 0) < totalToPay) {
        return new Response(JSON.stringify({
          error: `Saldo insuficiente. Tienes $${Number(wallet?.balance ?? 0).toFixed(2)} y necesitas $${totalToPay.toFixed(2)}`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const installmentTxId = crypto.randomUUID();
      const { error: walletError } = await supabase.rpc("update_wallet_balance", {
        p_user_id: user.id,
        p_amount: -totalToPay,
        p_type: "debit",
        p_description: `Abono a plan de pago: ${tourName} (${bookingCode})`,
        p_reference_id: plan_id,
        p_reference_type: "payment_plan",
        p_idempotency_key: installmentTxId,
      });

      if (walletError) {
        return new Response(JSON.stringify({ error: "Error al procesar el pago con ToursRed Cash" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { pointsEarned } = await finalizePayment("toursred_cash", null, installmentTxId);
      return new Response(JSON.stringify({
        success: true,
        amount_paid: effectiveAmount,
        service_charge: netServiceCharge,
        total_charged: totalToPay,
        points_earned: pointsEarned,
        message: `Abono completado. Se descontaron $${totalToPay.toFixed(2)} de tu ToursRed Cash.${pointsEarned > 0 ? ` Ganaste ${pointsEarned} puntos.` : ""}`,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2. ToursRed Points
    if (payment_method === "points") {
      const pointsNeeded = Math.ceil(totalToPay * 100);
      const { data: pWallet } = await supabase
        .from("toursred_points_wallets")
        .select("id, balance")
        .eq("user_id", user.id)
        .maybeSingle();

      if (Number(pWallet?.balance ?? 0) < pointsNeeded) {
        return new Response(JSON.stringify({
          error: `Puntos insuficientes. Tienes ${pWallet?.balance ?? 0} puntos y necesitas ${pointsNeeded}`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const installmentTxId = crypto.randomUUID();
      const { error: deductError } = await supabase.rpc("deduct_points", {
        p_user_id: user.id,
        p_amount: pointsNeeded,
        p_description: `Abono a plan de pago: ${tourName} (${bookingCode})`,
        p_reference_id: installmentTxId,
        p_reference_type: "payment_plan",
      });

      if (deductError) {
        return new Response(JSON.stringify({ error: "Error al procesar el pago con puntos" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await finalizePayment("points", null, installmentTxId);
      return new Response(JSON.stringify({
        success: true,
        points_used: pointsNeeded,
        amount_paid: effectiveAmount,
        message: `Abono completado con ${pointsNeeded} puntos ToursRed.`,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3. Stripe — Checkout Session
    if (payment_method === "stripe") {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
      if (!stripeKey) {
        return new Response(JSON.stringify({ error: "Stripe no configurado" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });
      const origin = req.headers.get("origin") || req.headers.get("referer")?.split("/").slice(0, 3).join("/") || "https://toursred.com";

      const lineItems: any[] = [{
        price_data: {
          currency: "mxn",
          product_data: {
            name: `Abono plan de pago: ${tourName}`,
            description: `Reserva ${bookingCode}`,
          },
          unit_amount: Math.round(effectiveAmount * 100),
        },
        quantity: 1,
      }];
      if (netServiceCharge > 0) {
        lineItems.push({
          price_data: {
            currency: "mxn",
            product_data: {
              name: "Cargo por Servicio",
            },
            unit_amount: Math.round(netServiceCharge * 100),
          },
          quantity: 1,
        });
      }

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        line_items: lineItems,
        metadata: {
          plan_id,
          payment_for: "payment_plan_installment",
          user_id: user.id,
          effective_amount: String(effectiveAmount),
          net_service_charge: String(netServiceCharge),
        },
        success_url: `${origin}/payment-plan-success?plan_id=${plan_id}`,
        cancel_url: `${origin}/traveler/bookings`,
      });

      return new Response(JSON.stringify({ success: true, url: session.url }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. MercadoPago
    if (payment_method === "mercadopago") {
      const mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") || platformSettings?.mercadopago_access_token;
      if (!mpAccessToken) {
        return new Response(JSON.stringify({ error: "MercadoPago no configurado" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const origin = req.headers.get("origin") || req.headers.get("referer")?.split("/").slice(0, 3).join("/") || "https://toursred.com";
      const notificationUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/mercadopago-webhook`;

      // Path (a): No form data and no payment_id → create Checkout Pro preference for redirect flow
      if (!mp_form_data && !mercadopago_payment_id) {
        const preferencePayload = {
          items: [{
            title: `Abono plan de pagos - ${tourName} (${bookingCode})`,
            unit_price: totalToPay,
            quantity: 1,
            currency_id: "MXN",
          }],
          external_reference: plan_id,
          notification_url: notificationUrl,
          back_urls: {
            success: `${origin}/payment-return?provider=mercadopago&plan_id=${plan_id}&status=success&context=payment_plan_installment&pay_full_balance=${pay_full_balance}`,
            failure: `${origin}/payment-return?provider=mercadopago&plan_id=${plan_id}&status=failure&context=payment_plan_installment&pay_full_balance=${pay_full_balance}`,
            pending: `${origin}/payment-return?provider=mercadopago&plan_id=${plan_id}&status=pending&context=payment_plan_installment&pay_full_balance=${pay_full_balance}`,
          },
          auto_return: "approved",
          payment_methods: { excluded_payment_types: [{ id: "ticket" }] },
          metadata: { plan_id, payment_for: "payment_plan_installment", user_id: user.id },
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

      // Path (c): mercadopago_payment_id present → verify against MP API before confirming
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
        if (mpPayment.external_reference !== plan_id) {
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
        const { pointsEarned } = await finalizePayment("mercadopago", String(mercadopago_payment_id));
        return new Response(JSON.stringify({
          success: true,
          amount_paid: effectiveAmount,
          total_charged: totalToPay,
          points_earned: pointsEarned,
          message: "Abono con MercadoPago completado.",
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Path (b): mp_form_data present → direct Brick charge with server-calculated amount
      const mpPayload = {
        ...mp_form_data,
        transaction_amount: totalToPay,
        external_reference: plan_id,
        notification_url: notificationUrl,
        metadata: { ...(mp_form_data.metadata || {}), plan_id, payment_for: "payment_plan_installment" },
      };

      const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mpAccessToken}`,
          "X-Idempotency-Key": `plan-${plan_id}-${Date.now()}`,
        },
        body: JSON.stringify(mpPayload),
      });

      const mpPayment = await mpResponse.json();
      if (!mpResponse.ok || mpPayment.status !== "approved") {
        return new Response(JSON.stringify({
          error: mpPayment.message || "Error en el pago con MercadoPago",
          status_detail: mpPayment.status_detail,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { pointsEarned } = await finalizePayment("mercadopago", String(mpPayment.id));
      return new Response(JSON.stringify({
        success: true,
        amount_paid: effectiveAmount,
        total_charged: totalToPay,
        points_earned: pointsEarned,
        message: "Abono con MercadoPago completado.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 5. PayPal
    if (payment_method === "paypal") {
      if (!paypal_order_id) {
        return new Response(JSON.stringify({ error: "paypal_order_id es requerido para PayPal" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const paypalClientId = platformSettings?.paypal_client_id;
      const paypalClientSecret = platformSettings?.paypal_client_secret;
      const isSandbox = platformSettings?.paypal_sandbox ?? true;
      if (!paypalClientId || !paypalClientSecret) {
        return new Response(JSON.stringify({ error: "PayPal no configurado" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
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
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const transactionId = captureData.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? paypal_order_id;
      const { pointsEarned } = await finalizePayment("paypal", transactionId);
      return new Response(JSON.stringify({
        success: true,
        amount_paid: effectiveAmount,
        total_charged: totalToPay,
        points_earned: pointsEarned,
        message: "Abono con PayPal completado.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 6. Conekta (async — creates order, redirects to checkout, webhook confirms)
    if (payment_method === "conekta") {
      if (!conekta_method) {
        return new Response(JSON.stringify({ error: "conekta_method es requerido para Conekta" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!["bnpl", "card", "cash", "spei"].includes(conekta_method)) {
        return new Response(JSON.stringify({ error: "conekta_method debe ser bnpl, card, cash o spei" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (conekta_method === "bnpl") {
        if (!bnpl_product_type || !["aplazo_bnpl", "creditea_bnpl", "coppel_bnpl"].includes(bnpl_product_type)) {
          return new Response(JSON.stringify({ error: "bnpl_product_type es requerido y debe ser aplazo_bnpl, creditea_bnpl o coppel_bnpl" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (totalToPay < 1200) {
          return new Response(JSON.stringify({ error: "El monto mínimo para BNPL es $1,200 MXN" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (totalToPay > 16000) {
          return new Response(JSON.stringify({ error: "El monto máximo para BNPL es $16,000 MXN por transacción" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const conektaPrivateKey = Deno.env.get("CONEKTA_PRIVATE_KEY");
      if (!conektaPrivateKey) {
        return new Response(JSON.stringify({ error: "Conekta no configurado" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const origin = req.headers.get("origin") || "https://toursred.com";
      const successUrl = `${origin}/payment-return?provider=conekta&booking_id=${booking.id}&status=success&context=payment_plan_installment`;
      const failureUrl = `${origin}/payment-return?provider=conekta&booking_id=${booking.id}&status=failure&context=payment_plan_installment`;
      const cancelUrl = `${origin}/payment-return?provider=conekta&booking_id=${booking.id}&status=cancel&context=payment_plan_installment`;

      const amountInCents = Math.round(totalToPay * 100);
      const orderPayload: any = {
        currency: "MXN",
        amount: amountInCents,
        line_items: [{
          name: `Abono plan de pagos - ${tourName} (${bookingCode})`,
          unit_price: amountInCents,
          quantity: 1,
          ...(conekta_method === "bnpl" ? { tags: ["bnpl"] } : {}),
        }],
        checkout: {
          type: "HostedPayment",
          allowed_payment_methods: [conekta_method],
          success_url: successUrl,
          failure_url: failureUrl,
          cancel_url: cancelUrl,
          expires_at: Math.floor(Date.now() / 1000) + 71 * 3600,
        },
        metadata: {
          booking_id: booking.id,
          payment_method_type: conekta_method,
          context: "payment_plan_installment",
          charge_reference_id: plan_id,
          effective_amount: String(effectiveAmount),
          net_service_charge: String(netServiceCharge),
          gross_service_charge: String(grossServiceCharge),
          membership_exemption_applied: String(exemptionApplied > 0),
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
        console.error("Conekta API error:", errorBody);
        let errorMsg = "Error al crear orden de Conekta";
        try {
          const parsed = JSON.parse(errorBody);
          errorMsg = parsed?.details?.[0]?.message || parsed?.message || errorMsg;
        } catch {}
        return new Response(JSON.stringify({ error: errorMsg }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const order = await apiResponse.json();
      const orderId = order.id;
      const checkoutUrl = order.checkout?.url;

      if (!orderId) {
        return new Response(JSON.stringify({ error: "Respuesta inválida de Conekta" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Insert payment_transactions record (pending — webhook will confirm)
      const idempotencyKey = `${booking.id}_payment_plan_installment_${plan_id}_${Date.now()}`;
      await supabase.from("payment_transactions").insert({
        booking_id: booking.id,
        amount: totalToPay,
        currency: "mxn",
        status: "pending",
        payment_method_type: conekta_method,
        payment_processor: "conekta",
        processor_fee: 0,
        net_amount: totalToPay,
        conekta_order_id: orderId,
        bnpl_product_type: conekta_method === "bnpl" ? bnpl_product_type : null,
        p_idempotency_key: idempotencyKey,
        charge_context: "payment_plan_installment",
        charge_reference_id: plan_id,
        metadata: {
          conekta_order: order,
          checkout_url: checkoutUrl,
          ...(conekta_method === "bnpl" ? { bnpl_product_type } : {}),
        },
      });

      return new Response(JSON.stringify({
        success: true,
        order_id: orderId,
        checkout_url: checkoutUrl,
        amount: totalToPay,
        payment_method_type: conekta_method,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 7. Bank transfer / Cash (registered by admin)
    if (payment_method === "bank_transfer" || payment_method === "cash") {
      const { pointsEarned, transactionId } = await finalizePayment(payment_method, null);
      return new Response(JSON.stringify({
        success: true,
        transaction_id: transactionId,
        amount_paid: effectiveAmount,
        total_charged: totalToPay,
        points_earned: pointsEarned,
        message: `Abono por ${payment_method === "bank_transfer" ? "transferencia bancaria" : "efectivo"} registrado.`,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 8. Openpay
    if (payment_method === "openpay") {
      if (!openpay_method || !["card", "spei", "cash"].includes(openpay_method)) {
        return new Response(JSON.stringify({ error: "openpay_method es requerido y debe ser card, spei o cash" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!isOpenpayConfigured()) {
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
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const origin = req.headers.get("origin") || "https://toursred.com";
      const successUrlOp = `${origin}/payment-pending/${plan_id}?context=payment_plan_installment`;
      const orderIdOp = `payment_plan_installment_${plan_id}_${Date.now()}`;
      const roundedAmtPp = Math.round(totalToPay * 100) / 100;
      const descPp = `Abono plan de pago: ${tourName} (${bookingCode})`;

      let chargeOp;
      try {
        if (openpay_method === "spei") {
          chargeOp = await createSpeiCharge(customerIdOp, roundedAmtPp, orderIdOp, descPp);
        } else if (openpay_method === "cash") {
          chargeOp = await createCashCharge(customerIdOp, roundedAmtPp, orderIdOp, descPp);
        } else {
          chargeOp = await createCardCheckoutCharge(customerIdOp, roundedAmtPp, orderIdOp, descPp, successUrlOp, {
            charge_context: "payment_plan_installment", charge_reference_id: plan_id,
            effective_amount: String(effectiveAmount), net_service_charge: String(netServiceCharge),
            gross_service_charge: String(grossServiceCharge), membership_exemption_applied: String(exemptionApplied > 0),
          });
        }
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const paymentMethodMetadataPp: Record<string, any> = {
        openpay_method, openpay_charge_id: chargeOp.id, openpay_status: chargeOp.status,
        effective_amount: String(effectiveAmount), net_service_charge: String(netServiceCharge),
        gross_service_charge: String(grossServiceCharge), membership_exemption_applied: String(exemptionApplied > 0),
      };
      if (openpay_method === "spei") {
        if (chargeOp.payment_method?.clabe) paymentMethodMetadataPp.clabe = chargeOp.payment_method.clabe;
        if (chargeOp.payment_method?.bank) paymentMethodMetadataPp.bank = chargeOp.payment_method.bank;
        if (chargeOp.payment_method?.name) paymentMethodMetadataPp.reference = chargeOp.payment_method.name;
        paymentMethodMetadataPp.spei_pdf_url = `${getDashboardUrl()}/spei-pdf/${getMerchantId()}/${chargeOp.id}`;
      } else if (openpay_method === "cash") {
        if (chargeOp.payment_method?.reference) paymentMethodMetadataPp.reference = chargeOp.payment_method.reference;
        if (chargeOp.payment_method?.store) paymentMethodMetadataPp.store = chargeOp.payment_method.store;
        if (chargeOp.payment_method?.expiry_date) paymentMethodMetadataPp.expiry_date = chargeOp.payment_method.expiry_date;
        if (chargeOp.payment_method?.barcode_url) paymentMethodMetadataPp.barcode_url = chargeOp.payment_method.barcode_url;
        if (chargeOp.payment_method?.reference) paymentMethodMetadataPp.cash_pdf_url = `${getDashboardUrl()}/paynet-pdf/${getMerchantId()}/${chargeOp.payment_method.reference}`;
      }

      await supabase.from("payment_transactions").insert({
        booking_id: booking.id, amount: totalToPay, currency: "mxn", status: "pending",
        payment_method_type: openpay_method, payment_processor: "openpay",
        processor_fee: 0, net_amount: totalToPay, openpay_charge_id: chargeOp.id,
        charge_context: "payment_plan_installment", charge_reference_id: plan_id,
        metadata: paymentMethodMetadataPp,
      });

      return new Response(JSON.stringify({
        success: true,
        url: openpay_method === "card" ? chargeOp.payment_method?.url : undefined,
        payment_method: openpay_method !== "card" ? chargeOp.payment_method : undefined,
        amount: totalToPay,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: `Método de pago no soportado: ${payment_method}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
