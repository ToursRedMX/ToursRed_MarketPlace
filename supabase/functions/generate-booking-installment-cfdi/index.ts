import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// =============================================
// PAC-AGNOSTIC TYPES (same pattern as generate-booking-cfdi)
// =============================================
interface CfdiConcepto {
  clave_prod_serv: string;
  cantidad: number;
  clave_unidad: string;
  descripcion: string;
  valor_unitario: number;
  descuento?: number;
  tercero?: CfdiTercero;
}

interface CfdiReceptor {
  rfc: string;
  nombre: string;
  domicilio_fiscal_receptor: string;
  regimen_fiscal_receptor: string;
  uso_cfdi: string;
  num_reg_id_trib?: string;
  residencia_fiscal?: string;
}

interface CfdiTercero {
  rfc: string;
  nombre: string;
  regimen_fiscal: string;
  domicilio_fiscal: string;
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

async function facturapiStamp(apiKey: string, orgId: string, request: CfdiRequest): Promise<CfdiResult> {
  const baseUrl = "https://www.facturapi.io/v2";
  const isForeignWithTaxId = request.receptor.rfc === "XEXX010101000" && request.receptor.num_reg_id_trib;
  const effectiveTaxId = isForeignWithTaxId ? request.receptor.num_reg_id_trib! : request.receptor.rfc;
  const address: Record<string, unknown> = { zip: request.receptor.domicilio_fiscal_receptor };
  if (request.receptor.residencia_fiscal) address.country = request.receptor.residencia_fiscal;

  const body: Record<string, unknown> = {
    type: request.tipo_de_comprobante,
    payment_form: request.payment_form ?? "03",
    payment_method: "PUE",
    customer: {
      legal_name: request.receptor.nombre,
      tax_id: effectiveTaxId,
      tax_system: request.receptor.regimen_fiscal_receptor,
      address,
    },
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
      ...(c.descuento != null && c.descuento > 0 ? { discount: c.descuento } : {}),
      ...(c.tercero && c.tercero.domicilio_fiscal
        ? { third_party: { tax_id: c.tercero.rfc, legal_name: c.tercero.nombre, tax_system: c.tercero.regimen_fiscal, zip: c.tercero.domicilio_fiscal } }
        : {}),
    })),
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (orgId) headers["X-Organization-Id"] = orgId;

  const res = await fetch(`${baseUrl}/invoices`, { method: "POST", headers, body: JSON.stringify(body) });
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

async function zohoBooksStamp(supabaseClient: ReturnType<typeof createClient>, orgId: string, request: CfdiRequest, sandboxMode: boolean): Promise<CfdiResult> {
  const { data: tokenRow } = await supabaseClient
    .from("zoho_oauth_tokens")
    .select("access_token, refresh_token, access_token_expires_at, api_domain")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!tokenRow) throw new Error("Zoho OAuth token not found.");

  const expiresAt = new Date(tokenRow.access_token_expires_at).getTime();
  let accessToken = tokenRow.access_token;
  let apiDomain = tokenRow.api_domain;

  if (expiresAt - Date.now() < 5 * 60 * 1000) {
    const { data: ps } = await supabaseClient.from("platform_settings").select("zoho_client_id, zoho_client_secret, zoho_region").maybeSingle();
    if (!ps?.zoho_client_id || !ps?.zoho_client_secret) throw new Error("Zoho client credentials not configured.");
    const region = ps.zoho_region || "com";
    const refreshBody = new URLSearchParams({ refresh_token: tokenRow.refresh_token, client_id: ps.zoho_client_id, client_secret: ps.zoho_client_secret, grant_type: "refresh_token" });
    const refreshRes = await fetch(`https://accounts.zoho.${region}/oauth/v2/token`, { method: "POST", body: refreshBody });
    if (!refreshRes.ok) throw new Error("Zoho token refresh failed");
    const refreshData = await refreshRes.json();
    accessToken = refreshData.access_token;
    apiDomain = refreshData.api_domain ?? apiDomain;
    const newExpiry = new Date(Date.now() + (refreshData.expires_in ?? 3600) * 1000).toISOString();
    await supabaseClient.from("zoho_oauth_tokens").update({ access_token: accessToken, access_token_expires_at: newExpiry, api_domain: apiDomain }).eq("refresh_token", tokenRow.refresh_token);
  }

  const baseUrl = `${apiDomain}/books/v3`;
  const headers = { Authorization: `Zoho-oauthtoken ${accessToken}`, "Content-Type": "application/json" };
  const zohoInvoice: Record<string, unknown> = {
    customer_id: request.receptor.rfc,
    reference_number: request.serie,
    date: new Date().toISOString().split("T")[0],
    currency_code: "MXN",
    line_items: request.conceptos.map((c) => ({
      name: c.descripcion, description: c.descripcion, quantity: c.cantidad, rate: c.valor_unitario, tax_percentage: 16,
      ...(c.descuento != null && c.descuento > 0 ? { discount: c.descuento, discount_type: "entity_level" } : {}),
      ...(c.tercero ? { cf_tercero_rfc: c.tercero.rfc, cf_tercero_nombre: c.tercero.nombre } : {}),
    })),
    is_inclusive_tax: false,
    notes: sandboxMode ? "[SANDBOX - CFDI de prueba]" : undefined,
  };

  const res = await fetch(`${baseUrl}/invoices?organization_id=${orgId}`, { method: "POST", headers, body: JSON.stringify(zohoInvoice) });
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

