import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface CfdiResult {
  pac_invoice_id: string;
  uuid_fiscal: string;
  folio: string;
  serie: string;
  xml_url: string;
  pdf_url: string;
  stamped_at: string;
}

async function facturapiStamp(
  apiKey: string,
  orgId: string,
  body: Record<string, unknown>
): Promise<CfdiResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (orgId) headers["X-Organization-Id"] = orgId;

  const res = await fetch("https://www.facturapi.io/v2/invoices", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FacturAPI error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return {
    pac_invoice_id: data.id,
    uuid_fiscal: data.uuid,
    folio: data.folio_number?.toString() ?? "",
    serie: data.series ?? "",
    xml_url: `https://www.facturapi.io/v2/invoices/${data.id}/xml`,
    pdf_url: `https://www.facturapi.io/v2/invoices/${data.id}/pdf`,
    stamped_at: data.created_at ?? new Date().toISOString(),
  };
}

async function zohoBooksStamp(
  supabaseClient: ReturnType<typeof createClient>,
  orgId: string,
  receptor: { rfc: string; razon_social: string; regimen_fiscal: string; postal_code: string; uso_cfdi: string },
  conceptos: Array<{ descripcion: string; valor_unitario: number }>,
  serie: string,
  sandboxMode: boolean
): Promise<CfdiResult> {
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
  const zohoInvoice = {
    customer_id: receptor.rfc,
    reference_number: serie,
    date: new Date().toISOString().split("T")[0],
    currency_code: "MXN",
    line_items: conceptos.map((c) => ({
      name: c.descripcion, description: c.descripcion, quantity: 1, rate: c.valor_unitario, tax_percentage: 16,
    })),
    is_inclusive_tax: false,
    notes: sandboxMode ? "[SANDBOX - CFDI de prueba]" : undefined,
  };

  const res = await fetch(`${baseUrl}/invoices?organization_id=${orgId}`, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(zohoInvoice),
  });
  if (!res.ok) { const err = await res.text(); throw new Error(`Zoho Books error ${res.status}: ${err}`); }
  const data = await res.json() as { invoice: { invoice_id: string; invoice_number: string; created_time: string } };
  const inv = data.invoice;
  return {
    pac_invoice_id: inv.invoice_id,
    uuid_fiscal: inv.invoice_id,
    folio: inv.invoice_number ?? "",
    serie,
    xml_url: `${baseUrl}/invoices/${inv.invoice_id}?organization_id=${orgId}&accept=xml`,
    pdf_url: `${baseUrl}/invoices/${inv.invoice_id}?organization_id=${orgId}&accept=pdf`,
    stamped_at: inv.created_time ?? new Date().toISOString(),
  };
}

