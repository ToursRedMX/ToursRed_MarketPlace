import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface CfdiReceptor {
  rfc: string;
  nombre: string;
  domicilio_fiscal_receptor: string;
  regimen_fiscal_receptor: string;
  uso_cfdi: string;
  num_reg_id_trib?: string;
  residencia_fiscal?: string;
}

interface CfdiConcepto {
  clave_prod_serv: string;
  cantidad: number;
  clave_unidad: string;
  descripcion: string;
  valor_unitario: number;
  descuento?: number;
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

async function facturapiStamp(apiKey: string, organizationId: string, request: CfdiRequest): Promise<CfdiResult> {
  const baseUrl = "https://www.facturapi.io/v2";

  const isForeignWithTaxId = request.receptor.rfc === "XEXX010101000" && request.receptor.num_reg_id_trib;
  const effectiveTaxId = isForeignWithTaxId ? request.receptor.num_reg_id_trib! : request.receptor.rfc;

  const address: Record<string, unknown> = { zip: request.receptor.domicilio_fiscal_receptor };
  if (request.receptor.residencia_fiscal) address.country = request.receptor.residencia_fiscal;

  const customer: Record<string, unknown> = {
    legal_name: request.receptor.nombre,
    tax_id: effectiveTaxId,
    tax_system: request.receptor.regimen_fiscal_receptor,
    address,
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
      ...(c.descuento != null && c.descuento > 0 ? { discount: c.descuento } : {}),
    })),
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (organizationId) headers["X-Organization-Id"] = organizationId;

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
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  request: CfdiRequest,
  sandboxMode: boolean
): Promise<CfdiResult> {
  const { data: tokenRow } = await supabase
    .from("zoho_oauth_tokens")
    .select("access_token, refresh_token, access_token_expires_at, api_domain")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!tokenRow) throw new Error("Zoho OAuth token not found.");

  let accessToken = tokenRow.access_token;
  let apiDomain = tokenRow.api_domain;
  const expiresAt = new Date(tokenRow.access_token_expires_at).getTime();

  if (expiresAt - Date.now() < 5 * 60 * 1000) {
    const { data: ps } = await supabase.from("platform_settings").select("zoho_client_id, zoho_client_secret, zoho_region").maybeSingle();
    if (!ps?.zoho_client_id || !ps?.zoho_client_secret) throw new Error("Zoho client credentials not configured.");
    const region = ps.zoho_region || "com";
    const refreshRes = await fetch(`https://accounts.zoho.${region}/oauth/v2/token`, {
      method: "POST",
      body: new URLSearchParams({
        refresh_token: tokenRow.refresh_token,
        client_id: ps.zoho_client_id,
        client_secret: ps.zoho_client_secret,
        grant_type: "refresh_token",
      }),
    });
    if (!refreshRes.ok) throw new Error("Zoho token refresh failed");
    const rd = await refreshRes.json();
    accessToken = rd.access_token;
    apiDomain = rd.api_domain ?? apiDomain;
    await supabase.from("zoho_oauth_tokens").update({
      access_token: accessToken,
      access_token_expires_at: new Date(Date.now() + (rd.expires_in ?? 3600) * 1000).toISOString(),
      api_domain: apiDomain,
    }).eq("refresh_token", tokenRow.refresh_token);
  }

  const baseUrl = `${apiDomain}/books/v3`;
  const headers = { Authorization: `Zoho-oauthtoken ${accessToken}`, "Content-Type": "application/json" };

  const zohoInvoice: Record<string, unknown> = {
    customer_id: request.receptor.rfc,
    reference_number: request.serie,
    date: new Date().toISOString().split("T")[0],
    currency_code: "MXN",
    line_items: request.conceptos.map((c) => {
      const item: Record<string, unknown> = {
        name: c.descripcion,
        description: c.descripcion,
        quantity: c.cantidad,
        rate: c.valor_unitario,
        tax_percentage: 16,
      };
      if (c.descuento != null && c.descuento > 0) {
        item.discount = c.descuento;
        item.discount_type = "entity_level";
      }
      return item;
    }),
    is_inclusive_tax: false,
    notes: sandboxMode ? "[SANDBOX - CFDI de prueba]" : undefined,
  };

  const res = await fetch(`${baseUrl}/invoices?organization_id=${orgId}`, {
    method: "POST",
    headers,
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

    const { membership_id, stripe_invoice_id, stripe_amount_paid } = await req.json();

    if (!membership_id) {
      return new Response(
        JSON.stringify({ error: "membership_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Idempotencia: evitar CFDI duplicado para el mismo periodo de Stripe
    if (stripe_invoice_id) {
      const { data: existing } = await supabase
        .from("cfdi_invoices")
        .select("id, status")
        .eq("stripe_invoice_id", stripe_invoice_id)
        .in("status", ["stamped", "pending"])
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ message: "CFDI already exists for this stripe invoice", cfdi_id: existing.id }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      // Sin stripe_invoice_id: evitar duplicado por membership_id (alta nueva)
      const { data: existing } = await supabase
        .from("cfdi_invoices")
        .select("id, status")
        .eq("membership_id", membership_id)
        .is("stripe_invoice_id", null)
        .in("status", ["stamped", "pending"])
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ message: "CFDI already exists for this membership", cfdi_id: existing.id }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Cargar datos de la membresía
    const { data: membership, error: memError } = await supabase
      .from("memberships")
      .select("id, user_id, plan_type, status, current_period_start, current_period_end")
      .eq("id", membership_id)
      .maybeSingle();

    if (memError || !membership) {
      return new Response(
        JSON.stringify({ error: "Membership not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cargar datos fiscales del usuario
    const { data: traveler } = await supabase
      .from("users")
      .select("id, first_name, last_name, rfc, razon_social, regimen_fiscal, uso_cfdi, codigo_postal_fiscal, is_foreign_traveler, num_reg_id_trib, residencia_fiscal")
      .eq("id", membership.user_id)
      .maybeSingle();

    // Cargar configuración de plataforma
    const { data: settings } = await supabase
      .from("platform_settings")
      .select("pac_provider, pac_api_key_encrypted, pac_organization_id, cfdi_serie_booking, pac_sandbox_mode, pac_issuer_rfc, membership_monthly_price, membership_annual_price")
      .maybeSingle();

    if (!settings || settings.pac_provider === "none" || !settings.pac_api_key_encrypted) {
      return new Response(
        JSON.stringify({ error: "PAC provider not configured" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determinar precio según plan (precio bruto de catálogo, siempre sin descuento)
    const isAnnual = membership.plan_type === "annual";
    const membershipPrice = isAnnual
      ? Number(settings.membership_annual_price || 999)
      : Number(settings.membership_monthly_price || 99);

    // Si se recibe stripe_amount_paid (centavos), calcular el descuento aplicado
    // Solo aplica al primer pago con cupón; renovaciones no llevan descuento
    const amountPaidMxn = stripe_amount_paid != null ? Math.round(Number(stripe_amount_paid)) / 100 : null;
    const hasDiscount = amountPaidMxn != null && amountPaidMxn < membershipPrice - 0.01;

    // 6 decimales para valor_unitario en FacturAPI (evita error de centavo en XML)
    const precioMembresiaBase = Math.round((membershipPrice / 1.16) * 1000000) / 1000000;

    // Descuento sin IVA: 6 decimales para que FacturAPI calcule IVA sobre el neto exacto
    const descuentoConIva = hasDiscount ? Math.round((membershipPrice - amountPaidMxn!) * 100) / 100 : 0;
    const descuentoBase = descuentoConIva > 0 ? Math.round((descuentoConIva / 1.16) * 1000000) / 1000000 : 0;

    // Monto exacto cobrado al cliente; IVA como complemento → subtotal + iva = total siempre
    const exactTotal = amountPaidMxn ?? membershipPrice;
    const iva = Math.round(exactTotal * 16 / 116 * 100) / 100;
    const subtotal = Math.round((exactTotal - iva) * 100) / 100;
    const total = exactTotal;

    if (hasDiscount) {
      console.log(`CFDI membresía con descuento: precio catálogo $${membershipPrice}, pagado $${amountPaidMxn}, descuento -$${descuentoConIva} MXN, total CFDI $${total} MXN`);
    }

    // Construir receptor siguiendo las reglas del SAT
    const fullName = [traveler?.first_name, traveler?.last_name].filter(Boolean).join(" ").trim();
    const isForeign = traveler?.is_foreign_traveler === true;

    let receptorRfc: string;
    let receptorNombre: string;
    let receptorRegimen: string;
    let receptorUsoCfdi: string;
    let receptorCP: string;
    let receptorNumRegIdTrib: string | undefined;
    let receptorResidenciaFiscal: string | undefined;

    const issuerPostalCode = "06600";

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

    const planLabel = isAnnual ? "Anual" : "Mensual";
    const periodoStart = membership.current_period_start
      ? new Date(membership.current_period_start).toLocaleDateString("es-MX", { month: "long", year: "numeric" })
      : new Date().toLocaleDateString("es-MX", { month: "long", year: "numeric" });

    const concepto: CfdiConcepto = {
      clave_prod_serv: "81161500",
      cantidad: 1,
      clave_unidad: "E48",
      descripcion: `Suscripcion ToursRed Plus ${planLabel} - ${periodoStart}`,
      valor_unitario: precioMembresiaBase,
      ...(descuentoBase > 0 ? { descuento: descuentoBase } : {}),
    };

    const serie = (settings.cfdi_serie_booking || "A") + "M";

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
      conceptos: [concepto],
    };

    // Crear registro pending
    const { data: cfdiRecord, error: insertError } = await supabase
      .from("cfdi_invoices")
      .insert({
        invoice_type: "membership",
        membership_id: membership.id,
        stripe_invoice_id: stripe_invoice_id || null,
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
        ...(descuentoConIva > 0 ? { discount_amount: descuentoConIva } : {}),
        status: "pending",
      })
      .select()
      .single();

    if (insertError || !cfdiRecord) {
      throw new Error(`Failed to create CFDI record: ${insertError?.message}`);
    }

    // Timbrar con PAC
    let cfdiResult: CfdiResult;
    try {
      if (settings.pac_provider === "facturapi") {
        cfdiResult = await facturapiStamp(
          settings.pac_api_key_encrypted!,
          settings.pac_organization_id || "",
          cfdiRequest
        );
      } else if (settings.pac_provider === "zoho_books") {
        cfdiResult = await zohoBooksStamp(supabase, settings.pac_organization_id || "", cfdiRequest, settings.pac_sandbox_mode);
      } else {
        throw new Error(`Unknown PAC provider: ${settings.pac_provider}`);
      }
    } catch (stampError) {
      await supabase
        .from("cfdi_invoices")
        .update({ status: "error", error_message: String(stampError), retry_count: cfdiRecord.retry_count + 1 })
        .eq("id", cfdiRecord.id);

      return new Response(
        JSON.stringify({ error: "PAC stamping failed", detail: String(stampError) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Actualizar registro con resultado
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

    // Enviar email (fire and forget)
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
