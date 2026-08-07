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

    const { slot_id, provider, success_url, cancel_url, discount_code, conekta_method, bnpl_product_type, openpay_method } = await req.json();

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

    if (provider === "conekta") {
      const method = conekta_method || "card";
      if (!["card", "cash", "spei", "bnpl"].includes(method)) {
        return new Response(JSON.stringify({ error: "conekta_method debe ser card, cash, spei o bnpl" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (method === "bnpl") {
        if (!bnpl_product_type || !["aplazo_bnpl", "creditea_bnpl", "coppel_bnpl"].includes(bnpl_product_type)) {
          return new Response(JSON.stringify({ error: "bnpl_product_type es requerido para BNPL" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (finalAmount < 1200 || finalAmount > 16000) {
          return new Response(JSON.stringify({ error: "El monto para BNPL debe estar entre $1,200 y $16,000 MXN" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const conektaPrivateKey = Deno.env.get("CONEKTA_PRIVATE_KEY");
      if (!conektaPrivateKey) {
        return new Response(JSON.stringify({ error: "Conekta not configured" }), {
          status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const amountInCents = Math.round(finalAmount * 100);
      const orderPayload: any = {
        currency: "MXN",
        amount: amountInCents,
        customer_info: { name: user.email || "Agencia", email: user.email || "no-email@toursred.com" },
        line_items: [{
          name: description, unit_price: amountInCents, quantity: 1,
          ...(method === "bnpl" ? { tags: ["bnpl"] } : {}),
        }],
        checkout: {
          type: "HostedPayment",
          allowed_payment_methods: [method === "spei" ? "bank_transfer" : method],
          success_url: successUrl + (successUrl.includes("?") ? "&" : "?") + "provider=conekta",
          failure_url: cancelUrl,
          cancel_url: cancelUrl,
          expires_at: Math.floor(Date.now() / 1000) + 71 * 3600,
        },
        metadata: {
          featured_slot_id: slot_id, agency_id: slot.agency_id, plan_name: planName,
          context: "featured_slot",
          ...(method === "bnpl" ? { bnpl_product_type } : {}),
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
        console.error("Conekta API error (featured slot):", errorBody);
        return new Response(JSON.stringify({ error: "Error al crear orden de Conekta" }), {
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

      await supabase
        .from("featured_tour_slots")
        .update({ payment_id: orderId, payment_provider: "conekta" })
        .eq("id", slot_id);

      return new Response(
        JSON.stringify({ provider: "conekta", url: checkoutUrl, order_id: orderId }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (provider === "openpay") {
      if (!openpay_method || !["card", "spei", "cash"].includes(openpay_method)) {
        return new Response(JSON.stringify({ error: "openpay_method debe ser card, spei o cash" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!isOpenpayConfigured()) {
        return new Response(JSON.stringify({ error: "Openpay not configured" }), {
          status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let customerIdOp: string;
      try {
        customerIdOp = await createOrReuseOpenpayCustomer(supabase, user.id, {
          first_name: user.email?.split("@")[0] || "Agencia", email: user.email || "no-email@toursred.com",
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const orderIdOp = `featured_slot_${slot_id}_${Date.now()}`;
      const successUrlOp = `${(success_url?.split("?")[0]) || cancelUrl}?provider=openpay`;
      const roundedAmtFs = Math.round(finalAmount * 100) / 100;

      let chargeOp;
      try {
        if (openpay_method === "spei") {
          chargeOp = await createSpeiCharge(customerIdOp, roundedAmtFs, orderIdOp, description);
        } else if (openpay_method === "cash") {
          chargeOp = await createCashCharge(customerIdOp, roundedAmtFs, orderIdOp, description);
        } else {
          chargeOp = await createCardCheckoutCharge(customerIdOp, roundedAmtFs, orderIdOp, description, successUrlOp, {
            charge_context: "featured_slot", charge_reference_id: slot_id,
          });
        }
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const paymentMethodMetadataFs: Record<string, any> = {
        openpay_method, openpay_charge_id: chargeOp.id, openpay_status: chargeOp.status,
      };
      if (openpay_method === "spei") {
        if (chargeOp.payment_method?.clabe) paymentMethodMetadataFs.clabe = chargeOp.payment_method.clabe;
        if (chargeOp.payment_method?.bank) paymentMethodMetadataFs.bank = chargeOp.payment_method.bank;
        if (chargeOp.payment_method?.name) paymentMethodMetadataFs.reference = chargeOp.payment_method.name;
        paymentMethodMetadataFs.spei_pdf_url = `${getDashboardUrl()}/spei-pdf/${getMerchantId()}/${chargeOp.id}`;
      } else if (openpay_method === "cash") {
        if (chargeOp.payment_method?.reference) paymentMethodMetadataFs.reference = chargeOp.payment_method.reference;
        if (chargeOp.payment_method?.store) paymentMethodMetadataFs.store = chargeOp.payment_method.store;
        if (chargeOp.payment_method?.expiry_date) paymentMethodMetadataFs.expiry_date = chargeOp.payment_method.expiry_date;
        if (chargeOp.payment_method?.barcode_url) paymentMethodMetadataFs.barcode_url = chargeOp.payment_method.barcode_url;
        if (chargeOp.payment_method?.reference) paymentMethodMetadataFs.cash_pdf_url = `${getDashboardUrl()}/paynet-pdf/${getMerchantId()}/${chargeOp.payment_method.reference}`;
      }

      await supabase.from("featured_tour_slots").update({ payment_id: chargeOp.id, payment_provider: "openpay" }).eq("id", slot_id);

      // Los featured slots no tienen payment_transactions (booking_id NOT NULL) — la metadata de
      // pago pendiente (clabe/referencia/PDFs) se guarda directo en featured_tour_slots.
      await supabase.from("featured_tour_slots").update({ pending_payment_metadata: paymentMethodMetadataFs }).eq("id", slot_id);

      return new Response(JSON.stringify({
        provider: "openpay",
        url: openpay_method === "card" ? chargeOp.payment_method?.url : undefined,
        payment_method: openpay_method !== "card" ? chargeOp.payment_method : undefined,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
