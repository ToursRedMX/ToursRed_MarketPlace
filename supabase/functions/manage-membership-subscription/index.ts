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

    const { action } = await req.json();

    if (!action || !['cancel', 'reactivate', 'upgrade'].includes(action)) {
      throw new Error('Invalid action');
    }

    const { data: membership, error: membershipError } = await supabase
      .from('memberships')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (membershipError || !membership) {
      throw new Error('No active membership found');
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2026-06-24.dahlia',
    });

    if (action === 'cancel') {
      await stripe.subscriptions.update(membership.stripe_subscription_id, {
        cancel_at_period_end: true,
      });

      await supabase
        .from('memberships')
        .update({
          cancel_at_period_end: true,
          cancelled_at: new Date().toISOString(),
        })
        .eq('id', membership.id);

      try {
        const { data: userData } = await supabase
          .from('users')
          .select('email, first_name')
          .eq('id', user.id)
          .maybeSingle();

        if (userData) {
          console.log('📧 Sending membership cancellation email...');
          const cancellationResponse = await fetch(
            `${supabaseUrl}/functions/v1/send-membership-cancellation`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                email: userData.email,
                firstName: userData.first_name || 'Viajero',
                planType: membership.plan_type,
                endDate: membership.current_period_end,
              }),
            }
          );

          if (cancellationResponse.ok) {
            console.log('✅ Cancellation email sent successfully');
          } else {
            const errorText = await cancellationResponse.text();
            console.error('Failed to send cancellation email:', errorText);
          }
        }
      } catch (emailError) {
        console.error('Error sending cancellation email:', emailError);
      }

      return new Response(
        JSON.stringify({
          message: 'Subscription will be cancelled at the end of the billing period',
          end_date: membership.current_period_end
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    } else if (action === 'reactivate') {
      await stripe.subscriptions.update(membership.stripe_subscription_id, {
        cancel_at_period_end: false,
      });

      await supabase
        .from('memberships')
        .update({
          cancel_at_period_end: false,
          cancelled_at: null,
        })
        .eq('id', membership.id);

      return new Response(
        JSON.stringify({ message: 'Subscription reactivated successfully' }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    } else if (action === 'upgrade') {
      if (membership.plan_type !== 'monthly') {
        throw new Error('Only monthly subscriptions can be upgraded');
      }

      const { data: settings } = await supabase
        .from('platform_settings')
        .select('stripe_annual_price_id')
        .single();

      if (!settings?.stripe_annual_price_id) {
        throw new Error('Annual plan not configured');
      }

      const subscription = await stripe.subscriptions.retrieve(membership.stripe_subscription_id);

      const updatedSubscription = await stripe.subscriptions.update(membership.stripe_subscription_id, {
        cancel_at_period_end: false,
        proration_behavior: 'always_invoice',
        billing_cycle_anchor: 'now',
        items: [{
          id: subscription.items.data[0].id,
          price: settings.stripe_annual_price_id,
        }],
        metadata: {
          ...subscription.metadata,
          plan_type: 'annual',
        },
      });

      const currentPeriodEnd = new Date(updatedSubscription.items.data[0].current_period_end * 1000);

      await supabase
        .from('memberships')
        .update({
          plan_type: 'annual',
          cancel_at_period_end: false,
          current_period_end: currentPeriodEnd.toISOString(),
          current_period_start: new Date(updatedSubscription.items.data[0].current_period_start * 1000).toISOString(),
        })
        .eq('id', membership.id);

      return new Response(
        JSON.stringify({
          message: 'Tu plan se actualizó a anual. Se cobró de inmediato la diferencia prorrateada por los días restantes de tu mes actual. Tu membresía anual es válida hasta el ' + currentPeriodEnd.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' }) + '.',
          current_period_end: currentPeriodEnd.toISOString()
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }
  } catch (error) {
    console.error('Error managing membership subscription:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to manage subscription' }),
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