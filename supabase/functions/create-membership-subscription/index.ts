import { createClient } from 'npm:@supabase/supabase-js@2.39.6';
import Stripe from 'npm:stripe@22.3.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');

    if (!stripeSecretKey) {
      throw new Error('Stripe is not configured');
    }

    const authHeader = req.headers.get('Authorization')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { planType, discountCode } = await req.json();

    if (!planType || !['monthly', 'annual'].includes(planType)) {
      throw new Error('Invalid plan type');
    }

    let validDiscountCode: string | null = null;
    let trialDays = 0;
    let discountType: string | null = null;
    let discountValue: number | null = null;

    if (discountCode && typeof discountCode === 'string') {
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
      const { data: validation } = await supabaseAdmin.rpc('validate_discount_code', {
        p_code: discountCode.trim(),
        p_user_id: user.id,
        p_applicable_to: 'memberships',
      });

      if (validation?.valid) {
        const planTypeRestriction = validation.membership_plan_type || 'both';
        const planAllowed = planTypeRestriction === 'both'
          || (planTypeRestriction === 'monthly' && planType === 'monthly')
          || (planTypeRestriction === 'annual' && planType === 'annual');

        if (planAllowed) {
          discountType = validation.discount_type;
          discountValue = validation.discount_value;

          if (validation.discount_type === 'membership_free_month' && planType === 'monthly') {
            trialDays = 30;
            validDiscountCode = discountCode.trim();
          } else if (validation.discount_type === 'membership_percentage' || validation.discount_type === 'membership_fixed') {
            validDiscountCode = discountCode.trim();
          }
        }
      }
    }

    const { data: userData, error: userDataError } = await supabase
      .from('users')
      .select('first_name, last_name')
      .eq('id', user.id)
      .single();

    if (userDataError) {
      throw new Error('Failed to fetch user data');
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2026-06-24.dahlia',
    });

    const { data: settings, error: settingsError } = await supabase
      .from('platform_settings')
      .select('stripe_monthly_price_id, stripe_annual_price_id')
      .maybeSingle();

    if (settingsError || !settings) {
      throw new Error('Failed to load platform settings');
    }

    const priceId = planType === 'monthly'
      ? settings.stripe_monthly_price_id
      : settings.stripe_annual_price_id;

    if (!priceId) {
      throw new Error(`Price ID not configured for ${planType} plan`);
    }

    let customer;
    const { data: existingMembership } = await supabase
      .from('memberships')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (existingMembership?.stripe_customer_id) {
      customer = await stripe.customers.retrieve(existingMembership.stripe_customer_id);
    } else {
      customer = await stripe.customers.create({
        email: user.email,
        name: `${userData.first_name || ''} ${userData.last_name || ''}`.trim() || user.email,
        metadata: {
          supabase_user_id: user.id,
        },
      });
    }

    const subscriptionData: any = {
      metadata: {
        user_id: user.id,
        plan_type: planType,
        ...(validDiscountCode ? { discount_code: validDiscountCode } : {}),
      },
    };

    if (trialDays > 0) {
      subscriptionData.trial_period_days = trialDays;
    }

    let stripeCouponId: string | null = null;

    if (validDiscountCode && discountType === 'membership_percentage' && discountValue) {
      const coupon = await stripe.coupons.create({
        percent_off: discountValue,
        duration: 'once',
        name: `Descuento ${discountValue}% - ${validDiscountCode}`,
      });
      stripeCouponId = coupon.id;
    } else if (validDiscountCode && discountType === 'membership_fixed' && discountValue) {
      const coupon = await stripe.coupons.create({
        amount_off: Math.round(discountValue * 100),
        currency: 'mxn',
        duration: 'once',
        name: `Descuento $${discountValue} - ${validDiscountCode}`,
      });
      stripeCouponId = coupon.id;
    }

    const sessionParams: any = {
      customer: customer.id,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${req.headers.get('origin')}/traveler/membership?success=true`,
      cancel_url: `${req.headers.get('origin')}/traveler/membership/checkout?plan=${planType}&cancelled=true`,
      subscription_data: subscriptionData,
    };

    if (stripeCouponId) {
      sessionParams.discounts = [{ coupon: stripeCouponId }];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return new Response(
      JSON.stringify({ url: session.url }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Error creating membership subscription:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to create subscription' }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});
