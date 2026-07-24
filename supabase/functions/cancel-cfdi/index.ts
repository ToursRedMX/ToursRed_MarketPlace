import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface FacturapiCancelResult {
  pacInvoiceId: string;
  cancellationStatus: string | null;
}

async function facturapiCancel(
  apiKey: string,
  orgId: string,
  pacInvoiceId: string,
  motivo: string,
  uuidSustitucion?: string
): Promise<FacturapiCancelResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (orgId) headers["X-Organization-Id"] = orgId;

  // First check current status of the invoice
  const checkRes = await fetch(`https://www.facturapi.io/v2/invoices/${pacInvoiceId}`, {
    method: "GET",
    headers,
  });

  if (checkRes.ok) {
    const invoiceData = await checkRes.json();
    if (invoiceData.status === "canceled" || invoiceData.cancellation_status === "accepted") {
      return { pacInvoiceId, cancellationStatus: "accepted" };
    }
    if (invoiceData.cancellation?.cancellation_type === "not_cancellable") {
      return { pacInvoiceId, cancellationStatus: "accepted" };
    }
  } else if (checkRes.status === 404) {
    return { pacInvoiceId, cancellationStatus: "accepted" };
  }

  const params = new URLSearchParams({ motive: motivo });
  if (uuidSustitucion) params.set("substitution", uuidSustitucion);

  const res = await fetch(`https://www.facturapi.io/v2/invoices/${pacInvoiceId}?${params.toString()}`, {
    method: "DELETE",
    headers,
  });

  if (!res.ok) {
    const errText = await res.text();
    let errData: { message?: string; cancellation_type?: string } = {};
    try { errData = JSON.parse(errText); } catch (_) { /* ignore */ }
    if (errData.cancellation_type === "not_cancellable") {
      return { pacInvoiceId, cancellationStatus: "accepted" };
    }
    throw new Error(`FacturAPI cancel error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const cancellationStatus = data.cancellation_status ?? null;
  return { pacInvoiceId: data.id ?? pacInvoiceId, cancellationStatus };
}

async function zohoBooksCancel(
  supabaseClient: ReturnType<typeof createClient>,
  orgId: string,
  pacInvoiceId: string
): Promise<FacturapiCancelResult> {
  const { data: tokenRow } = await supabaseClient
    .from("zoho_oauth_tokens")
    .select("access_token, refresh_token, access_token_expires_at, api_domain")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!tokenRow) throw new Error("Zoho OAuth token not found. Connect Zoho Books in Admin Settings.");

  let accessToken = tokenRow.access_token;
  let apiDomain = tokenRow.api_domain;

  if (new Date(tokenRow.access_token_expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    const { data: ps } = await supabaseClient
      .from("platform_settings")
      .select("zoho_client_id, zoho_client_secret, zoho_region")
      .maybeSingle();
    if (!ps?.zoho_client_id) throw new Error("Zoho client credentials not configured.");
    const region = ps.zoho_region || "com";
    const rb = new URLSearchParams({
      refresh_token: tokenRow.refresh_token,
      client_id: ps.zoho_client_id,
      client_secret: ps.zoho_client_secret,
      grant_type: "refresh_token",
    });
    const rr = await fetch(`https://accounts.zoho.${region}/oauth/v2/token`, { method: "POST", body: rb });
    if (!rr.ok) throw new Error("Zoho token refresh failed");
    const rd = await rr.json();
    accessToken = rd.access_token;
    apiDomain = rd.api_domain ?? apiDomain;
    const newExpiry = new Date(Date.now() + (rd.expires_in ?? 3600) * 1000).toISOString();
    await supabaseClient.from("zoho_oauth_tokens").update({
      access_token: accessToken, access_token_expires_at: newExpiry, api_domain: apiDomain,
    }).eq("refresh_token", tokenRow.refresh_token);
  }

  const baseUrl = `${apiDomain}/books/v3`;
  const res = await fetch(`${baseUrl}/invoices/${pacInvoiceId}/void?organization_id=${orgId}`, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Zoho Books cancel error ${res.status}: ${err}`);
  }
  return { pacInvoiceId, cancellationStatus: "accepted" };
}

async function cancelWithProvider(
  provider: string,
  apiKey: string,
  orgId: string,
  pacInvoiceId: string,
  motivo: string,
  uuidSustitucion?: string,
  supabaseClient?: ReturnType<typeof createClient>
): Promise<FacturapiCancelResult> {
  switch (provider) {
    case "zoho_books":
      if (!supabaseClient) throw new Error("supabaseClient required for zoho_books provider");
      return zohoBooksCancel(supabaseClient, orgId, pacInvoiceId);
    case "facturapi":
      return facturapiCancel(apiKey, orgId, pacInvoiceId, motivo, uuidSustitucion);
    default:
      throw new Error(`Unknown PAC provider: ${provider}. Supported: zoho_books, facturapi`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { cfdi_invoice_id, motivo, uuid_sustitucion, cancellation_id } = await req.json();

    if (!cfdi_invoice_id || !motivo) {
      return new Response(
        JSON.stringify({ error: "cfdi_invoice_id and motivo are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!["01", "02", "03", "04"].includes(motivo)) {
      return new Response(
        JSON.stringify({ error: "motivo must be 01, 02, 03, or 04" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: cfdi, error: cfdiError } = await supabase
      .from("cfdi_invoices")
      .select("id, pac_provider, pac_invoice_id, status")
      .eq("id", cfdi_invoice_id)
      .maybeSingle();

    if (cfdiError || !cfdi) {
      return new Response(JSON.stringify({ error: "CFDI not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (cfdi.status !== "stamped") {
      return new Response(
        JSON.stringify({ error: "Only stamped CFDIs can be cancelled" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: settings } = await supabase
      .from("platform_settings")
      .select("pac_provider, pac_api_key_encrypted, pac_organization_id")
      .maybeSingle();

    if (!settings?.pac_api_key_encrypted) {
      return new Response(
        JSON.stringify({ error: "PAC provider not configured" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get requesting user
    const authHeader = req.headers.get("Authorization");
    let requestedBy: string | null = null;
    if (authHeader) {
      const { data: userData } = await supabase.auth.getUser(
        authHeader.replace("Bearer ", "")
      );
      requestedBy = userData?.user?.id ?? null;
    }

    // Create cancellation request record
    const { data: cancellationRecord, error: cancellationError } = await supabase
      .from("cfdi_cancellation_requests")
      .insert({
        cfdi_invoice_id,
        motivo,
        uuid_sustitucion: uuid_sustitucion || null,
        status: "pending",
        requested_by: requestedBy,
      })
      .select()
      .single();

    if (cancellationError || !cancellationRecord) {
      throw new Error(`Failed to create cancellation record: ${cancellationError?.message}`);
    }

    let cancelResult: FacturapiCancelResult;
    try {
      cancelResult = await cancelWithProvider(
        cfdi.pac_provider,
        settings.pac_api_key_encrypted!,
        settings.pac_organization_id || "",
        cfdi.pac_invoice_id,
        motivo,
        uuid_sustitucion,
        supabase
      );
    } catch (cancelErr) {
      await supabase
        .from("cfdi_cancellation_requests")
        .update({ status: "rejected", error_message: String(cancelErr), processed_at: new Date().toISOString() })
        .eq("id", cancellationRecord.id);

      return new Response(
        JSON.stringify({ error: "PAC cancellation failed", detail: String(cancelErr) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const pacCancellationId = cancelResult.pacInvoiceId;
    const cancellationStatus = cancelResult.cancellationStatus;

    if (cancellationStatus === "accepted") {
      // SAT confirmed immediately — mark as fully cancelled
      await supabase
        .from("cfdi_cancellation_requests")
        .update({
          status: "accepted",
          pac_cancellation_id: pacCancellationId,
          processed_at: new Date().toISOString(),
        })
        .eq("id", cancellationRecord.id);

      await supabase
        .from("cfdi_invoices")
        .update({
          status: "cancelled",
          ...(cancellation_id ? { cancellation_id } : {}),
        })
        .eq("id", cfdi_invoice_id);

      return new Response(
        JSON.stringify({ success: true, cancellation_id: cancellationRecord.id, cfdi_status: "cancelled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Async cancellation: SAT is still processing (pending or verifying)
    const reqStatus = cancellationStatus === "verifying" ? "verifying" : "pending";

    await supabase
      .from("cfdi_cancellation_requests")
      .update({
        status: reqStatus,
        pac_cancellation_id: pacCancellationId,
        processed_at: new Date().toISOString(),
      })
      .eq("id", cancellationRecord.id);

    await supabase
      .from("cfdi_invoices")
      .update({
        status: "cancellation_pending",
        ...(cancellation_id ? { cancellation_id } : {}),
      })
      .eq("id", cfdi_invoice_id);

    return new Response(
      JSON.stringify({
        success: true,
        cancellation_id: cancellationRecord.id,
        cfdi_status: "cancellation_pending",
        cancellation_status: cancellationStatus,
        message: "Cancelación enviada al SAT. El webhook de FacturAPI confirmará cuando se procese.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
