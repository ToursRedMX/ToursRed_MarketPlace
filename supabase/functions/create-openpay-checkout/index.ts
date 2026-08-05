import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";
import {
  isConfigured,
  getBaseUrl,
  getDashboardUrl,
  getMerchantId,
  getAuthHeader,
  createOrReuseCustomer,
  createCardCheckoutCharge,
  createSpeiCharge,
  createCashCharge,
} from "../_shared/openpay.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface CheckoutRequest {
  bookingId: string;
  chargeReferenceId?: string;
  amount: number;
  description: string;
  context: "booking" | "supplement" | "gift_card";
  customerEmail?: string;
  customerName?: string;
  redirectUrl?: string;
  method?: "card" | "spei" | "cash";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (!isConfigured()) {
      return new Response(
        JSON.stringify({ error: "OpenPay no está configurado. Contacta al administrador." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // --- Auth verification ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No autorizado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: { user }, error: userErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userErr || !user) {
      return new Response(
        JSON.stringify({ error: "No autorizado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body: CheckoutRequest = await req.json();
    const {
      bookingId,
      chargeReferenceId,
      amount: bodyAmount,
      description,
      context,
      customerEmail,
      customerName,
      redirectUrl,
      method,
    } = body;
    const referenceId = chargeReferenceId || bookingId;
    const paymentMethod = method || "card";

    if (!bookingId) {
      return new Response(
        JSON.stringify({ error: "Faltan parámetros requeridos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- Server-side amount validation based on context ---
    // The amount from the body is NEVER trusted for booking/supplement contexts.
    // The real amount is always queried from the database.
    let amount: number;

    if (context === "booking") {
      const { data: booking, error: bookingErr } = await supabase
        .from("bookings")
        .select("deposit_amount, user_id")
        .eq("id", bookingId)
        .maybeSingle();

      if (bookingErr || !booking) {
        return new Response(
          JSON.stringify({ error: "Reserva no encontrada" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (booking.user_id !== user.id) {
        return new Response(
          JSON.stringify({ error: "No tienes permiso sobre esta reserva" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      amount = Number(booking.deposit_amount);
      if (amount <= 0) {
        return new Response(
          JSON.stringify({ error: "El monto del depósito no es válido" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else if (context === "supplement") {
      const supplementId = chargeReferenceId || bookingId;
      const { data: supplement, error: suppErr } = await supabase
        .from("booking_supplements")
        .select("total_paid, booking_id")
        .eq("id", supplementId)
        .maybeSingle();

      if (suppErr || !supplement) {
        return new Response(
          JSON.stringify({ error: "Suplemento no encontrado" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Verify ownership via the parent booking
      const { data: suppBooking } = await supabase
        .from("bookings")
        .select("user_id")
        .eq("id", supplement.booking_id)
        .maybeSingle();

      if (!suppBooking || suppBooking.user_id !== user.id) {
        return new Response(
          JSON.stringify({ error: "No tienes permiso sobre este suplemento" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      amount = Number(supplement.total_paid);
      if (amount <= 0) {
        return new Response(
          JSON.stringify({ error: "El monto del suplemento no es válido" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else {
      // context === "gift_card" — validate against configured denominations
      const { data: settings } = await supabase
        .from("platform_settings")
        .select("gift_card_amounts, gift_card_max_amount")
        .maybeSingle();

      const validAmounts: number[] = (settings?.gift_card_amounts || [100, 200, 500, 1000]).map(Number);
      const maxAmount: number = settings?.gift_card_max_amount || 10000;
      const requestedAmount = Number(bodyAmount);

      if (requestedAmount <= 0) {
        return new Response(
          JSON.stringify({ error: "Monto de gift card inválido" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (validAmounts.includes(requestedAmount) || requestedAmount <= maxAmount) {
        amount = requestedAmount;
      } else {
        return new Response(
          JSON.stringify({ error: `El monto excede el máximo permitido (${maxAmount})` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const siteUrl = Deno.env.get("SITE_URL") || "https://toursred.com";
    const successUrl = redirectUrl || (
      context === "gift_card"
        ? `${siteUrl}/gift-card-success`
        : context === "supplement"
        ? `${siteUrl}/supplement-success`
        : `${siteUrl}/payment-return?provider=openpay&booking_id=${bookingId}&tr_status=success`
    );

    // Resolve or create an OpenPay customer for card checkout
    let customerId: string | null = null;

    if (context === "booking" || context === "supplement") {
      const { data: userRecord } = await supabase
        .from("users")
        .select("id, first_name, last_name, email, phone_number")
        .eq("id", user.id)
        .maybeSingle();

      if (userRecord) {
        try {
          customerId = await createOrReuseCustomer(supabase, userRecord.id, {
            first_name: userRecord.first_name,
            last_name: userRecord.last_name,
            email: userRecord.email,
            phone_number: userRecord.phone_number,
          });
        } catch (e) {
          console.error("createOrReuseCustomer error:", e);
        }
      }
    }

    const orderId = `${context}_${bookingId}_${Date.now()}`;
    const metadata: Record<string, string> = {
      charge_context: context === "booking" ? "booking_deposit" : context,
      charge_reference_id: referenceId,
    };

    let charge;
    if (paymentMethod === "spei" && customerId) {
      charge = await createSpeiCharge(
        customerId,
        Math.round(amount * 100) / 100,
        orderId,
        description,
      );
    } else if (paymentMethod === "cash" && customerId) {
      charge = await createCashCharge(
        customerId,
        Math.round(amount * 100) / 100,
        orderId,
        description,
      );
    } else if (customerId) {
      charge = await createCardCheckoutCharge(
        customerId,
        Math.round(amount * 100) / 100,
        orderId,
        description,
        successUrl,
        metadata,
      );
    } else {
      // Fallback: merchant-level charge with inline customer (for gift cards)
      const baseUrl = getBaseUrl();
      const merchantId = getMerchantId();
      const auth = getAuthHeader();

      const chargePayload: Record<string, unknown> = {
        method: "card",
        amount: Math.round(amount * 100) / 100,
        currency: "MXN",
        description,
        order_id: orderId,
        confirm: false,
        redirect_url: successUrl,
        metadata,
      };

      if (customerEmail) {
        chargePayload.customer = {
          email: customerEmail,
          name: customerName || undefined,
        };
      }

      const response = await fetch(`${baseUrl}/${merchantId}/charges`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: auth,
        },
        body: JSON.stringify(chargePayload),
      });

      const result = await response.json();

      if (!response.ok) {
        console.error("OpenPay card charge error:", JSON.stringify(result));
        return new Response(
          JSON.stringify({ error: result.description || result.error_message || "Error al crear cargo en OpenPay" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      charge = result;
    }

    const paymentMethodMetadata: Record<string, any> = {
      openpay_method: paymentMethod,
      openpay_charge_id: charge.id,
      openpay_status: charge.status,
    };

    if (paymentMethod === "spei") {
      if (charge.payment_method?.clabe) paymentMethodMetadata.clabe = charge.payment_method.clabe;
      if (charge.payment_method?.bank) paymentMethodMetadata.bank = charge.payment_method.bank;
      if (charge.payment_method?.name) {
        paymentMethodMetadata.reference = charge.payment_method.name;
      }
      paymentMethodMetadata.spei_pdf_url = `${getDashboardUrl()}/spei-pdf/${getMerchantId()}/${charge.id}`;
    } else if (paymentMethod === "cash") {
      if (charge.payment_method?.reference) paymentMethodMetadata.reference = charge.payment_method.reference;
      if (charge.payment_method?.store) paymentMethodMetadata.store = charge.payment_method.store;
      if (charge.payment_method?.expiry_date) paymentMethodMetadata.expiry_date = charge.payment_method.expiry_date;
      if (charge.payment_method?.barcode_url) paymentMethodMetadata.barcode_url = charge.payment_method.barcode_url;
      if (charge.payment_method?.reference) {
        paymentMethodMetadata.cash_pdf_url = `${getDashboardUrl()}/paynet-pdf/${getMerchantId()}/${charge.payment_method.reference}`;
      }
    }

    if (context === "booking" || context === "supplement") {
      await supabase.from("payment_transactions").insert({
        booking_id: bookingId,
        payment_processor: "openpay",
        amount: amount,
        currency: "mxn",
        status: "pending",
        net_amount: amount,
        charge_context: context === "booking" ? "booking_deposit" : context,
        charge_reference_id: referenceId,
        openpay_charge_id: charge.id,
        metadata: paymentMethodMetadata,
      });
    }

    if (context === "gift_card") {
      await supabase.from("payment_transactions").insert({
        payment_processor: "openpay",
        amount: amount,
        currency: "mxn",
        status: "pending",
        net_amount: amount,
        charge_context: "gift_card",
        charge_reference_id: referenceId,
        openpay_charge_id: charge.id,
        metadata: paymentMethodMetadata,
      });
    }

    const checkoutUrl = charge.payment_method?.url || charge.checkout_url;

    const responseData: Record<string, any> = {
      success: true,
      chargeId: charge.id,
      openpayChargeId: charge.id,
      method: paymentMethod,
    };

    if (paymentMethod === "card" && checkoutUrl) {
      responseData.url = checkoutUrl;
    } else if (paymentMethod === "spei" || paymentMethod === "cash") {
      responseData.payment_method = charge.payment_method;
      responseData.status = charge.status;
      if (paymentMethodMetadata.barcode_url) {
        responseData.barcode_url = paymentMethodMetadata.barcode_url;
      }
      if (paymentMethodMetadata.cash_pdf_url) {
        responseData.cash_pdf_url = paymentMethodMetadata.cash_pdf_url;
      }
    }

    return new Response(
      JSON.stringify(responseData),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Error in create-openpay-checkout:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Error interno del servidor" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
