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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate the calling user
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { slot_id, provider, success_url, cancel_url, discount_code } = await req.json();

    if (!slot_id || !provider) {
      return new Response(
        JSON.stringify({ error: "slot_id and provider are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load slot + plan + agency info
    const { data: slot, error: slotErr } = await supabase
      .from("featured_tour_slots")
      .select(`
        id, agency_id, plan_id, status, total_amount,
        featured_plans (name, price),
        agencies (name, user_id),
        tours (name)
      `)
      .eq("id", slot_id)
      .eq("status", "pending_payment")
      .maybeSingle();

    if (slotErr || !slot) {
      return new Response(
        JSON.stringify({ error: "Slot not found or not in pending_payment status" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Ensure the calling user belongs to this agency
    const agency = slot.agencies as Record<string, unknown>;
    if ((agency?.user_id as string) !== user.id) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const plan = slot.featured_plans as Record<string, unknown>;
    const tour = slot.tours as Record<string, unknown>;
    const baseAmount = Number(slot.total_amount ?? (plan?.price as number) ?? 0);
    const planName = (plan?.name as string) ?? "Plan Destacado";
    const tourName = (tour?.name as string) ?? "Tour";
    const description = `Tour Destacado — ${tourName} (${planName})`;

    // Apply discount code if provided
    let finalAmount = baseAmount;
    let discountAmount = 0;
    let appliedDiscountCodeId: string | null = null;

    if (discount_code && discount_code.trim()) {
      const { data: validationResult, error: validErr } = await supabase.rpc(
        "validate_featured_slot_discount",
        { p_code: discount_code.trim(), p_user_id: user.id }
      );

      if (validErr || !validationResult?.valid) {
        return new Response(
          JSON.stringify({ error: validationResult?.error ?? "Código de descuento inválido" }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const discountType: string = validationResult.discount_type;
      const discountValue = Number(validationResult.discount_value);

      if (discountType === "featured_percentage") {
        discountAmount = Math.min(baseAmount, (baseAmount * discountValue) / 100);
      } else if (discountType === "featured_fixed") {
        discountAmount = Math.min(baseAmount, discountValue);
      }

      finalAmount = Math.max(0, baseAmount - discountAmount);
      appliedDiscountCodeId = validationResult.code_id as string;

      // Record usage and update slot with discount info
      const { error: applyErr } = await supabase.rpc("apply_discount_code", {
        p_code: discount_code.trim(),
        p_user_id: user.id,
      });

      if (!applyErr) {
        // Update the slot with discount traceability
        await supabase
          .from("featured_tour_slots")
          .update({
            discount_code_id: appliedDiscountCodeId,
            discount_amount: discountAmount,
          })
          .eq("id", slot_id);
      }
    }

    const appUrl = success_url?.split("/agency")[0] ?? Deno.env.get("APP_URL") ?? "https://toursred.com";
    const successUrl = success_url ?? `${appUrl}/agency/featured-slot-success?slot_id=${slot_id}`;
    const cancelUrl  = cancel_url  ?? `${appUrl}/agency/tours`;

    if (provider === "stripe") {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) {
        return new Response(
          JSON.stringify({ error: "Stripe not configured" }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const stripe = new Stripe(stripeKey, { apiVersion: "2026-06-24.dahlia" });

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        currency: "mxn",
        line_items: [
          {
            price_data: {
              currency: "mxn",
              product_data: { name: description },
              unit_amount: Math.round(finalAmount * 100),
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          metadata: {
            featured_slot_id: slot_id,
            agency_id: slot.agency_id,
            plan_name: planName,
          },
        },
        metadata: { featured_slot_id: slot_id },
        success_url: successUrl + (successUrl.includes("?") ? "&" : "?") + "session_id={CHECKOUT_SESSION_ID}",
        cancel_url: cancelUrl,
      });

      return new Response(
        JSON.stringify({ provider: "stripe", url: session.url, session_id: session.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (provider === "mercadopago") {
      const { data: settings } = await supabase
        .from("platform_settings")
        .select("mercadopago_access_token")
        .maybeSingle();

      if (!settings?.mercadopago_access_token) {
        return new Response(
          JSON.stringify({ error: "MercadoPago not configured" }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.mercadopago_access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: [
            {
              title: description,
              quantity: 1,
              unit_price: finalAmount,
              currency_id: "MXN",
            },
          ],
          external_reference: slot_id,
          notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mercadopago-webhook`,
          back_urls: {
            success: successUrl,
            failure: cancelUrl,
            pending: cancelUrl,
          },
          auto_return: "approved",
          metadata: { featured_slot_id: slot_id },
        }),
      });

      if (!mpRes.ok) {
        const err = await mpRes.text();
        throw new Error(`MercadoPago error: ${err}`);
      }

      const mpData = await mpRes.json();
      return new Response(
        JSON.stringify({ provider: "mercadopago", url: mpData.init_point, preference_id: mpData.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (provider === "paypal") {
      const { data: settings } = await supabase
        .from("platform_settings")
        .select("paypal_client_id, paypal_client_secret, paypal_sandbox")
        .maybeSingle();

      if (!settings?.paypal_client_id || !settings?.paypal_client_secret) {
        return new Response(
          JSON.stringify({ error: "PayPal not configured" }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const paypalBase = settings.paypal_sandbox
        ? "https://api-m.sandbox.paypal.com"
        : "https://api-m.paypal.com";

      const tokenRes = await fetch(`${paypalBase}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${settings.paypal_client_id}:${settings.paypal_client_secret}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });

      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;

      const orderRes = await fetch(`${paypalBase}/v2/checkout/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              amount: { currency_code: "MXN", value: finalAmount.toFixed(2) },
              description,
              custom_id: slot_id,
            },
          ],
          application_context: {
            return_url: successUrl,
            cancel_url: cancelUrl,
          },
        }),
      });

      const orderData = await orderRes.json();
      const approvalLink = orderData.links?.find((l: { rel: string; href: string }) => l.rel === "approve")?.href;

      return new Response(
        JSON.stringify({ provider: "paypal", url: approvalLink, order_id: orderData.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown provider: ${provider}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
