import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
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
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function getPayPalAccessToken(clientId: string, clientSecret: string, sandbox: boolean): Promise<string> {
  const base = sandbox
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    const { bookingId, amount: bodyAmount, description, context, extrasBody, plan_id, effective_amount, pay_full_balance } = await req.json();

    let ppUser: { id: string } | null = null;
    if (context !== "gift_card") {
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "No autorizado" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: { user: authedUser }, error: userError } = await supabase.auth.getUser(
        authHeader.replace("Bearer ", "")
      );
      if (userError || !authedUser) {
        return new Response(JSON.stringify({ error: "No autorizado" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      ppUser = authedUser;
    }

    const isPlanInstallment = context === "payment_plan_installment";
    if (isPlanInstallment ? !plan_id : !bookingId) {
      return new Response(JSON.stringify({ error: "Datos incompletos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Validación de monto server-side, nunca se confía en bodyAmount directamente ---
    let amount: number;

    if (context === "gift_card") {
      const { data: gc, error: gcErr } = await supabase
        .from("gift_cards")
        .select("amount, discount_amount, payment_status")
        .eq("id", bookingId)
        .maybeSingle();
      if (gcErr || !gc) {
        return new Response(JSON.stringify({ error: "Tarjeta de regalo no encontrada" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (gc.payment_status === "paid") {
        return new Response(JSON.stringify({ error: "Esta tarjeta de regalo ya fue pagada" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      amount = Number(gc.amount) - Number(gc.discount_amount || 0);
    } else if (context === "supplement") {
      const { data: supp, error: suppErr } = await supabase
        .from("booking_supplements")
        .select("total_paid, booking_id")
        .eq("id", bookingId)
        .maybeSingle();
      if (suppErr || !supp) {
        return new Response(JSON.stringify({ error: "Suplemento no encontrado" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: suppBooking } = await supabase.from("bookings").select("user_id").eq("id", supp.booking_id).maybeSingle();
      if (!suppBooking || suppBooking.user_id !== ppUser?.id) {
        return new Response(JSON.stringify({ error: "No tienes permiso sobre este suplemento" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      amount = Number(supp.total_paid);
    } else if (context === "extras" || context === "payment_plan_installment") {
      amount = Number(bodyAmount);
      if (!amount || amount <= 0) {
        return new Response(JSON.stringify({ error: "Monto inválido" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      const { data: booking, error: bookingErr } = await supabase
        .from("bookings")
        .select("amount_due_now, deposit_amount, payment_status")
        .eq("id", bookingId)
        .maybeSingle();
      if (bookingErr || !booking) {
        return new Response(JSON.stringify({ error: "Reserva no encontrada" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (booking.payment_status === "succeeded") {
        return new Response(JSON.stringify({ error: "La reserva ya está pagada" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: existingPayments } = await supabase
        .from("payment_transactions")
        .select("amount")
        .eq("booking_id", bookingId)
        .eq("status", "succeeded")
        .eq("payment_processor", "paypal");
      const alreadyPaid = (existingPayments || []).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
      // Ver nota en create-openpay-checkout: el techo es el exigible, no el anticipo.
      const dueNow = booking.amount_due_now != null
        ? Number(booking.amount_due_now)
        : Number(booking.deposit_amount);
      const remainingBalance = Math.max(0, dueNow - alreadyPaid);
      if (remainingBalance <= 0) {
        return new Response(JSON.stringify({ error: "Esta reserva ya está pagada en su totalidad" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const requestedAmount = bodyAmount != null ? Number(bodyAmount) : null;
      if (requestedAmount != null && requestedAmount > 0) {
        if (requestedAmount > remainingBalance + 0.5) {
          return new Response(JSON.stringify({ error: `El monto excede el saldo restante de ${remainingBalance.toFixed(2)} MXN` }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        amount = requestedAmount;
      } else {
        amount = remainingBalance;
      }
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
      return new Response(JSON.stringify({ error: "PayPal no configurado" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const origin = req.headers.get("origin") || "https://toursred.com";
    const base = isSandbox
      ? "https://api-m.sandbox.paypal.com"
      : "https://api-m.paypal.com";

    let returnUrl = "";
    let cancelUrl = "";

    if (context === "gift_card") {
      returnUrl = `${origin}/payment-return?provider=paypal&gift_card_id=${bookingId}&status=success`;
      cancelUrl = `${origin}/gift-cards`;
    } else if (context === "supplement") {
      returnUrl = `${origin}/payment-return?provider=paypal&booking_supplement_id=${bookingId}&status=success`;
      cancelUrl = `${origin}/traveler/bookings`;
    } else if (context === 'extras') {
      const extraType = extrasBody?.type || 'insurance';
      let returnParams = `provider=paypal&booking_id=${bookingId}&extra_type=${extraType}&tr_status=success`;
      if (extraType === 'optional_service' && extrasBody?.tour_optional_service_id) {
        returnParams += `&tour_optional_service_id=${extrasBody.tour_optional_service_id}&quantity=${extrasBody.quantity || 1}`;
      }
      returnUrl = `${origin}/payment-return?${returnParams}`;
      cancelUrl = `${origin}/traveler/bookings`;
    } else if (context === "payment_plan_installment") {
      const payAmt = effective_amount ?? amount;
      let returnParams = `provider=paypal&context=payment_plan_installment&plan_id=${plan_id}&amount=${payAmt}&tr_status=success`;
      if (pay_full_balance) returnParams += `&pay_full_balance=true`;
      returnUrl = `${origin}/payment-return?${returnParams}`;
      cancelUrl = `${origin}/traveler/bookings`;
    } else {
      returnUrl = `${origin}/payment-return?provider=paypal&booking_id=${bookingId}&tr_status=success`;
      cancelUrl = `${origin}/payment-return?provider=paypal&booking_id=${bookingId}&tr_status=cancel`;
    }

    const accessToken = await getPayPalAccessToken(paypalClientId, paypalClientSecret, isSandbox);

    const orderPayload = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: bookingId,
          description: description || "ToursRed",
          amount: {
            currency_code: "MXN",
            value: (Math.round(amount * 100) / 100).toFixed(2),
          },
        },
      ],
      application_context: {
        brand_name: "ToursRed",
        locale: "es-MX",
        landing_page: "BILLING",
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    };

    const orderResponse = await fetch(`${base}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(orderPayload),
    });

    if (!orderResponse.ok) {
      const errorBody = await orderResponse.text();
      console.error("PayPal API error:", errorBody);
      return new Response(JSON.stringify({ error: "Error al crear orden de PayPal" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const order = await orderResponse.json();
    const approveLink = order.links?.find((l: any) => l.rel === "approve")?.href;

    if (!approveLink) {
      return new Response(JSON.stringify({ error: "No se pudo obtener URL de PayPal" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (context === "gift_card") {
      await supabase
        .from("gift_cards")
        .update({ paypal_order_id: order.id })
        .eq("id", bookingId);
    } else if (context !== "supplement" && context !== "extras" && context !== "payment_plan_installment") {
      await supabase
        .from("bookings")
        .update({ paypal_order_id: order.id })
        .eq("id", bookingId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        url: approveLink,
        order_id: order.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Error in create-paypal-order:", err);
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
