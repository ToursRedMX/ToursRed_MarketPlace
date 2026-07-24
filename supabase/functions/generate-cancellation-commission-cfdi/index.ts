import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface CfdiConcepto {
  clave_prod_serv: string;
  cantidad: number;
  clave_unidad: string;
  descripcion: string;
  valor_unitario: number;
}

interface CfdiReceptor {
  rfc: string;
  nombre: string;
  domicilio_fiscal_receptor: string;
  regimen_fiscal_receptor: string;
  uso_cfdi: string;
}

interface CfdiRequest {
  tipo_de_comprobante: string;
  serie: string;
  receptor: CfdiReceptor;
  conceptos: CfdiConcepto[];
  payment_form?: string;
}

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
  request: CfdiRequest
): Promise<CfdiResult> {
  const baseUrl = "https://www.facturapi.io/v2";

  const customer: Record<string, unknown> = {
    legal_name: request.receptor.nombre,
    tax_id: request.receptor.rfc,
    tax_system: request.receptor.regimen_fiscal_receptor,
    address: { zip: request.receptor.domicilio_fiscal_receptor },
  };

  const body: Record<string, unknown> = {
    type: request.tipo_de_comprobante,
    payment_form: request.payment_form ?? "03",
    payment_method: "PUE",
    customer,
    use: request.receptor.uso_cfdi,
    items: request.conceptos.map((c) => ({
      product: {
        description: c.descripcion,
        product_key: c.clave_prod_serv,
        unit_key: c.clave_unidad,
        price: c.valor_unitario,
        tax_included: false,
        taxes: [{ type: "IVA", rate: 0.16 }],
      },
      quantity: c.cantidad,
    })),
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (orgId) headers["X-Organization-Id"] = orgId;

  const res = await fetch(`${baseUrl}/invoices`, {
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
    serie: data.series ?? request.serie,
    xml_url: `${baseUrl}/invoices/${data.id}/xml`,
    pdf_url: `${baseUrl}/invoices/${data.id}/pdf`,
    stamped_at: data.created_at ?? new Date().toISOString(),
  };
}

async function zohoBooksStamp(
  supabaseClient: ReturnType<typeof createClient>,
  orgId: string,
  request: CfdiRequest
): Promise<CfdiResult> {
  const { data: tokenRow } = await supabaseClient
    .from("zoho_oauth_tokens")
    .select("access_token, refresh_token, access_token_expires_at, api_domain")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!tokenRow) throw new Error("Zoho OAuth token not found.");

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
    await supabaseClient.from("zoho_oauth_tokens").update({
      access_token: accessToken,
      access_token_expires_at: new Date(Date.now() + (rd.expires_in ?? 3600) * 1000).toISOString(),
      api_domain: apiDomain,
    }).eq("refresh_token", tokenRow.refresh_token);
  }

  const baseUrl = `${apiDomain}/books/v3`;
  const zohoInvoice: Record<string, unknown> = {
    customer_id: request.receptor.rfc,
    reference_number: request.serie,
    date: new Date().toISOString().split("T")[0],
    currency_code: "MXN",
    line_items: request.conceptos.map((c) => ({
      name: c.descripcion,
      description: c.descripcion,
      quantity: c.cantidad,
      rate: c.valor_unitario,
      tax_percentage: 16,
    })),
    is_inclusive_tax: false,
  };

  const res = await fetch(`${baseUrl}/invoices?organization_id=${orgId}`, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(zohoInvoice),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Zoho Books error ${res.status}: ${err}`);
  }

  const data = await res.json() as { invoice: { invoice_id: string; invoice_number: string; created_time: string } };
  const inv = data.invoice;
  return {
    pac_invoice_id: inv.invoice_id,
    uuid_fiscal: inv.invoice_id,
    folio: inv.invoice_number ?? "",
    serie: request.serie,
    xml_url: `${baseUrl}/invoices/${inv.invoice_id}?organization_id=${orgId}&accept=xml`,
    pdf_url: `${baseUrl}/invoices/${inv.invoice_id}?organization_id=${orgId}&accept=pdf`,
    stamped_at: inv.created_time ?? new Date().toISOString(),
  };
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

    const { booking_id, cancellation_id, replaces_cfdi_invoice_id } = await req.json();

    if (!booking_id || !cancellation_id) {
      return new Response(
        JSON.stringify({ error: "booking_id and cancellation_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Idempotency: check if a replacement CFDI already exists for this cancellation
    const { data: existing } = await supabase
      .from("cfdi_invoices")
      .select("id, status")
      .eq("cancellation_id", cancellation_id)
      .eq("invoice_type", "cancellation_commission")
      .in("status", ["stamped", "pending"])
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({ success: true, message: "Replacement CFDI already exists", cfdi_id: existing.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load the cancellation record to get the exact amounts
    const { data: cancellation, error: cancellationError } = await supabase
      .from("booking_cancellations")
      .select("original_service_charge, service_charge_refunded_amount, refund_amount_to_traveler, total_principal_paid")
      .eq("id", cancellation_id)
      .maybeSingle();

    if (cancellationError || !cancellation) {
      return new Response(
        JSON.stringify({ error: "Cancellation record not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate the retained service charge using the explicit field
    const originalServiceCharge = Number(cancellation.original_service_charge || 0);
    const serviceChargeRefunded = Number(cancellation.service_charge_refunded_amount || 0);
    const conservedAmount = originalServiceCharge - serviceChargeRefunded;

    // If nothing was retained, no replacement CFDI needed
    if (conservedAmount <= 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No service charge retained — no replacement CFDI needed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load booking for booking_code and tour name
    const { data: booking } = await supabase
      .from("bookings")
      .select("booking_code, user_id, tour_id, tours(name)")
      .eq("id", booking_id)
      .maybeSingle();

    if (!booking) {
      return new Response(
        JSON.stringify({ error: "Booking not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load platform settings for PAC
    const { data: settings } = await supabase
      .from("platform_settings")
      .select("pac_provider, pac_api_key_encrypted, pac_organization_id, cfdi_serie_booking, pac_issuer_rfc, pac_issuer_razon_social, pac_issuer_regimen_fiscal")
      .maybeSingle();

    if (!settings || settings.pac_provider === "none" || !settings.pac_api_key_encrypted) {
      return new Response(
        JSON.stringify({ error: "PAC provider not configured" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load traveler for receptor resolution
    const { data: traveler } = await supabase
      .from("users")
      .select("first_name, last_name, rfc, razon_social, regimen_fiscal, uso_cfdi, codigo_postal_fiscal, is_foreign_traveler, num_reg_id_trib, residencia_fiscal")
      .eq("id", booking.user_id)
      .maybeSingle();

    // Resolve receptor following SAT rules (same as generate-booking-cfdi)
    const fullName = [traveler?.first_name, traveler?.last_name].filter(Boolean).join(" ").trim();
    const isForeign = traveler?.is_foreign_traveler === true;
    const issuerPostalCode = "06600";

    let receptorRfc: string;
    let receptorNombre: string;
    let receptorRegimen: string;
    let receptorUsoCfdi: string;
    let receptorCP: string;

    if (traveler?.rfc && traveler.rfc.length >= 12) {
      receptorRfc = traveler.rfc;
      receptorNombre = traveler.razon_social || fullName || traveler.rfc;
      receptorRegimen = traveler.regimen_fiscal || "616";
      receptorUsoCfdi = traveler.uso_cfdi || "S01";
      receptorCP = traveler.codigo_postal_fiscal || issuerPostalCode;
    } else if (isForeign && traveler?.num_reg_id_trib) {
      receptorRfc = "XEXX010101000";
      receptorNombre = fullName || "EXTRANJERO";
      receptorRegimen = "616";
      receptorUsoCfdi = "S01";
      receptorCP = issuerPostalCode;
    } else {
      receptorRfc = "XAXX010101000";
      receptorNombre = fullName || "SIN NOMBRE";
      receptorRegimen = "616";
      receptorUsoCfdi = "S01";
      receptorCP = issuerPostalCode;
    }

    const tourName = (booking.tours as any)?.name || "";
    const bookingRef = booking.booking_code || booking_id;

    // Build CFDI: single concept for the retained service charge
    // This is a direct income CFDI (no tercero/agency pass-through)
    const r6 = (n: number) => Math.round(n * 1000000) / 1000000;
    const subtotalBruto = r6(conservedAmount / 1.16);
    const iva = Math.round(conservedAmount * 16 / 116 * 100) / 100;
    const subtotal = Math.round((conservedAmount - iva) * 100) / 100;
    const total = conservedAmount;

    const conceptos: CfdiConcepto[] = [{
      clave_prod_serv: "81141600",
      cantidad: 1,
      clave_unidad: "E48",
      descripcion: `Cargo por servicio de plataforma - Reserva ${bookingRef} (cancelada)${tourName ? ` - ${tourName}` : ""}`,
      valor_unitario: subtotalBruto,
    }];

    const cfdiRequest: CfdiRequest = {
      tipo_de_comprobante: "I",
      serie: settings.cfdi_serie_booking || "A",
      receptor: {
        rfc: receptorRfc,
        nombre: receptorNombre,
        domicilio_fiscal_receptor: receptorCP,
        regimen_fiscal_receptor: receptorRegimen,
        uso_cfdi: receptorUsoCfdi,
      },
      conceptos,
      payment_form: "03",
    };

    // Create pending CFDI record
    const { data: cfdiRecord, error: insertError } = await supabase
      .from("cfdi_invoices")
      .insert({
        invoice_type: "cancellation_commission",
        booking_id,
        cancellation_id,
        replaces_cfdi_invoice_id: replaces_cfdi_invoice_id || null,
        pac_provider: settings.pac_provider,
        serie: settings.cfdi_serie_booking || "A",
        receptor_rfc: receptorRfc,
        receptor_razon_social: receptorNombre,
        receptor_regimen_fiscal: receptorRegimen,
        receptor_uso_cfdi: receptorUsoCfdi,
        receptor_codigo_postal: receptorCP,
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

    // Stamp with PAC
    let cfdiResult: CfdiResult;
    try {
      if (settings.pac_provider === "zoho_books") {
        cfdiResult = await zohoBooksStamp(supabase, settings.pac_organization_id || "", cfdiRequest);
      } else {
        cfdiResult = await facturapiStamp(settings.pac_api_key_encrypted!, settings.pac_organization_id || "", cfdiRequest);
      }
    } catch (stampError) {
      const stampErrStr = String(stampError);
      console.error(`Replacement CFDI stamping failed: ${stampErrStr}`);
      await supabase
        .from("cfdi_invoices")
        .update({ status: "error", error_message: stampErrStr })
        .eq("id", cfdiRecord.id);

      return new Response(
        JSON.stringify({ error: "PAC stamping failed", detail: stampErrStr }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update CFDI record with stamped data
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

    // Send email notification (fire and forget)
    EdgeRuntime.waitUntil(
      supabase.functions.invoke("send-cfdi-email", {
        body: { cfdi_invoice_id: cfdiRecord.id, recipient_type: "traveler" },
      }).catch(() => {})
    );

    return new Response(
      JSON.stringify({
        success: true,
        cfdi_id: cfdiRecord.id,
        uuid_fiscal: cfdiResult.uuid_fiscal,
        conserved_amount: conservedAmount,
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
