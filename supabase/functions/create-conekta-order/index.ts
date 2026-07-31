import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SubCharge {
  amount: number;
  payment_method_type: "card" | "cash" | "spei";
  token_id?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "No autorizado" }, 401);
    }

    const { data: { user }, error: userErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userErr || !user) {
      return jsonResponse({ error: "No autorizado" }, 401);
    }

    const {
      booking_id,
      amount,
      payment_method_type,
      bnpl_product_type,
      sub_charges,
      context = "booking_deposit",
      charge_reference_id,
      description,
    } = await req.json();

    if (!booking_id || !amount || !payment_method_type) {
      return jsonResponse({ error: "Datos incompletos: booking_id, amount y payment_method_type son requeridos" }, 400);
    }

    if (!["bnpl", "card", "cash", "spei"].includes(payment_method_type)) {
      return jsonResponse({ error: "payment_method_type debe ser bnpl, card, cash o spei" }, 400);
    }

    if (payment_method_type === "bnpl") {
      if (bnpl_product_type && !["aplazo_bnpl", "creditea_bnpl", "coppel_bnpl"].includes(bnpl_product_type)) {
        return jsonResponse({ error: "bnpl_product_type inválido" }, 400);
      }
      if (amount < 1200) {
        return jsonResponse({ error: "El monto mínimo para BNPL es $1,200 MXN" }, 400);
      }
      if (amount > 16000) {
        return jsonResponse({ error: "El monto máximo para BNPL es $16,000 MXN por línea de pago" }, 400);
      }
    }

    // Validate sub_charges for split native orders
    if (sub_charges && Array.isArray(sub_charges)) {
      if (payment_method_type === "bnpl") {
        return jsonResponse({ error: "No se puede combinar BNPL con split nativo" }, 400);
      }
      if (sub_charges.length < 2) {
        return jsonResponse({ error: "Se requieren al menos 2 sub-cargos para un split" }, 400);
      }
      const subTotal = sub_charges.reduce((sum: number, sc: SubCharge) => sum + sc.amount, 0);
      if (Math.abs(subTotal - amount) > 0.01) {
        return jsonResponse({ error: "Los sub-cargos deben sumar exactamente el monto total" }, 400);
      }
      for (const sc of sub_charges) {
        if (!["card", "cash", "spei"].includes(sc.payment_method_type)) {
          return jsonResponse({ error: "Sub-cargo payment_method_type debe ser card, cash o spei" }, 400);
        }
      }
    }

    // Fetch user profile for customer_info (Conekta requires name + email on every order)
    const { data: userProfile } = await supabase
      .from("users")
      .select("first_name, last_name, phone_number")
      .eq("id", user.id)
      .maybeSingle();

    const customerName = `${userProfile?.first_name || ""} ${userProfile?.last_name || ""}`.trim() || "Cliente";
    const customerEmail = user.email || "no-email@toursred.com";
    const customerPhone = userProfile?.phone_number || null;

    const customerInfo: Record<string, string> = {
      name: customerName,
      email: customerEmail,
    };
    if (customerPhone) {
      customerInfo.phone = customerPhone;
    }

    const conektaPrivateKey = Deno.env.get("CONEKTA_PRIVATE_KEY");
    if (!conektaPrivateKey) {
      return jsonResponse({ error: "Conekta no configurado" }, 500);
    }

    // Check for existing pending order for this booking + line
    const idempotencyKey = `${booking_id}_${context}_${charge_reference_id || "deposit"}_${Date.now()}`;
    const { data: existingPending } = await supabase
      .from("payment_transactions")
      .select("id, conekta_order_id")
      .eq("booking_id", booking_id)
      .eq("payment_processor", "conekta")
      .eq("status", "pending")
      .maybeSingle();

    if (existingPending) {
      return jsonResponse({
        error: "Ya existe una orden de pago pendiente para esta reserva. Completa o cancela el pago pendiente antes de crear uno nuevo.",
        existing_order_id: existingPending.conekta_order_id,
      }, 409);
    }

    const origin = req.headers.get("origin") || "https://toursred.com";
    const successUrl = `${origin}/payment-return?provider=conekta&booking_id=${booking_id}&status=success&context=${context}`;
    const failureUrl = `${origin}/payment-return?provider=conekta&booking_id=${booking_id}&status=failure&context=${context}`;
    const cancelUrl = `${origin}/payment-return?provider=conekta&booking_id=${booking_id}&status=cancel&context=${context}`;

    const amountInCents = Math.round(amount * 100);

    // Build Conekta order payload
    let orderPayload: any;

    if (payment_method_type === "bnpl") {
      orderPayload = {
        currency: "MXN",
        amount: amountInCents,
        customer_info: customerInfo,
        line_items: [
          {
            name: description || "Reserva ToursRed",
            unit_price: amountInCents,
            quantity: 1,
            tags: ["bnpl"],
          },
        ],
        checkout: {
          type: "HostedPayment",
          allowed_payment_methods: ["bnpl"],
          success_url: successUrl,
          failure_url: failureUrl,
          cancel_url: cancelUrl,
          expires_at: Math.floor(Date.now() / 1000) + 71 * 3600,
        },
        metadata: {
          booking_id,
          payment_method_type: "bnpl",
          context,
          charge_reference_id: charge_reference_id || "",
        },
      };
    } else if (sub_charges && sub_charges.length >= 2) {
      // Split native order (card+cash+spei) — uses charges array with individual payment methods
      const chargesPayload = sub_charges.map((sc: SubCharge) => {
        const chargeAmount = Math.round(sc.amount * 100);
        if (sc.payment_method_type === "card") {
          if (!sc.token_id) {
            throw new Error("Sub-cargo tipo card requiere token_id (token de tarjeta)");
          }
          return {
            amount: chargeAmount,
            payment_method: {
              type: "card",
              token_id: sc.token_id,
            },
          };
        }
        return {
          amount: chargeAmount,
          payment_method: {
            type: sc.payment_method_type,
            expires_at: Math.floor(Date.now() / 1000) + 72 * 3600,
          },
        };
      });

      orderPayload = {
        currency: "MXN",
        amount: amountInCents,
        customer_info: customerInfo,
        line_items: [
          {
            name: description || "Reserva ToursRed",
            unit_price: amountInCents,
            quantity: 1,
            tags: ["split"],
          },
        ],
        charges: chargesPayload,
        metadata: {
          booking_id,
          payment_method_type: "split",
          context,
          charge_reference_id: charge_reference_id || "",
          sub_charges: sub_charges.map((sc: SubCharge) => ({
            amount: sc.amount,
            payment_method_type: sc.payment_method_type,
          })),
        },
      };
    } else {
      // Single method: card, cash, or spei
      orderPayload = {
        currency: "MXN",
        amount: amountInCents,
        customer_info: customerInfo,
        line_items: [
          {
            name: description || "Reserva ToursRed",
            unit_price: amountInCents,
            quantity: 1,
          },
        ],
        checkout: {
          type: "HostedPayment",
          allowed_payment_methods: [payment_method_type],
          success_url: successUrl,
          failure_url: failureUrl,
          cancel_url: cancelUrl,
          expires_at: Math.floor(Date.now() / 1000) + 71 * 3600,
        },
        metadata: {
          booking_id,
          payment_method_type,
          context,
          charge_reference_id: charge_reference_id || "",
        },
      };
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
      const errorBody = await apiResponse.text();
      console.error("Conekta API error:", errorBody);
      let errorMsg = "Error al crear orden de Conekta";
      try {
        const parsed = JSON.parse(errorBody);
        errorMsg = parsed?.details?.[0]?.message || parsed?.message || errorMsg;
      } catch {}
      return jsonResponse({ error: errorMsg }, 500);
    }

    const order = await apiResponse.json();
    const orderId = order.id;
    const checkoutUrl = order.checkout?.url;

    if (!orderId) {
      console.error("Conekta response missing order id:", JSON.stringify(order));
      return jsonResponse({ error: "Respuesta inválida de Conekta" }, 500);
    }

    // For split orders, extract per-charge payment instructions from the response
    let splitChargeDetails: Array<{
      payment_method_type: string;
      amount: number;
      status: string;
      clabe?: string;
      bank?: string;
      reference?: string;
      barcode_url?: string;
      expires_at?: number;
      token_id?: string;
    }> = [];

    const isSplitOrder = !!(sub_charges && sub_charges.length >= 2);

    if (isSplitOrder && order.charges && Array.isArray(order.charges.data)) {
      splitChargeDetails = order.charges.data.map((charge: any) => {
        const pm = charge.payment_method || {};
        const detail: any = {
          payment_method_type: pm.type || charge.payment_method_type || "unknown",
          amount: charge.amount / 100,
          status: charge.status || "pending",
        };
        if (pm.type === "spei" || pm.type === "bank_transfer") {
          detail.clabe = pm.clabe || pm.bank_account_number;
          detail.bank = pm.bank;
          detail.expires_at = pm.expires_at;
        }
        if (pm.type === "cash" || pm.type === "oxxo_cash" || pm.type === "cash_on_delivery") {
          detail.reference = pm.reference || pm.cash_on_delivery_reference;
          detail.barcode_url = pm.barcode_url || pm.reference_url;
          detail.expires_at = pm.expires_at;
        }
        if (pm.type === "card" && pm.token_id) {
          detail.token_id = pm.token_id;
        }
        return detail;
      });
    }

    // Insert payment_transactions record
    const { error: txInsertErr } = await supabase.from("payment_transactions").insert({
      booking_id,
      stripe_payment_intent_id: null,
      amount,
      currency: "mxn",
      status: "pending",
      payment_method_type: sub_charges ? "split" : payment_method_type,
      payment_processor: "conekta",
      processor_fee: 0,
      net_amount: amount,
      conekta_order_id: orderId,
      bnpl_product_type: null,
      p_idempotency_key: idempotencyKey,
      charge_context: context,
      charge_reference_id: charge_reference_id || null,
      metadata: {
        conekta_order: order,
        checkout_url: checkoutUrl,

        sub_charges: sub_charges || undefined,
      },
    });

    if (txInsertErr) {
      console.error("Error inserting payment_transactions:", txInsertErr);
    }

    // Insert sub-charge records for split native orders
    if (sub_charges && sub_charges.length >= 2) {
      // Fetch the transaction we just created
      const { data: newTx } = await supabase
        .from("payment_transactions")
        .select("id")
        .eq("conekta_order_id", orderId)
        .maybeSingle();

      if (newTx) {
        const chargeRows = sub_charges.map((sc: SubCharge) => ({
          payment_transaction_id: newTx.id,
          payment_method_type: sc.payment_method_type,
          amount: sc.amount,
          status: "pending",
        }));
        await supabase.from("payment_transaction_charges").insert(chargeRows);
      }
    }

    // Set booking status to payment_pending_bnpl for BNPL orders
    if (payment_method_type === "bnpl" && context === "booking_deposit") {
      await supabase
        .from("bookings")
        .update({ status: "payment_pending_bnpl" })
        .eq("id", booking_id);
    }

    return jsonResponse({
      success: true,
      order_id: orderId,
      checkout_url: checkoutUrl,
      payment_method_type: sub_charges ? "split" : payment_method_type,
      is_split: !!(sub_charges && sub_charges.length >= 2),
      split_charges: splitChargeDetails.length > 0 ? splitChargeDetails : undefined,
    });
  } catch (err: any) {
    console.error("Error in create-conekta-order:", err);
    return jsonResponse({ error: err.message || "Error interno" }, 500);
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
