import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkAal2Required, aal2Response } from "../_shared/aal2Check.ts";
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

    // AAL2 (MFA) check — blocks the action if MFA is required but not completed
    const aal2 = await checkAal2Required(supabase);
    if (!aal2.allowed) {
      return aal2Response(aal2.reason || "Se requiere autenticacion de dos factores");
    }

    const body = await req.json();
    const agency_id = body.agency_id;
    const commission_ids = body.commission_ids || body.commission_record_ids || [];
    const penalty_ids = body.penalty_ids || [];
    const payment_method = body.payment_method || 'bank_transfer';
    const notes = body.notes || null;
    const receipt_url = body.receipt_url || null;
    const receipt_filename = body.receipt_filename || null;
    const bill_number = body.bill_number || null;
    const total_amount = body.total_amount;
    const net_amount = body.net_amount || total_amount;
    const platform_commission_amount = body.platform_commission_amount || 0;
    const bank_reference = body.bank_reference || null;

    if (!agency_id || (commission_ids.length === 0 && penalty_ids.length === 0)) {
      throw new Error("Missing required fields: agency_id and commission_ids or penalty_ids");
    }

    // Use RPC for atomic transaction: insert payout + update commissions + update penalties
    const { data: payoutResult, error: rpcError } = await supabase.rpc('process_agency_payout_atomic', {
      p_agency_id: agency_id,
      p_commission_ids: commission_ids,
      p_penalty_ids: penalty_ids,
      p_total_amount: total_amount,
      p_net_amount: net_amount,
      p_platform_commission_amount: platform_commission_amount,
      p_payment_method: payment_method,
      p_notes: notes,
      p_receipt_url: receipt_url,
      p_receipt_filename: receipt_filename,
      p_bill_number: bill_number,
      p_bank_reference: bank_reference,
      p_processed_by: user.id
    });

    if (rpcError) {
      throw new Error(`Error in atomic payout: ${rpcError.message}`);
    }

    const payoutId = payoutResult?.payout_id;
    const commissionCount = payoutResult?.commission_count || commission_ids.length;

    // Send notification + email outside the transaction
    const { data: agency, error: agencyError } = await supabase.from("agencies").select("name, contact_email, user_id").eq("id", agency_id).single();
    if (!agencyError && agency) {
      await supabase.from("notifications").insert([
        {
          user_id: agency.user_id,
          type: 'system_announcement',
          title: 'Pago Procesado',
          message: `Se ha procesado un pago de $${Number(total_amount).toFixed(2)} MXN. Referencia: ${bank_reference || 'N/A'}`,
          data: {
            payout_id: payoutId,
            amount: total_amount,
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
            payout_id: payoutId,
            agency_email: agency.contact_email,
            agency_name: agency.name,
            amount: total_amount,
            reference: bank_reference,
            commission_count: commissionCount
          })
        });
      } catch (emailError) {
        console.error('Error sending payout notification email:', emailError);
      }
    }
    return new Response(JSON.stringify({
      success: true,
      payout_id: payoutId,
      amount: total_amount,
      commission_count: commissionCount,
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
