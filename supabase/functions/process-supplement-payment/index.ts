import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@22.3.0";

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
      mp_form_data,
      paypal_order_id,
    } = await req.json();

    if (!booking_supplement_id || !payment_method) {
      return new Response(JSON.stringify({ error: "booking_supplement_id y payment_method son requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load supplement request with full context
    const { data: suppReq } = await supabase
      .from("booking_supplements")
      .select(`
        id, booking_id, status, quantity, unit_price, service_charge,
        membership_exemption_used, supplement_commission, total_paid, expires_at,
        tour_supplements!inner(id, name, tour_id),
        bookings!inner(id, user_id)
      `)
      .eq("id", booking_supplement_id)
      .maybeSingle();

    if (!suppReq) {
      return new Response(JSON.stringify({ error: "Solicitud de suplemento no encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if ((suppReq.bookings as any).user_id !== user.id) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["pending_payment", "approved"].includes(suppReq.status)) {
      if (suppReq.status === "paid") {
        // If paid but no CFDI yet, trigger generation now (handles constraint-fix backfill scenario)
        const { data: existingCfdi } = await supabase
          .from("cfdi_invoices")
          .select("id")
          .eq("booking_supplement_id", booking_supplement_id)
          .eq("invoice_type", "supplement")
          .maybeSingle();

        if (!existingCfdi) {
          const { data: cfdiSettings } = await supabase
            .from("platform_settings")
            .select("pac_provider, pac_api_key_encrypted")
            .maybeSingle();
          if (cfdiSettings?.pac_provider && cfdiSettings.pac_provider !== "none" && cfdiSettings.pac_api_key_encrypted) {
            try {
              await fetch(`${supabaseUrl}/functions/v1/generate-supplement-cfdi`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
                body: JSON.stringify({ booking_supplement_id }),
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

    // Check expiry for approved supplements
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

    // Platform settings
    const { data: platformSettings } = await supabase
      .from("platform_settings")
      .select("service_charge_percentage, supplement_commission_percentage, mercadopago_access_token, paypal_client_id, paypal_client_secret, paypal_sandbox")
      .maybeSingle();

    const serviceChargePct = platformSettings?.service_charge_percentage ?? 5;
    const supplementCommissionPct = platformSettings?.supplement_commission_percentage ?? 10;
    const subtotal = Number(suppReq.unit_price) * suppReq.quantity;
    const grossServiceCharge = parseFloat((subtotal * serviceChargePct / 100).toFixed(2));

    // Membership exemption via centralized RPC (atomic, FOR UPDATE locked)
    const { data: exemptionResult } = await supabase
      .rpc("apply_membership_service_fee_exemption", { p_user_id: user.id, p_gross_service_charge: grossServiceCharge });
    const exemptionApplied = parseFloat(exemptionResult?.exemption_applied ?? "0");
    const netServiceCharge = parseFloat(exemptionResult?.net_service_charge ?? grossServiceCharge.toString());
    const supplementCommission = parseFloat((subtotal * supplementCommissionPct / 100).toFixed(2));
    const totalToPay = parseFloat((subtotal + netServiceCharge).toFixed(2));

    const supplementName = (suppReq.tour_supplements as any)?.name ?? "Suplemento";

    // Finalize payment: update membership, award points, mark as paid, trigger CFDI
    const finalizePayment = async (method: string, intentId: string | null) => {
      // Exemption already consumed atomically by apply_membership_service_fee_exemption RPC above

      let pointsEarned = 0;
      const { data: activeMembership } = await supabase
        .from("memberships")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "active")
        .gt("current_period_end", new Date().toISOString())
        .maybeSingle();

      if (activeMembership) {
        pointsEarned = Math.floor(subtotal);
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

      // Record in payment_transactions for refund tracking (skip for points/cash internal methods)
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
      }

      // Trigger CFDI generation synchronously (catch errors so payment isn't affected)
      const { data: cfdiSettings } = await supabase
        .from("platform_settings")
        .select("pac_provider, pac_api_key_encrypted")
        .maybeSingle();
      if (cfdiSettings?.pac_provider && cfdiSettings.pac_provider !== "none" && cfdiSettings.pac_api_key_encrypted) {
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

    // ===================== PAYMENT ROUTING =====================

    // 1. ToursRed Cash
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

    // 2. ToursRed Points (1 punto = $0.01 MXN → 100 puntos = $1 MXN)
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

    // 3. Stripe — create Checkout Session (hosted by Stripe, same as booking flow)
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

    // 4. MercadoPago (Brick direct charge OR redirect-confirmed)
    if (payment_method === "mercadopago") {
      // No mp_form_data means the payment was confirmed via MP redirect (back_urls flow)
      // Just finalize without charging again
      if (!mp_form_data) {
        const pointsEarned = await finalizePayment("mercadopago", null);
        return new Response(JSON.stringify({
          success: true, total_charged: totalToPay, points_earned: pointsEarned,
          message: "Pago con MercadoPago confirmado.",
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") || platformSettings?.mercadopago_access_token;
      if (!mpAccessToken) {
        return new Response(JSON.stringify({ error: "MercadoPago no configurado" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const mpPayload = {
        ...mp_form_data,
        transaction_amount: totalToPay,
        external_reference: booking_supplement_id,
        notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mercadopago-webhook`,
        metadata: { ...(mp_form_data.metadata || {}), booking_supplement_id, payment_for: "supplement" },
      };

      const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mpAccessToken}`,
          "X-Idempotency-Key": `supp-${booking_supplement_id}-${Date.now()}`,
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

      const pointsEarned = await finalizePayment("mercadopago", String(mpPayment.id));
      return new Response(JSON.stringify({
        success: true, total_charged: totalToPay, points_earned: pointsEarned,
        message: "Pago con MercadoPago completado.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 5. PayPal — capture existing order
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

      const transactionId = captureData.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? paypal_order_id;
      const pointsEarned = await finalizePayment("paypal", transactionId);
      return new Response(JSON.stringify({
        success: true, total_charged: totalToPay, points_earned: pointsEarned,
        message: "Pago con PayPal completado.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: `Método de pago no soportado: ${payment_method}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
