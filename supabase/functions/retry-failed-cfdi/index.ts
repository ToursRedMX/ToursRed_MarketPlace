import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

    const body = await req.json().catch(() => ({}));
    const cfdiId: string | undefined = body?.cfdi_id;

    let query = supabase
      .from("cfdi_invoices")
      .select("id, invoice_type, booking_id, payout_id, featured_slot_id, retry_count")
      .eq("status", "error")
      .lt("retry_count", 3);

    if (cfdiId) {
      query = query.eq("id", cfdiId);
    } else {
      query = query.order("created_at", { ascending: true }).limit(20);
    }

    const { data: failedCfdis, error } = await query;

    if (error) throw error;

    if (!failedCfdis || failedCfdis.length === 0) {
      return new Response(
        JSON.stringify({ message: "No failed CFDIs to retry" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const cfdi of failedCfdis) {
      try {
        if (cfdi.invoice_type === "booking" && cfdi.booking_id) {
          const res = await supabase.functions.invoke("generate-booking-cfdi", {
            body: { booking_id: cfdi.booking_id },
          });
          results.push({ id: cfdi.id, success: !res.error });
        } else if (cfdi.invoice_type === "commission" && cfdi.payout_id) {
          const res = await supabase.functions.invoke("generate-commission-cfdi", {
            body: { payout_id: cfdi.payout_id },
          });
          results.push({ id: cfdi.id, success: !res.error });
        } else if (cfdi.invoice_type === "featured_slot" && cfdi.featured_slot_id) {
          const res = await supabase.functions.invoke("generate-featured-slot-cfdi", {
            body: { slot_id: cfdi.featured_slot_id },
          });
          results.push({ id: cfdi.id, success: !res.error });
        } else {
          results.push({ id: cfdi.id, success: false, error: "Unknown invoice_type or missing reference id" });
        }
      } catch (retryErr) {
        results.push({ id: cfdi.id, success: false, error: String(retryErr) });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return new Response(
      JSON.stringify({ processed: results.length, succeeded, failed, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
