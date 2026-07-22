import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";
import Stripe from "npm:stripe@22.3.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const {
      amount,
      currency = 'mxn',
      description,
      bookingId,
      metadata = {},
      success_url,
      cancel_url,
      addMembership = false,
      membershipPlan = 'monthly',
      toursRedCashUsed = 0,
      pointsUsed = 0
    } = await req.json();

    if (amount == null || !bookingId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required parameters: amount and bookingId are required"
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    if (amount <= 0) {
      return new Response(
        JSON.stringify({ success: false, error: "El monto a cobrar es cero; no se requiere pago con tarjeta." }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      console.error("Stripe secret key is not set");
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Payment configuration is incomplete", 
          details: "stripe_key_missing"
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2026-06-24.dahlia",
    });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "No authorization header" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 401,
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    // Use service role for all database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        id,
        user_id,
        tour_id,
        travelers_count,
        travel_insurance_included,
        travel_insurance_cost,
        deposit_amount,
        service_charge,
        tours (
          id,
          max_travelers,
          available_spots
        )
      `)
      .eq("id", bookingId)
      .single();

    if (bookingError || !booking) {
      console.error("Error fetching booking:", bookingError);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Reserva no encontrada"
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        }
      );
    }

    const { data: existingBookings, error: existingError } = await supabase
      .from("bookings")
      .select("travelers_count, status, approval_status")
      .eq("tour_id", booking.tour_id)
      .in("status", ["confirmed", "pending"])
      .neq("id", bookingId);

    if (existingError) {
      console.error("Error fetching existing bookings:", existingError);
    }

    const totalBooked = existingBookings?.reduce((sum, b) => {
      if (b.status === 'confirmed') return sum + b.travelers_count;
      if (b.status === 'pending' && b.approval_status === 'approved') return sum + b.travelers_count;
      return sum;
    }, 0) || 0;

    const maxCapacity = booking.tours?.available_spots !== null && booking.tours?.available_spots !== undefined
      ? booking.tours.available_spots
      : (booking.tours?.max_travelers || 10);

    const availableSpots = maxCapacity - totalBooked;

    console.log(`🔍 Validando disponibilidad - Tour: ${booking.tour_id}, Solicitados: ${booking.travelers_count}, Disponibles: ${availableSpots}, Total permitido: ${maxCapacity}${booking.tours?.available_spots ? ' [Personalizado]' : ''}`);

    if (booking.travelers_count > availableSpots) {
      console.error(`❌ No hay suficiente disponibilidad - Solicitados: ${booking.travelers_count}, Disponibles: ${availableSpots}`);

      await supabase
        .from("bookings")
        .delete()
        .eq("id", bookingId);

      return new Response(
        JSON.stringify({
          success: false,
          error: `Lo sentimos, solo hay ${availableSpots} lugar${availableSpots !== 1 ? 'es' : ''} disponible${availableSpots !== 1 ? 's' : ''} para este tour. Por favor, intenta con menos viajeros.`,
          available_spots: availableSpots
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    console.log(`✅ Disponibilidad confirmada para la reserva ${bookingId}`);

    let { data: customers, error: customerError } = await supabase
      .from("stripe_customers")
      .select("customer_id")
      .eq("user_id", booking.user_id)
      .maybeSingle();

    if (customerError) {
      console.error("Error fetching customer:", customerError);
    }

    let customerId;

    if (!customers) {
      const { data: userProfile } = await supabase
        .from("users")
        .select("first_name, last_name, email")
        .eq("id", booking.user_id)
        .single();

      const customer = await stripe.customers.create({
        email: userProfile?.email,
        name: userProfile ? `${userProfile.first_name || ''} ${userProfile.last_name || ''}`.trim() : undefined,
        metadata: {
          user_id: booking.user_id,
        },
      });

      customerId = customer.id;

      const { error: insertError } = await supabase
        .from("stripe_customers")
        .insert({
          user_id: booking.user_id,
          customer_id: customer.id,
        });

      if (insertError) {
        console.error("Error saving customer:", insertError);
      }
    } else {
      customerId = customers.customer_id;
    }

    let sessionConfig: any = {
      customer: customerId,
      success_url: success_url || `${req.headers.get("origin")}/booking-success?booking_id=${bookingId}`,
      cancel_url: cancel_url || `${req.headers.get("origin")}/booking-cancel?booking_id=${bookingId}`,
      metadata: {
        booking_id: bookingId,
        membership_purchased: addMembership ? 'true' : 'false',
        membership_plan: membershipPlan,
        toursred_cash_used: toursRedCashUsed.toString(),
        points_used: pointsUsed.toString(),
        ...metadata,
      },
    };

    if (addMembership) {
      const { data: settings, error: settingsError } = await supabase
        .from('platform_settings')
        .select('stripe_monthly_price_id, stripe_annual_price_id')
        .maybeSingle();

      if (settingsError || !settings) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Failed to load platform settings"
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
          }
        );
      }

      const monthlyPriceId = settings.stripe_monthly_price_id;
      const annualPriceId = settings.stripe_annual_price_id;

      if (!monthlyPriceId || !annualPriceId) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Membership configuration is incomplete"
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
          }
        );
      }

      const priceId = membershipPlan === 'monthly' ? monthlyPriceId : annualPriceId;

      sessionConfig.mode = "subscription";
      sessionConfig.payment_method_types = ['card'];
      sessionConfig.line_items = [
        {
          price: priceId,
          quantity: 1,
        },
      ];
      sessionConfig.subscription_data = {
        metadata: {
          user_id: booking.user_id,
          booking_id: bookingId,
          plan_type: membershipPlan,
        },
      };

      // Build desglose line items (deposit, optionals, insurance, service charge)
      // using the same pure-lines + progressive-discount algorithm as the payment branch.
      // In this branch, `amount` already has membershipCost subtracted (TravelersInfoPage).
      const { data: optDataSub, error: optErrorSub } = await supabase
        .from("booking_optional_services")
        .select("id, service_kind, description, subtotal, service_charge, total_paid, is_cancelled, paid_at")
        .eq("booking_id", bookingId)
        .eq("is_cancelled", false)
        .is("paid_at", null);

      if (optErrorSub) {
        console.warn("Error fetching optional services:", optErrorSub.message);
      }

      const unpaidOptionalsSub = (optDataSub || []).filter(
        (opt: any) => opt.paid_at === null && Number(opt.subtotal) > 0
      );

      const desgloseItemsSub = buildDesgloseLineItems(
        booking,
        unpaidOptionalsSub,
        amount,
        pointsUsed,
        toursRedCashUsed,
        currency,
        description
      );

      for (const item of desgloseItemsSub) {
        sessionConfig.line_items.push(item);
      }
    } else {
      // Query booking_optional_services for this booking to build separate line items
      const { data: optionalServices, error: optError } = await supabase
        .from("booking_optional_services")
        .select("id, service_kind, description, subtotal, service_charge, total_paid, is_cancelled, paid_at")
        .eq("booking_id", bookingId)
        .eq("is_cancelled", false)
        .is("paid_at", null);

      if (optError) {
        console.warn("Error fetching optional services:", optError.message);
      }

      const unpaidOptionals = (optionalServices || []).filter(
        (opt: any) => opt.paid_at === null && Number(opt.subtotal) > 0
      );

      const lineItems = buildDesgloseLineItems(
        booking,
        unpaidOptionals,
        amount,
        pointsUsed,
        toursRedCashUsed,
        currency,
        description
      );

      sessionConfig.mode = "payment";
      sessionConfig.payment_method_types = ['card', 'oxxo', 'customer_balance'];
      sessionConfig.payment_method_options = {
        customer_balance: {
          funding_type: 'bank_transfer',
          bank_transfer: {
            type: 'mx_bank_transfer',
          },
        },
      };
      sessionConfig.line_items = lineItems;
      sessionConfig.payment_intent_data = {
        metadata: {
          booking_id: bookingId,
          toursred_cash_used: toursRedCashUsed.toString(),
          points_used: pointsUsed.toString(),
          ...metadata,
        },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    return new Response(
      JSON.stringify({
        success: true,
        sessionId: session.id,
        url: session.url,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error creating checkout session:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "An unexpected error occurred",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

// Build Stripe line items with pure amounts and a progressive discount.
// Order of discount application: deposit → optionals → insurance → service charge.
// The service charge line is protected last so it only absorbs leftover discount.
function buildDesgloseLineItems(
  booking: any,
  unpaidOptionals: any[],
  amount: number,
  pointsUsed: number,
  toursRedCashUsed: number,
  currency: string,
  description: string
): any[] {
  const totalDiscount = (Number(pointsUsed) || 0) / 100 + (Number(toursRedCashUsed) || 0);

  // --- Raw gross amounts (verified stored as pre-discount) ---
  const depositRaw = Number(booking.deposit_amount) || 0;
  const serviceChargeTourRaw = Number(booking.service_charge) || 0;
  const insuranceRaw =
    booking.travel_insurance_included && Number(booking.travel_insurance_cost) > 0
      ? Number(booking.travel_insurance_cost)
      : 0;

  // Optionals: subtotal is pure agency amount, service_charge is ToursRed's 5%
  const optionalLines = unpaidOptionals.map((opt: any) => ({
    id: opt.id,
    description: opt.description || (opt.service_kind === 'pickup' ? 'Pick Up' : opt.service_kind === 'language' ? 'Idioma/Intérprete' : 'Servicio opcional'),
    service_kind: opt.service_kind || 'optional_service',
    subtotal: Number(opt.subtotal) || 0,
    service_charge: Number(opt.service_charge) || 0,
  }));

  const optionalsSubtotalTotal = optionalLines.reduce((s: number, o: any) => s + o.subtotal, 0);
  const optionalsServiceChargeTotal = optionalLines.reduce((s: number, o: any) => s + o.service_charge, 0);

  // Combined service charge line: tour's service charge + all optionals' service charges
  const serviceChargeCombinedRaw = serviceChargeTourRaw + optionalsServiceChargeTotal;

  // --- Apply progressive discount in order: deposit → optionals → insurance → service charge ---
  let remainingDiscount = totalDiscount;

  const depositFinal = Math.max(0, Math.round((depositRaw - remainingDiscount) * 100) / 100);
  remainingDiscount = Math.max(0, Math.round((remainingDiscount - depositRaw) * 100) / 100);

  // Optionals: apply discount across all subtotals proportionally is over-complex;
  // apply sequentially per optional for transparency
  let optionalsAfterDiscount = optionalLines.map((o: any) => {
    if (remainingDiscount <= 0) return { ...o, final: o.subtotal };
    const applied = Math.min(o.subtotal, remainingDiscount);
    remainingDiscount = Math.max(0, Math.round((remainingDiscount - applied) * 100) / 100);
    return { ...o, final: Math.max(0, Math.round((o.subtotal - applied) * 100) / 100) };
  });

  const insuranceFinal = Math.max(0, Math.round((insuranceRaw - remainingDiscount) * 100) / 100);
  remainingDiscount = Math.max(0, Math.round((remainingDiscount - insuranceRaw) * 100) / 100);

  const serviceChargeFinal = Math.max(0, Math.round((serviceChargeCombinedRaw - remainingDiscount) * 100) / 100);

  // --- Build line items ---
  const lineItems: any[] = [];

  // 1. Depósito (tour portion) — pure, no service charge mixed in
  if (depositFinal > 0) {
    lineItems.push({
      price_data: {
        currency,
        product_data: { name: description || "Reserva de Tour" },
        unit_amount: Math.round(depositFinal * 100),
      },
      quantity: 1,
      metadata: { type: 'deposit' },
    });
  }

  // 2. Opcionales — pure subtotal per item, no service charge mixed in
  for (const opt of optionalsAfterDiscount) {
    if (opt.final > 0) {
      lineItems.push({
        price_data: {
          currency,
          product_data: { name: opt.description },
          unit_amount: Math.round(opt.final * 100),
        },
        quantity: 1,
        metadata: {
          type: opt.service_kind,
          bos_id: opt.id,
        },
      });
    }
  }

  // 3. Seguro de Viaje — pure insurance amount
  if (insuranceFinal > 0) {
    lineItems.push({
      price_data: {
        currency,
        product_data: { name: "Seguro de Viaje" },
        unit_amount: Math.round(insuranceFinal * 100),
      },
      quantity: 1,
      metadata: { type: 'insurance' },
    });
  }

  // 4. Cargo por Servicio (combined: tour + optionals service charges)
  if (serviceChargeFinal > 0) {
    lineItems.push({
      price_data: {
        currency,
        product_data: { name: "Cargo por Servicio" },
        unit_amount: Math.round(serviceChargeFinal * 100),
      },
      quantity: 1,
      metadata: { type: 'service_charge' },
    });
  }

  // Fallback: if all lines were discounted to 0, create a single zero-amount line
  // to avoid Stripe rejecting an empty line_items array.
  if (lineItems.length === 0) {
    lineItems.push({
      price_data: {
        currency,
        product_data: { name: description || "Reserva de Tour" },
        unit_amount: 0,
      },
      quantity: 1,
    });
  }

  // Safety: verify sum matches `amount`; if drift, adjust the deposit line to compensate
  const linesSum = lineItems.reduce((s: number, li: any) => s + (li.price_data.unit_amount / 100), 0);
  const drift = Math.round((amount - linesSum) * 100) / 100;
  if (Math.abs(drift) >= 0.01) {
    // Adjust the deposit line (first line) to absorb rounding drift
    const depositLi = lineItems.find((li: any) => li.metadata?.type === 'deposit');
    if (depositLi) {
      depositLi.price_data.unit_amount = Math.round((Number(depositLi.price_data.unit_amount) / 100 + drift) * 100);
    } else {
      // No deposit line (fully discounted) — adjust the service charge line or first line
      const adjustLi = lineItems.find((li: any) => li.metadata?.type === 'service_charge') || lineItems[0];
      adjustLi.price_data.unit_amount = Math.max(0, Math.round((Number(adjustLi.price_data.unit_amount) / 100 + drift) * 100));
    }
  }

  return lineItems;
}