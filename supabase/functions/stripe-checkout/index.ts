import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";
import Stripe from "npm:stripe@22.3.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        ...corsHeaders,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  try {
    // Get the request body
    const { 
      price_id, 
      mode = 'payment',
      success_url,
      cancel_url
    } = await req.json();

    // Validate required parameters
    if (!price_id) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Missing required parameter: price_id" 
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Get the Stripe secret key from environment variables
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

    // Initialize Stripe
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2026-06-24.dahlia",
    });

    // Get the user from the authorization header
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

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the user from the JWT
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid token" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 401,
        }
      );
    }

    // Check if the user already has a Stripe customer
    let { data: customers, error: customerError } = await supabase
      .from("stripe_customers")
      .select("customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (customerError) {
      console.error("Error fetching customer:", customerError);
    }

    let customerId;
    
    // If the user doesn't have a Stripe customer, create one
    if (!customers) {
      // Get user details for the customer
      const { data: userProfile } = await supabase
        .from("users")
        .select("first_name, last_name, email")
        .eq("id", user.id)
        .single();

      // Create a new customer in Stripe
      const customer = await stripe.customers.create({
        email: user.email,
        name: userProfile ? `${userProfile.first_name || ''} ${userProfile.last_name || ''}`.trim() : undefined,
        metadata: {
          user_id: user.id,
        },
      });

      customerId = customer.id;

      // Save the customer ID in the database
      const { error: insertError } = await supabase
        .from("stripe_customers")
        .insert({
          user_id: user.id,
          customer_id: customer.id,
        });

      if (insertError) {
        console.error("Error saving customer:", insertError);
      }
    } else {
      customerId = customers.customer_id;
    }

    // Create a checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: price_id,
          quantity: 1,
        },
      ],
      mode: mode,
      success_url: success_url || `${req.headers.get("origin")}/success?product=${price_id}`,
      cancel_url: cancel_url || `${req.headers.get("origin")}/cancel`,
    });

    // Return the session ID and URL
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