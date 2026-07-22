import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("🔍 Checking for memberships that need renewal reminders...");

    const fiveDaysFromNow = new Date();
    fiveDaysFromNow.setDate(fiveDaysFromNow.getDate() + 5);
    fiveDaysFromNow.setHours(23, 59, 59, 999);

    const fiveDaysFromNowStart = new Date();
    fiveDaysFromNowStart.setDate(fiveDaysFromNowStart.getDate() + 5);
    fiveDaysFromNowStart.setHours(0, 0, 0, 0);

    const { data: memberships, error: fetchError } = await supabase
      .from('memberships')
      .select(`
        id,
        user_id,
        plan_type,
        current_period_end,
        renewal_reminder_sent,
        users (
          email,
          first_name
        )
      `)
      .eq('status', 'active')
      .eq('renewal_reminder_sent', false)
      .gte('current_period_end', fiveDaysFromNowStart.toISOString())
      .lte('current_period_end', fiveDaysFromNow.toISOString());

    if (fetchError) {
      console.error('Error fetching memberships:', fetchError);
      throw fetchError;
    }

    console.log(`📋 Found ${memberships?.length || 0} memberships needing renewal reminders`);

    if (!memberships || memberships.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No memberships need renewal reminders at this time',
          processed: 0
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let successCount = 0;
    let errorCount = 0;

    for (const membership of memberships) {
      try {
        if (!membership.users) {
          console.error(`No user data for membership ${membership.id}`);
          errorCount++;
          continue;
        }

        const planAmount = membership.plan_type === 'monthly' ? '$49 MXN' : '$490 MXN';

        console.log(`📧 Sending renewal reminder to ${membership.users.email}...`);

        const reminderResponse = await fetch(
          `${supabaseUrl}/functions/v1/send-membership-renewal-reminder`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email: membership.users.email,
              firstName: membership.users.first_name || 'Viajero',
              planType: membership.plan_type,
              renewalDate: membership.current_period_end,
              amount: planAmount,
            }),
          }
        );

        if (reminderResponse.ok) {
          const { error: updateError } = await supabase
            .from('memberships')
            .update({
              renewal_reminder_sent: true,
              renewal_reminder_sent_at: new Date().toISOString(),
            })
            .eq('id', membership.id);

          if (updateError) {
            console.error(`Error updating membership ${membership.id}:`, updateError);
            errorCount++;
          } else {
            console.log(`✅ Reminder sent and tracked for membership ${membership.id}`);
            successCount++;
          }
        } else {
          const errorText = await reminderResponse.text();
          console.error(`Failed to send reminder for membership ${membership.id}:`, errorText);
          errorCount++;
        }
      } catch (error) {
        console.error(`Error processing membership ${membership.id}:`, error);
        errorCount++;
      }
    }

    console.log(`✅ Processed ${successCount + errorCount} memberships: ${successCount} success, ${errorCount} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Renewal reminders processed',
        processed: successCount + errorCount,
        successful: successCount,
        failed: errorCount,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error processing renewal reminders:", error);
    return new Response(
      JSON.stringify({
        error: "Error processing renewal reminders",
        details: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});