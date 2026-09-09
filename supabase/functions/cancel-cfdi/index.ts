import { getZohoAccessToken, type ZohoClient } from "../_shared/zohoAccessToken.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as Sentry from "npm:@sentry/deno@9";
import { authorizeCfdiRequest } from "../_shared/cfdiAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    tracesSampleRate: 0.1,
  });
}

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
  supabaseClient: ZohoClient,
  orgId: string,
  pacInvoiceId: string
): Promise<FacturapiCancelResult> {
  const { token: accessToken, apiDomain } = await getZohoAccessToken(supabaseClient);

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
  supabaseClient?: ZohoClient
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

    if (["01", "02", "03", "04"].includes(motivo) === false) {
      return new Response(
        JSON.stringify({ error: "motivo must be 01, 02, 03, or 04" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Autorizacion ---
    // Esta funcion cancelaba ante el SAT sin validar al llamador: el bloque de
    // abajo solo extraia el user id para registrarlo en requested_by, y si no
    // venia Authorization seguia igual con requestedBy = null. Como verify_jwt
    // acepta la llave publicable del front, cualquiera podia cancelar el CFDI
    // timbrado de cualquier cliente pasando solo su cfdi_invoice_id.
    //
    // Es mas grave que el hueco de las funciones de emision que se cerro el
    // 25-ago: emitir de mas se corrige con una sustitucion, pero cancelar el
    // comprobante de otro cliente ante el SAT no se deshace.
    //
    // Sin rama de dueno, mismo criterio que la sustitucion en
    // generate-cancellation-commission-cfdi: cancelar es operacion fiscal, no
    // del dueno de la reserva. Los 9 llamadores internos (admin-cancel-booking,
    // admin-finalize-cancellation, cancel-individual-supplement,
    // cancel-optional-service, process-agency-booking-cancellation,
    // process-payment-plan-tour-deadline, process-tour-cancellation,
    // process-traveler-cancellation y substitute-cfdi-for-partial-cancellation)
    // usan service role, verificado uno por uno. Las dos pantallas que la
    // invocan (AdminCfdi.tsx:167 y AdminCfdiManual.tsx:757) estan restringidas
    // a admin.
    const auth = await authorizeCfdiRequest(supabase, req, {
      resource: `la cancelacion del CFDI ${cfdi_invoice_id} (motivo ${motivo})`,
    });
    if (!auth.allowed) return auth.response;

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

    const { data: settings, error: settingsError } = await supabase
      .from("platform_settings")
      .select("pac_provider, pac_organization_id")
      .maybeSingle();

    const { data: secrets, error: secretsError } = await supabase
      .from("platform_secrets")
      .select("pac_api_key_encrypted")
      .maybeSingle();
    const pacApiKey = secrets?.pac_api_key_encrypted || null;

    if (settingsError || secretsError) {
      return new Response(JSON.stringify({ error: "No se pudo consultar la configuracion del PAC", code: "PAC_CONFIG_UNAVAILABLE" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!settings || !pacApiKey) {
      return new Response(
        JSON.stringify({ error: "PAC provider not configured" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // El guard ya resolvio quien llama; null cuando es el service role.
    const requestedBy: string | null = auth.caller.userId;

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
        pacApiKey!,
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
    if (sentryDsn) {
      Sentry.captureException(err, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
