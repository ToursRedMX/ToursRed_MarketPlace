import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import * as Sentry from 'npm:@sentry/deno@9';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};
const sentryDsn = Deno.env.get('SENTRY_BACKEND_DSN');
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get('SUPABASE_URL')?.includes('localhost') ? 'development' : 'production',
    tracesSampleRate: 0.1
  });
}
const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
if (!stripeSecret) {
  console.error('STRIPE_SECRET_KEY is not set');
}
const stripe = stripeSecret ? new Stripe(stripeSecret, {
  appInfo: {
    name: 'TourRed Payment Processing',
    version: '1.0.0'
  }
}) : null;
Deno.serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({
      error: 'Method not allowed'
    }), {
      status: 405,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
  try {
    // Check if Stripe is configured
    if (!stripe) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Stripe configuration is missing',
        details: 'stripe_key_missing'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const { amount, currency, description, metadata } = await req.json();
    // Validate required fields
    if (!amount || !currency) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required fields: amount and currency are required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Convert amount to cents (Stripe expects amounts in smallest currency unit)
    const amountInCents = Math.round(amount * 100);
    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: currency.toLowerCase(),
      description: description || 'TourRed booking payment',
      metadata: metadata || {},
      automatic_payment_methods: {
        enabled: true
      }
    });
    console.log(`Created payment intent: ${paymentIntent.id} for amount: ${amount} ${currency}`);
    return new Response(JSON.stringify({
      success: true,
      payment_intent_id: paymentIntent.id,
      client_secret: paymentIntent.client_secret,
      amount: amount,
      currency: currency
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    if (sentryDsn) {
      Sentry.captureException(error, {
        tags: {
          execution_id: Deno.env.get('SB_EXECUTION_ID') || 'unknown',
          region: Deno.env.get('SB_REGION') || 'unknown'
        }
      });
      await Sentry.flush(2000);
    }
    console.error('Error processing payment:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
