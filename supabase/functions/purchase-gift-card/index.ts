import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@22.3.0";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PurchaseGiftCardRequest {
  amount: number;
  purchaserEmail: string;
  purchaserName: string;
  recipientEmail?: string;
  recipientName?: string;
  personalMessage?: string;
  scheduledSendDate?: string;
  discountCode?: string;
  provider?: string;
  createOnly?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");

    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;

    if (authHeader) {
      try {
        const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
          global: {
            headers: { Authorization: authHeader },
          },
        });
        const { data: { user } } = await supabaseClient.auth.getUser();
        userId = user?.id || null;
      } catch (authError) {
        console.log("No authenticated user found");
      }
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const requestData: PurchaseGiftCardRequest = await req.json();
    const {
      amount,
      purchaserEmail,
      purchaserName,
      recipientEmail,
      recipientName,
      personalMessage,
      scheduledSendDate,
      discountCode,
      provider,
      createOnly,
    } = requestData;

    if (!amount || ![100, 200, 500, 1000].includes(amount)) {
      return new Response(
        JSON.stringify({ error: "Invalid amount. Must be 100, 200, 500, or 1000" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!purchaserEmail || !purchaserName) {
      return new Response(
        JSON.stringify({ error: "Purchaser email and name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let finalAmount = amount;
    let discountAmount = 0;
    let validatedDiscountCode = null;

    if (discountCode) {
      if (!userId) {
        return new Response(
          JSON.stringify({
            error: "Para usar un código de descuento debes iniciar sesión primero",
            requiresAuth: true
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: validationData, error: validationError } = await supabase.rpc('validate_discount_code', {
        p_code: discountCode,
        p_user_id: userId,
        p_applicable_to: 'gift_cards'
      });

      if (validationError) {
        console.error("Error validating discount code:", validationError);
        return new Response(
          JSON.stringify({ error: "Error al validar el código de descuento" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (validationData && validationData.error) {
        return new Response(
          JSON.stringify({ error: validationData.error }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!validationError && validationData && !validationData.error) {
        if (validationData.discount_type === 'gift_card_percentage') {
          discountAmount = Math.round((amount * validationData.discount_value) / 100 * 100) / 100;
        } else if (validationData.discount_type === 'gift_card_fixed') {
          discountAmount = Math.min(validationData.discount_value, amount);
        }

        finalAmount = Math.max(0, amount - discountAmount);
        validatedDiscountCode = discountCode;
      }
    }

    const code = await generateGiftCardCode(supabase);
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const isPendingPayment = createOnly && (provider === "paypal" || provider === "mercadopago");

    const { data: giftCard, error: insertError } = await supabase
      .from("gift_cards")
      .insert({
        code,
        amount,
        currency: "MXN",
        status: isPendingPayment ? "pending_payment" : "active",
        payment_status: isPendingPayment ? "pending" : "paid",
        payment_provider: provider || "stripe",
        purchaser_email: purchaserEmail,
        purchaser_name: purchaserName,
        recipient_email: recipientEmail || null,
        recipient_name: recipientName || null,
        personal_message: personalMessage || null,
        scheduled_send_date: scheduledSendDate || null,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error creating gift card:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create gift card" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (finalAmount === 0) {
      if (validatedDiscountCode && userId) {
        const { data: discountCodeData } = await supabase
          .from("discount_codes")
          .select("id, times_used")
          .eq("code", validatedDiscountCode)
          .single();

        if (discountCodeData) {
          await supabase
            .from("discount_code_usage")
            .insert({
              discount_code_id: discountCodeData.id,
              user_id: userId,
              gift_card_id: giftCard.id,
            });

          await supabase
            .from("discount_codes")
            .update({ times_used: (discountCodeData.times_used || 0) + 1 })
            .eq("id", discountCodeData.id);
        }
      }

      const origin = req.headers.get("origin") || req.headers.get("referer")?.split("/").slice(0, 3).join("/") || "";

      return new Response(
        JSON.stringify({
          url: `${origin}/gift-card/success?gift_card_id=${giftCard.id}&free=true`,
          giftCardId: giftCard.id,
          isFree: true,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (createOnly) {
      return new Response(
        JSON.stringify({
          giftCardId: giftCard.id,
          amount: finalAmount,
          originalAmount: amount,
          discountAmount,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!stripeSecretKey) {
      throw new Error("Stripe secret key not configured");
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2026-06-24.dahlia",
    });

    let customerId: string;
    const existingCustomers = await stripe.customers.list({
      email: purchaserEmail,
      limit: 1
    });

    if (existingCustomers.data.length > 0) {
      customerId = existingCustomers.data[0].id;
    } else {
      const customer = await stripe.customers.create({
        email: purchaserEmail,
        name: purchaserName,
        metadata: {
          source: 'gift_card_purchase'
        },
      });
      customerId = customer.id;
    }

    const stripeAmount = Math.round(finalAmount * 100);

    let productName = `Tarjeta de Regalo ToursRed - $${amount} MXN`;
    let productDescription = recipientEmail
      ? `Regalo para: ${recipientEmail}`
      : "Tarjeta de regalo digital";

    if (discountAmount > 0) {
      productName = `Tarjeta de Regalo ToursRed - $${amount} MXN (Descuento aplicado: ${validatedDiscountCode})`;
      productDescription = `${productDescription} | Precio original: $${amount} MXN | Descuento: -$${discountAmount} MXN`;
    }

    const lineItems: any[] = [
      {
        price_data: {
          currency: "mxn",
          product_data: {
            name: productName,
            description: productDescription,
          },
          unit_amount: stripeAmount,
        },
        quantity: 1,
      },
    ];

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card", "oxxo", "customer_balance"],
      payment_method_options: {
        customer_balance: {
          funding_type: "bank_transfer",
          bank_transfer: {
            type: "mx_bank_transfer",
          },
        },
      },
      line_items: lineItems,
      mode: "payment",
      success_url: `${req.headers.get("origin")}/gift-card/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.get("origin")}/gift-cards`,
      metadata: {
        gift_card_id: giftCard.id,
        gift_card_code: code,
        type: "gift_card",
        discount_code: validatedDiscountCode || "",
        discount_amount: discountAmount.toString(),
      },
      payment_intent_data: {
        metadata: {
          gift_card_id: giftCard.id,
          gift_card_code: code,
          type: "gift_card",
          discount_code: validatedDiscountCode || "",
          discount_amount: discountAmount.toString(),
        },
      },
    });

    await supabase
      .from("gift_cards")
      .update({
        stripe_checkout_session_id: session.id,
      })
      .eq("id", giftCard.id);

    return new Response(
      JSON.stringify({
        sessionId: session.id,
        url: session.url,
        giftCardId: giftCard.id,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in purchase-gift-card function:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function generateGiftCardCode(supabase: any): Promise<string> {
  const { data, error } = await supabase.rpc("generate_gift_card_code");

  if (error) {
    console.error("Error generating gift card code:", error);
    throw new Error("Failed to generate unique gift card code");
  }

  return data;
}
