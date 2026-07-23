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
    const grossServiceCharge = parseFloat((effectiveAmount * serviceChargePct / 100).toFixed(2));

    // Membership exemption via centralized RPC (atomic, FOR UPDATE locked)
    const { data: exemptionResult } = await supabase
      .rpc("apply_membership_service_fee_exemption", { p_user_id: user.id, p_gross_service_charge: grossServiceCharge });
    const exemptionApplied = parseFloat(exemptionResult?.exemption_applied ?? "0");
    const netServiceCharge = parseFloat(exemptionResult?.net_service_charge ?? grossServiceCharge.toString());
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

    // Allocate payment chronologically (oldest first)
    const allocations: Array<{ installment_id: string; amount_allocated: number }> = [];
    let remaining = effectiveAmount;

    for (const inst of installments) {
      if (remaining <= 0) break;
      const amountOwed = Number(inst.amount_due) + Number(inst.penalty_applied) - Number(inst.amount_paid);
      if (amountOwed <= 0) continue;
      const allocated = Math.min(remaining, amountOwed);
      allocations.push({ installment_id: inst.id, amount_allocated: parseFloat(allocated.toFixed(2)) });
      remaining = parseFloat((remaining - allocated).toFixed(2));
    }

    const tourName = tour?.name ?? "Tour";
    const bookingCode = booking.booking_code ?? booking.id;

    // Helper: consume exemption, award points, create transaction + allocations
    const finalizePayment = async (provider: string, providerTransactionId: string | null) => {
      // Exemption already consumed atomically by apply_membership_service_fee_exemption RPC above

      // Calculate points earned (actual award happens after txRecord creation)
      let pointsEarned = 0;
      const { data: activeMembership } = await supabase
        .from("memberships")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "active")
        .gt("current_period_end", new Date().toISOString())
        .maybeSingle();

      if (activeMembership) {
        pointsEarned = Math.floor(effectiveAmount + netServiceCharge);
      }

      // Create transaction record
      const { data: txRecord, error: txError } = await supabase
        .from("booking_payment_plan_transactions")
        .insert({
          plan_id,
          booking_id: booking.id,
          user_id: user.id,
          amount: effectiveAmount,
          service_charge: netServiceCharge,
          gross_service_charge: grossServiceCharge,
          payment_provider: provider,
          provider_transaction_id: providerTransactionId,
          membership_exemption_used: exemptionApplied > 0,
          points_earned: pointsEarned,
          status: "completed",
        })
        .select()
        .single();

      if (txError || !txRecord) throw new Error(`Failed to create transaction: ${txError?.message}`);

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
            charge_reference_id: txRecord.id,
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
            charge_reference_id: txRecord.id,
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
            charge_reference_id: txRecord.id,
          });
        }
      }

      // Award points after txRecord exists, using txRecord.id as reference_id (1:1 match for clawback)
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
            const { error: ptsTxError } = await supabase.from("toursred_points_transactions").insert({
              wallet_id: walletId,
              user_id: user.id,
              amount: pointsEarned,
              balance_after: newBalance,
              type: "earned",
              description: `Puntos por abono: ${tourName} (${bookingCode})`,
              reference_id: txRecord.id,
              reference_type: "payment_plan",
              expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
            });
            if (ptsTxError) {
              console.error(`Error inserting points transaction for plan ${plan_id}: ${ptsTxError.message}`);
            } else {
              await supabase.from("toursred_points_wallets").update({
                balance: newBalance,
                total_earned: pWallet.total_earned + pointsEarned,
              }).eq("id", walletId);
            }
          }
        }
      }

      // Create allocations
      if (allocations.length > 0) {
        await supabase.from("booking_payment_plan_transaction_allocations").insert(
          allocations.map((a) => ({
            transaction_id: txRecord.id,
            installment_id: a.installment_id,
            amount_allocated: a.amount_allocated,
          }))
        );
      }

      // Update each installment based on allocation
      for (const alloc of allocations) {
        const inst = installments!.find((i) => i.id === alloc.installment_id)!;
        const totalPaid = parseFloat((Number(inst.amount_paid) + alloc.amount_allocated).toFixed(2));
        const totalDue = parseFloat((Number(inst.amount_due) + Number(inst.penalty_applied)).toFixed(2));
        const newStatus = totalPaid >= totalDue ? "paid" : "partially_paid";
        await supabase.from("booking_payment_plan_installments").update({
          amount_paid: totalPaid,
          status: newStatus,
          ...(newStatus === "paid" ? { paid_at: new Date().toISOString() } : {}),
          updated_at: new Date().toISOString(),
        }).eq("id", alloc.installment_id);
      }

      // Update plan totals
      const newTotalPaid = parseFloat((Number(plan.total_amount_paid) + effectiveAmount).toFixed(2));
      const planComplete = newTotalPaid >= Number(plan.total_plan_amount);
      await supabase.from("booking_payment_plans").update({
        total_amount_paid: newTotalPaid,
        status: planComplete ? "completed" : "active",
        updated_at: new Date().toISOString(),
      }).eq("id", plan_id);

      // Update bookings.payment_plan_paid
      await supabase.from("bookings").update({
        payment_plan_paid: newTotalPaid,
        payment_plan_status: planComplete ? "completed" : "active",
        updated_at: new Date().toISOString(),
      }).eq("id", booking.id);

      // Trigger CFDI generation for each newly-paid installment
      if (platformSettings?.pac_provider && platformSettings.pac_provider !== "none" && platformSettings.pac_api_key_encrypted) {
        for (const alloc of allocations) {
          const inst = installments!.find((i) => i.id === alloc.installment_id)!;
          const instAfterPaid = parseFloat((Number(inst.amount_paid) + alloc.amount_allocated).toFixed(2));
          const instTotalDue = parseFloat((Number(inst.amount_due) + Number(inst.penalty_applied)).toFixed(2));
          if (instAfterPaid >= instTotalDue) {
            EdgeRuntime.waitUntil(
              fetch(`${supabaseUrl}/functions/v1/generate-booking-installment-cfdi`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
                body: JSON.stringify({
                  installment_id: alloc.installment_id,
                  transaction_id: txRecord.id,
                }),
              }).catch((err) => console.error('Error generating installment CFDI:', err.message, err.stack))
            );
          }
        }
      }

      return { pointsEarned, transactionId: txRecord.id };
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

      const { error: walletError } = await supabase.rpc("update_wallet_balance", {
        p_user_id: user.id,
        p_amount: -totalToPay,
        p_type: "debit",
        p_description: `Abono a plan de pago: ${tourName} (${bookingCode})`,
        p_reference_id: plan_id,
        p_reference_type: "payment_plan",
      });

      if (walletError) {
        return new Response(JSON.stringify({ error: "Error al procesar el pago con ToursRed Cash" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { pointsEarned } = await finalizePayment("toursred_cash", null);
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

      const { error: deductError } = await supabase.rpc("deduct_points", {
        p_user_id: user.id,
        p_amount: pointsNeeded,
        p_description: `Abono a plan de pago: ${tourName} (${bookingCode})`,
        p_reference_id: plan_id,
        p_reference_type: "payment_plan",
      });

      if (deductError) {
        return new Response(JSON.stringify({ error: "Error al procesar el pago con puntos" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await finalizePayment("points", null);
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
      if (!mp_form_data) {
        const { pointsEarned } = await finalizePayment("mercadopago", null);
        return new Response(JSON.stringify({
          success: true,
          amount_paid: effectiveAmount,
          total_charged: totalToPay,
          points_earned: pointsEarned,
          message: "Pago con MercadoPago confirmado.",
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") || platformSettings?.mercadopago_access_token;
      if (!mpAccessToken) {
        return new Response(JSON.stringify({ error: "MercadoPago no configurado" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const mpPayload = {
        ...mp_form_data,
        transaction_amount: totalToPay,
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

    // 6. Bank transfer / Cash (registered by admin)
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