async function stampCfdi(
  provider: string,
  apiKey: string,
  orgId: string,
  body: Record<string, unknown>,
  supabaseClient?: ReturnType<typeof createClient>,
  sandboxMode?: boolean
): Promise<CfdiResult> {
  switch (provider) {
    case "zoho_books": {
      if (!supabaseClient) throw new Error("supabaseClient required for zoho_books provider");
      const receptor = body.receptor as { rfc: string; razon_social: string; regimen_fiscal: string; postal_code: string; uso_cfdi: string };
      const conceptos = body.conceptos as Array<{ descripcion: string; valor_unitario: number }>;
      return zohoBooksStamp(supabaseClient, orgId, receptor, conceptos, (body.serie as string) || "B", sandboxMode ?? false);
    }
    case "facturapi":
      return facturapiStamp(apiKey, orgId, body);
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

    const { payout_id } = await req.json();
    if (!payout_id) {
      return new Response(JSON.stringify({ error: "payout_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if CFDI already exists for this payout
    const { data: existing } = await supabase
      .from("cfdi_invoices")
      .select("id, status")
      .eq("payout_id", payout_id)
      .eq("invoice_type", "commission")
      .in("status", ["stamped", "pending"])
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({ message: "CFDI already exists", cfdi_id: existing.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load payout details
    const { data: payout, error: payoutError } = await supabase
      .from("agency_payouts")
      .select(`
        id, net_amount, platform_commission_amount, payout_code,
        agencies (id, rfc, razon_social, regimen_fiscal, postal_code)
      `)
      .eq("id", payout_id)
      .maybeSingle();

    if (payoutError || !payout) {
      return new Response(JSON.stringify({ error: "Payout not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load platform settings
    const { data: settings } = await supabase
      .from("platform_settings")
      .select(
        "pac_provider, pac_api_key_encrypted, pac_organization_id, cfdi_serie_commission, pac_sandbox_mode, pac_issuer_rfc, pac_issuer_razon_social, pac_issuer_regimen_fiscal"
      )
      .maybeSingle();

    if (!settings || settings.pac_provider === "none" || !settings.pac_api_key_encrypted) {
      return new Response(
        JSON.stringify({ error: "PAC provider not configured" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const agency = payout.agencies as {
      id: string;
      rfc?: string;
      razon_social?: string;
      regimen_fiscal?: string;
      postal_code?: string;
    };

    if (!agency?.rfc || !agency?.razon_social) {
      return new Response(
        JSON.stringify({ error: "Agency fiscal data (RFC, razon_social) is incomplete" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Commission CFDI: ToursRed bills the agency for the platform commission
    // Use platform_commission_amount if available, otherwise fall back to net_amount
    const total = Number(payout.platform_commission_amount || payout.net_amount);
    // 6 decimales para valor_unitario en FacturAPI (evita error de centavo en XML)
    const subtotalFacturapi = Math.round((total / 1.16) * 1000000) / 1000000;
    // IVA como complemento del total exacto → subtotal + iva = total siempre
    const iva = Math.round(total * 16 / 116 * 100) / 100;
    const subtotal = Math.round((total - iva) * 100) / 100;

    const serie = settings.cfdi_serie_commission || "B";
    const facturapiBody = {
      type: "I",
      series: serie,
      payment_form: "03",
      payment_method: "PUE",
      customer: {
        legal_name: agency.razon_social,
        tax_id: agency.rfc,
        tax_system: agency.regimen_fiscal || "612",
        address: { zip: agency.postal_code || "06600" },
      },
      items: [
        {
          product: {
            description: `Comision por servicios de plataforma - Pago ${payout.payout_code || payout_id}`,
            product_key: "80141600",
            unit_key: "E48",
            price: subtotalFacturapi,
            tax_included: false,
            taxes: [
              { type: "IVA", rate: 0.16, factor: "Tasa", withholding: false },
            ],
          },
          quantity: 1,
        },
      ],
    };

    // Create pending CFDI record
    const { data: cfdiRecord, error: insertError } = await supabase
      .from("cfdi_invoices")
      .insert({
        invoice_type: "commission",
        payout_id: payout.id,
        agency_id: agency.id,
        pac_provider: settings.pac_provider,
        serie,
        receptor_rfc: agency.rfc,
        receptor_razon_social: agency.razon_social,
        receptor_regimen_fiscal: agency.regimen_fiscal || "612",
        receptor_uso_cfdi: "G03",
        receptor_codigo_postal: agency.postal_code || "06600",
        subtotal,
        iva_amount: iva,
        total,
        status: "pending",
      })
      .select()
      .single();

    if (insertError || !cfdiRecord) {
      throw new Error(`Failed to create CFDI record: ${insertError?.message}`);
    }

    const stampBody = settings.pac_provider === "facturapi"
      ? facturapiBody
      : {
          receptor: {
            rfc: agency.rfc,
            razon_social: agency.razon_social,
            regimen_fiscal: agency.regimen_fiscal || "612",
            postal_code: agency.postal_code || "06600",
            uso_cfdi: "G03",
          },
          conceptos: facturapiBody.items?.map((i: { product: { description: string; price: number } }) => ({
            descripcion: i.product.description,
            valor_unitario: i.product.price,
          })) ?? [],
          serie,
        };

    let cfdiResult: CfdiResult;
    try {
      cfdiResult = await stampCfdi(
        settings.pac_provider,
        settings.pac_api_key_encrypted!,
        settings.pac_organization_id || "",
        stampBody,
        supabase,
        settings.pac_sandbox_mode
      );
    } catch (stampError) {
      await supabase
        .from("cfdi_invoices")
        .update({
          status: "error",
          error_message: String(stampError),
          retry_count: cfdiRecord.retry_count + 1,
        })
        .eq("id", cfdiRecord.id);

      return new Response(
        JSON.stringify({ error: "PAC stamping failed", detail: String(stampError) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase
      .from("cfdi_invoices")
      .update({
        pac_invoice_id: cfdiResult.pac_invoice_id,
        uuid_fiscal: cfdiResult.uuid_fiscal,
        folio: cfdiResult.folio,
        serie: cfdiResult.serie,
        xml_url: cfdiResult.xml_url,
        pdf_url: cfdiResult.pdf_url,
        stamped_at: cfdiResult.stamped_at,
        status: "stamped",
        error_message: null,
      })
      .eq("id", cfdiRecord.id);

    EdgeRuntime.waitUntil(
      supabase.functions.invoke("send-cfdi-email", {
        body: { cfdi_invoice_id: cfdiRecord.id, recipient_type: "agency" },
      }).catch(() => {})
    );

    return new Response(
      JSON.stringify({
        success: true,
        cfdi_id: cfdiRecord.id,
        uuid_fiscal: cfdiResult.uuid_fiscal,
        xml_url: cfdiResult.xml_url,
        pdf_url: cfdiResult.pdf_url,
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
