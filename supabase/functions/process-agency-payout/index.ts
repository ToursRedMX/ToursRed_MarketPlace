import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey"
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      throw new Error("Invalid user token");
    }
    const { data: userData, error: userDataError } = await supabase.from("users").select("role").eq("id", user.id).single();
    if (userDataError || !userData || userData.role !== 'admin' && userData.role !== 'super_admin') {
      throw new Error("Unauthorized: Admin access required");
    }
    const { agency_id, commission_record_ids, payment_method, bank_reference, notes } = await req.json();
    if (!agency_id || !commission_record_ids || commission_record_ids.length === 0) {
      throw new Error("Missing required fields: agency_id and commission_record_ids");
    }
    const { data: commissions, error: commissionsError } = await supabase.from("commission_records").select("*").in("id", commission_record_ids).eq("agency_id", agency_id).is("payout_id", null);
    if (commissionsError) {
      throw new Error(`Error fetching commissions: ${commissionsError.message}`);
    }
    if (!commissions || commissions.length === 0) {
      throw new Error("No valid commission records found or already paid");
    }
    const totalAmount = commissions.reduce((sum, c)=>sum + Number(c.agency_net_amount || 0), 0);
    const { data: payout, error: payoutError } = await supabase.from("agency_payouts").insert([
      {
        agency_id,
        payout_date: new Date().toISOString().split('T')[0],
        amount: totalAmount,
        payment_method: payment_method || 'spei_transfer',
        bank_reference: bank_reference || null,
        status: 'completed',
        notes: notes || null,
        processed_by_user_id: user.id,
        commission_records_count: commissions.length
      }
    ]).select().single();
    if (payoutError) {
      throw new Error(`Error creating payout: ${payoutError.message}`);
    }
    const { error: updateError } = await supabase.from("commission_records").update({
      payout_id: payout.id,
      status: 'paid_out',
      payout_scheduled_date: new Date().toISOString().split('T')[0],
      reconciliation_status: 'reconciled',
      processed_at: new Date().toISOString()
    }).in("id", commission_record_ids);
    if (updateError) {
      console.error('Error updating commissions:', updateError);
      throw new Error(`Error linking commissions to payout: ${updateError.message}`);
    }
    const { data: agency, error: agencyError } = await supabase.from("agencies").select("name, contact_email, user_id").eq("id", agency_id).single();
    if (!agencyError && agency) {
      await supabase.from("notifications").insert([
        {
          user_id: agency.user_id,
          type: 'system_announcement',
          title: 'Pago Procesado',
          message: `Se ha procesado un pago de $${totalAmount.toFixed(2)} MXN. Referencia: ${bank_reference || 'N/A'}`,
          data: {
            payout_id: payout.id,
            amount: totalAmount,
            reference: bank_reference
          },
          is_read: false
        }
      ]);
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-payout-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
          },
          body: JSON.stringify({
            payout_id: payout.id,
            agency_email: agency.contact_email,
            agency_name: agency.name,
            amount: totalAmount,
            reference: bank_reference,
            commission_count: commissions.length
          })
        });
      } catch (emailError) {
        console.error('Error sending payout notification email:', emailError);
      }
    }
    return new Response(JSON.stringify({
      success: true,
      payout_id: payout.id,
      amount: totalAmount,
      commission_count: commissions.length,
      message: 'Payout processed successfully'
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error('Error processing payout:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Internal server error'
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