async function stampCfdi(provider: string, apiKey: string, orgId: string, request: CfdiRequest, sandboxMode: boolean, supabaseClient?: ReturnType<typeof createClient>): Promise<CfdiResult> {
  switch (provider) {
    case "zoho_books":
      if (!supabaseClient) throw new Error("supabaseClient required for zoho_books provider");
      return zohoBooksStamp(supabaseClient, orgId, request, sandboxMode);
    case "facturapi":
      return facturapiStamp(apiKey, orgId, request);
    default:
      throw new Error(`Unknown PAC provider: ${provider}`);
  }
}

// =============================================
// MAIN HANDLER
// =============================================
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { installment_id, transaction_id, payment_form } = await req.json();
    if (!installment_id) {
      return new Response(JSON.stringify({ error: "installment_id es requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency check
    const { data: existingCfdi } = await supabase
      .from("cfdi_invoices")
      .select("id, status")
      .eq("installment_id", installment_id)
      .eq("invoice_type", "booking_installment")
      .in("status", ["stamped", "pending"])
      .maybeSingle();

    if (existingCfdi) {
      return new Response(JSON.stringify({ message: "CFDI ya existe", cfdi_id: existingCfdi.id }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load installment with full context
    const { data: installment } = await supabase
      .from("booking_payment_plan_installments")
      .select(`
        id, installment_number, label, amount_due, amount_paid, penalty_applied, due_date,
        booking_id,
        booking_payment_plans!inner(
          id,
          bookings!inner(
            id, user_id, booking_code, tour_id,
            tours!inner(id, name, agency_id)
          )
        )
      `)
      .eq("id", installment_id)
      .maybeSingle();

    if (!installment) {
      return new Response(JSON.stringify({ error: "Parcialidad no encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const plan = (installment.booking_payment_plans as any);
    const booking = plan.bookings as any;
    const tour = booking.tours as any;

    // Load platform settings
    const { data: settings } = await supabase
      .from("platform_settings")
      .select("pac_provider, pac_api_key_encrypted, pac_organization_id, cfdi_serie_installment, pac_sandbox_mode, pac_issuer_rfc, pac_issuer_razon_social, pac_issuer_regimen_fiscal")
      .maybeSingle();

    if (!settings || settings.pac_provider === "none" || !settings.pac_api_key_encrypted) {
      return new Response(JSON.stringify({ error: "PAC provider no configurado" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load agency data
    let agencyData: { id: string; rfc?: string; razon_social?: string; regimen_fiscal?: string; postal_code?: string } | null = null;
    if (tour?.agency_id) {
      const { data: agFetch } = await supabase
        .from("agencies")
        .select("id, rfc, razon_social, regimen_fiscal, postal_code")
        .eq("id", tour.agency_id)
        .maybeSingle();
      agencyData = agFetch;
    }

    // Load traveler fiscal data
    const { data: traveler } = await supabase
      .from("users")
      .select("id, first_name, last_name, rfc, razon_social, regimen_fiscal, uso_cfdi, codigo_postal_fiscal, is_foreign_traveler, num_reg_id_trib, residencia_fiscal")
      .eq("id", booking.user_id)
      .maybeSingle();

    // Total amount for this installment (including penalty if any)
    const installmentTotal = parseFloat((Number(installment.amount_due) + Number(installment.penalty_applied)).toFixed(2));
    const r6 = (n: number) => Math.round(n * 1000000) / 1000000;

    const exactTotal = installmentTotal;
    const iva = Math.round(exactTotal * 16 / 116 * 100) / 100;
    const subtotal = Math.round((exactTotal - iva) * 100) / 100;
    const total = exactTotal;

    const precioTourBruto = r6(installmentTotal / 1.16);

    // Receptor logic (same rules as generate-booking-cfdi)
    const fullName = [traveler?.first_name, traveler?.last_name].filter(Boolean).join(" ").trim();
    const isForeign = traveler?.is_foreign_traveler === true;
    const issuerPostalCode = agencyData?.postal_code || "06600";

    let receptorRfc: string;
    let receptorNombre: string;
    let receptorRegimen: string;
    let receptorUsoCfdi: string;
    let receptorCP: string;
    let receptorNumRegIdTrib: string | undefined;
    let receptorResidenciaFiscal: string | undefined;

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
      receptorNumRegIdTrib = traveler.num_reg_id_trib;
      if (traveler?.residencia_fiscal) receptorResidenciaFiscal = traveler.residencia_fiscal;
    } else {
      receptorRfc = "XAXX010101000";
      receptorNombre = fullName || "SIN NOMBRE";
      receptorRegimen = "616";
      receptorUsoCfdi = "S01";
      receptorCP = issuerPostalCode;
    }

    // A cuenta de terceros (agency)
    let terceroAgencia: CfdiTercero | undefined;
    if (agencyData?.rfc && agencyData?.razon_social && agencyData.rfc !== receptorRfc && agencyData.rfc !== settings.pac_issuer_rfc) {
      terceroAgencia = {
        rfc: agencyData.rfc,
        nombre: agencyData.razon_social,
        regimen_fiscal: agencyData.regimen_fiscal || "612",
        domicilio_fiscal: agencyData.postal_code || "06600",
      };
    }

    const tourName = tour?.name || "";
    const bookingCode = booking.booking_code ?? booking.id;
    const serie = settings.cfdi_serie_installment || "AI";

    const conceptos: CfdiConcepto[] = [
      {
        clave_prod_serv: "90121500",
        cantidad: 1,
        clave_unidad: "E48",
        descripcion: `${installment.label}: ${tourName} (Reserva ${bookingCode}) - Parcialidad ${installment.installment_number}`,
        valor_unitario: precioTourBruto,
        tercero: terceroAgencia,
      },
    ];

    const cfdiRequest: CfdiRequest = {
      tipo_de_comprobante: "I",
      serie,
      receptor: {
        rfc: receptorRfc,
        nombre: receptorNombre,
        domicilio_fiscal_receptor: receptorCP,
        regimen_fiscal_receptor: receptorRegimen,
        uso_cfdi: receptorUsoCfdi,
        ...(receptorNumRegIdTrib ? { num_reg_id_trib: receptorNumRegIdTrib } : {}),
        ...(receptorResidenciaFiscal ? { residencia_fiscal: receptorResidenciaFiscal } : {}),
      },
      conceptos,
      payment_form: payment_form || "03",
    };

    // Create pending CFDI record
    const { data: cfdiRecord, error: insertError } = await supabase
      .from("cfdi_invoices")
      .insert({
        invoice_type: "booking_installment",
        booking_id: booking.id,
        installment_id,
        booking_payment_plan_transaction_id: transaction_id ?? null,
        agency_id: agencyData?.id ?? null,
        pac_provider: settings.pac_provider,
        serie,
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
      cfdiResult = await stampCfdi(settings.pac_provider, settings.pac_api_key_encrypted!, settings.pac_organization_id || "", cfdiRequest, settings.pac_sandbox_mode, supabase);
    } catch (stampError) {
      const stampErrStr = String(stampError);
      console.error(`CFDI installment stamping failed for installment ${installment_id}: ${stampErrStr}`);
      await supabase.from("cfdi_invoices").update({
        status: "error",
        error_message: stampErrStr,
        retry_count: cfdiRecord.retry_count + 1,
      }).eq("id", cfdiRecord.id);

      return new Response(JSON.stringify({ error: "Error al timbrar con PAC", detail: stampErrStr }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update CFDI record with stamped data
    await supabase.from("cfdi_invoices").update({
      pac_invoice_id: cfdiResult.pac_invoice_id,
      uuid_fiscal: cfdiResult.uuid_fiscal,
      folio: cfdiResult.folio,
      serie: cfdiResult.serie,
      xml_url: cfdiResult.xml_url,
      pdf_url: cfdiResult.pdf_url,
      stamped_at: cfdiResult.stamped_at,
      status: "stamped",
      error_message: null,
    }).eq("id", cfdiRecord.id);

    // Update installment with cfdi reference
    await supabase.from("booking_payment_plan_installments").update({
      cfdi_invoice_id: cfdiRecord.id,
    }).eq("id", installment_id);

    // Send email notification (fire and forget)
    EdgeRuntime.waitUntil(
      supabase.functions.invoke("send-cfdi-email", {
        body: { cfdi_invoice_id: cfdiRecord.id, recipient_type: "traveler" },
      }).catch(() => {})
    );

    return new Response(JSON.stringify({
      success: true,
      cfdi_id: cfdiRecord.id,
      uuid_fiscal: cfdiResult.uuid_fiscal,
      xml_url: cfdiResult.xml_url,
      pdf_url: cfdiResult.pdf_url,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
