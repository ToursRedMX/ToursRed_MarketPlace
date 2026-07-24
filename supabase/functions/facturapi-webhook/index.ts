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
    // Verify authenticity via Bearer token
    const webhookToken = Deno.env.get("FACTURAPI_WEBHOOK_TOKEN");
    if (!webhookToken) {
      console.error("FACTURAPI_WEBHOOK_TOKEN secret not configured");
      return new Response(JSON.stringify({ error: "Webhook not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");

    if (!token || token !== webhookToken) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const eventType: string = body.type || body.event || "";
    const data = body.data || body;

    // Only process cancellation status updates
    if (eventType !== "invoice.cancellation_status_updated" && eventType !== "invoice.canceled") {
      return new Response(JSON.stringify({ received: true, processed: false, reason: "ignored_event" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pacInvoiceId: string = data.id || data.pac_invoice_id || "";
    const cancellationStatus: string = data.cancellation_status || data.status || "";

    if (!pacInvoiceId) {
      console.error("No invoice id in webhook payload");
      return new Response(JSON.stringify({ error: "Missing invoice id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find the CFDI by pac_invoice_id
    const { data: cfdi, error: cfdiError } = await supabase
      .from("cfdi_invoices")
      .select("id, booking_id, cancellation_id, status, invoice_type")
      .eq("pac_invoice_id", pacInvoiceId)
      .maybeSingle();

    if (cfdiError || !cfdi) {
      console.error(`CFDI not found for pac_invoice_id: ${pacInvoiceId}`);
      return new Response(JSON.stringify({ received: true, processed: false, reason: "cfdi_not_found" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only process if the CFDI is in cancellation_pending state
    if (cfdi.status !== "cancellation_pending") {
      console.log(`CFDI ${cfdi.id} is in status '${cfdi.status}', ignoring webhook`);
      return new Response(JSON.stringify({ received: true, processed: false, reason: "not_pending" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (cancellationStatus === "accepted") {
      // SAT confirmed the cancellation — mark as fully cancelled
      await supabase
        .from("cfdi_invoices")
        .update({ status: "cancelled" })
        .eq("id", cfdi.id);

      // Update the cancellation request
      await supabase
        .from("cfdi_cancellation_requests")
        .update({ status: "accepted", processed_at: new Date().toISOString() })
        .eq("cfdi_invoice_id", cfdi.id)
        .in("status", ["pending", "verifying"]);

      // If linked to a booking cancellation, generate replacement commission CFDI
      if (cfdi.cancellation_id && cfdi.booking_id) {
        EdgeRuntime.waitUntil(
          (async () => {
            try {
              await supabase.functions.invoke("generate-cancellation-commission-cfdi", {
                body: {
                  booking_id: cfdi.booking_id,
                  cancellation_id: cfdi.cancellation_id,
                  replaces_cfdi_invoice_id: cfdi.id,
                },
              });
            } catch (e) {
              console.error("Error generating replacement commission CFDI:", e);
            }
          })()
        );
      }

      console.log(`CFDI ${cfdi.id} cancellation accepted by SAT`);
    } else if (cancellationStatus === "rejected") {
      // SAT rejected the cancellation — revert to stamped
      await supabase
        .from("cfdi_invoices")
        .update({ status: "stamped" })
        .eq("id", cfdi.id);

      await supabase
        .from("cfdi_cancellation_requests")
        .update({ status: "rejected", processed_at: new Date().toISOString() })
        .eq("cfdi_invoice_id", cfdi.id)
        .in("status", ["pending", "verifying"]);

      console.warn(`CFDI ${cfdi.id} cancellation rejected by SAT — manual review needed`);
    } else {
      // Still pending/verifying — no state change needed
      console.log(`CFDI ${cfdi.id} cancellation still in progress: ${cancellationStatus}`);
    }

    return new Response(JSON.stringify({ received: true, processed: true, cancellation_status: cancellationStatus }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("facturapi-webhook error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
