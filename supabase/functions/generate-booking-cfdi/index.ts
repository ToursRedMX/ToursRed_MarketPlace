import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// =============================================
// BILLING PROVIDER INTERFACE (PAC-agnostic)
// =============================================
interface CfdiConcepto {
  clave_prod_serv: string;
  cantidad: number;
  clave_unidad: string;
  descripcion: string;
  valor_unitario: number;
  descuento?: number;
  tercero?: CfdiTercero;
  impuestos?: {
    traslados?: Array<{
      base: number;
      impuesto: string;
      tipo_factor: string;
      tasa_o_cuota: number;
      importe: number;
    }>;
  };
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

// =============================================
// FACTURAPI ADAPTER
// =============================================
async function facturapiStamp(
  apiKey: string,
  organizationId: string,
  request: CfdiRequest,
  _sandboxMode: boolean
): Promise<CfdiResult> {
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
      ...(c.tercero && c.tercero.domicilio_fiscal
        ? {
            third_party: {
              tax_id: c.tercero.rfc,
              legal_name: c.tercero.nombre,
              tax_system: c.tercero.regimen_fiscal,
              zip: c.tercero.domicilio_fiscal,
            },
          }
        : {}),
    })),
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (organizationId) {
    headers["X-Organization-Id"] = organizationId;
  }

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

// =============================================
// ZOHO BOOKS ADAPTER (uses Zoho Books Mexico CFDI stamping)
// Zoho Books Mexico edition stamps via SW Sapien internally.
// =============================================
async function zohoBooksStamp(
  supabaseClient: ReturnType<typeof createClient>,
  orgId: string,
  request: CfdiRequest,
  sandboxMode: boolean
): Promise<CfdiResult> {
  const { data: tokenRow } = await supabaseClient
    .from("zoho_oauth_tokens")
    .select("access_token, refresh_token, access_token_expires_at, api_domain")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!tokenRow) throw new Error("Zoho OAuth token not found. Connect Zoho Books in Admin Settings.");

  const expiresAt = new Date(tokenRow.access_token_expires_at).getTime();
  let accessToken = tokenRow.access_token;
  let apiDomain = tokenRow.api_domain;

  if (expiresAt - Date.now() < 5 * 60 * 1000) {
    const { data: platformSettings } = await supabaseClient
      .from("platform_settings")
      .select("zoho_client_id, zoho_client_secret, zoho_region")
      .maybeSingle();

    if (!platformSettings?.zoho_client_id || !platformSettings?.zoho_client_secret) {
      throw new Error("Zoho client credentials not configured.");
    }

    const region = platformSettings.zoho_region || "com";
    const refreshBody = new URLSearchParams({
      refresh_token: tokenRow.refresh_token,
      client_id: platformSettings.zoho_client_id,
      client_secret: platformSettings.zoho_client_secret,
      grant_type: "refresh_token",
    });

    const refreshRes = await fetch(`https://accounts.zoho.${region}/oauth/v2/token`, {
      method: "POST",
      body: refreshBody,
    });

    if (!refreshRes.ok) throw new Error("Zoho token refresh failed");
    const refreshData = await refreshRes.json();
    accessToken = refreshData.access_token;
    apiDomain = refreshData.api_domain ?? apiDomain;
    const newExpiry = new Date(Date.now() + (refreshData.expires_in ?? 3600) * 1000).toISOString();

    await supabaseClient.from("zoho_oauth_tokens").update({
      access_token: accessToken,
      access_token_expires_at: newExpiry,
      api_domain: apiDomain,
    }).eq("refresh_token", tokenRow.refresh_token);
  }

  const baseUrl = `${apiDomain}/books/v3`;
  const headers = {
    Authorization: `Zoho-oauthtoken ${accessToken}`,
    "Content-Type": "application/json",
  };

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
      if (c.tercero) {
        item.cf_tercero_rfc = c.tercero.rfc;
        item.cf_tercero_nombre = c.tercero.nombre;
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

// =============================================
// PROVIDER DISPATCHER (add new PACs here)
// =============================================
async function stampCfdi(
  provider: string,
  apiKey: string,
  orgId: string,
  request: CfdiRequest,
  sandboxMode: boolean,
  supabaseClient?: ReturnType<typeof createClient>
): Promise<CfdiResult> {
  switch (provider) {
    case "zoho_books":
      if (!supabaseClient) throw new Error("supabaseClient required for zoho_books provider");
      return zohoBooksStamp(supabaseClient, orgId, request, sandboxMode);
    case "facturapi":
      return facturapiStamp(apiKey, orgId, request, sandboxMode);
    default:
      throw new Error(`Unknown PAC provider: ${provider}. Supported: zoho_books, facturapi`);
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

    const { booking_id, checkin_charge_id, payment_form } = await req.json();
    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isCheckinCharge = !!checkin_charge_id;

    // Check if a CFDI already exists (stamped or pending) for this booking/charge
    const existingQuery = isCheckinCharge
      ? supabase
          .from("cfdi_invoices")
          .select("id, status")
          .eq("checkin_charge_id", checkin_charge_id)
          .in("status", ["stamped", "pending"])
          .maybeSingle()
      : supabase
          .from("cfdi_invoices")
          .select("id, status")
          .eq("booking_id", booking_id)
          .eq("invoice_type", "booking")
          .in("status", ["stamped", "pending"])
          .maybeSingle();

    const { data: existingCfdi } = await existingQuery;

    if (existingCfdi) {
      return new Response(
        JSON.stringify({ message: "CFDI already exists", cfdi_id: existingCfdi.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load booking details
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        id, total_price, deposit_amount, service_charge, user_id, tour_id, booking_code,
        discount_amount, service_charge_discount,
        travel_insurance_included, travel_insurance_cost,
        membership_purchased, membership_cost, membership_plan,
        tours (name, agency_id)
      `)
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      return new Response(JSON.stringify({ error: "Booking not found", detail: bookingError?.message }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tourData = booking.tours as { name: string; agency_id: string } | null;

    // Load agency data separately to avoid join ambiguity
    let agencyData: { id: string; rfc?: string; razon_social?: string; regimen_fiscal?: string; postal_code?: string } | null = null;
    if (tourData?.agency_id) {
      const { data: agFetch } = await supabase
        .from("agencies")
        .select("id, rfc, razon_social, regimen_fiscal, postal_code")
        .eq("id", tourData.agency_id)
        .maybeSingle();
      agencyData = agFetch;
    }

    // Load traveler fiscal data separately (users table has RLS on joins)
    const { data: travelerData } = await supabase
      .from("users")
      .select("id, first_name, last_name, rfc, razon_social, regimen_fiscal, uso_cfdi, codigo_postal_fiscal, is_foreign_traveler, num_reg_id_trib, residencia_fiscal")
      .eq("id", booking.user_id)
      .maybeSingle();

    // Load platform settings
    const { data: settings } = await supabase
      .from("platform_settings")
      .select(
        "pac_provider, pac_api_key_encrypted, pac_organization_id, cfdi_serie_booking, pac_sandbox_mode, pac_issuer_rfc, pac_issuer_razon_social, pac_issuer_regimen_fiscal"
      )
      .maybeSingle();

    if (!settings || settings.pac_provider === "none" || !settings.pac_api_key_encrypted) {
      return new Response(
        JSON.stringify({ error: "PAC provider not configured" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // -------------------------------------------------------
    // MONTOS: difieren según si es cobro de check-in o reserva
    // -------------------------------------------------------
    let precioTourBruto: number;
    let precioServicioBruto: number;
    let precioSeguroBruto: number;
    let precioMembresiaBruto: number;
    let descuentoTour: number;
    let descuentoServicio: number;
    let invoiceType: string;
    let effectivePaymentForm: string;
    let exactTotal: number; // monto exacto cobrado al cliente (IVA incluido)

    if (isCheckinCharge) {
      // Cargar montos desde wallet_checkin_charges
      const { data: checkinCharge, error: checkinError } = await supabase
        .from("wallet_checkin_charges")
        .select("amount_charged, service_charge_applied, membership_exemption_used")
        .eq("id", checkin_charge_id)
        .maybeSingle();

      if (checkinError || !checkinCharge) {
        return new Response(
          JSON.stringify({ error: "Checkin charge not found", detail: checkinError?.message }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const amountCharged = Number(checkinCharge.amount_charged);
      const netServiceCharge = Number(checkinCharge.service_charge_applied) - Number(checkinCharge.membership_exemption_used);

      // r6: 6 decimales para valor_unitario en FacturAPI (evita error de centavo en XML)
      const r6 = (n: number) => Math.round(n * 1000000) / 1000000;

      precioTourBruto = r6(amountCharged / 1.16);
      precioServicioBruto = netServiceCharge > 0 ? r6(netServiceCharge / 1.16) : 0;
      precioSeguroBruto = 0;
      precioMembresiaBruto = 0;
      descuentoTour = 0;
      descuentoServicio = 0;
      exactTotal = amountCharged + (netServiceCharge > 0 ? netServiceCharge : 0);
      invoiceType = "checkin_wallet";
      effectivePaymentForm = payment_form || "17";
    } else {
      // Montos de la reserva original
      const depositAmount = Number((booking as any).deposit_amount || booking.total_price);
      const serviceCharge = Number((booking as any).service_charge || 0);
      const discountAmountRaw = Number((booking as any).discount_amount || 0);
      const serviceChargeDiscountRaw = Number((booking as any).service_charge_discount || 0);
      const insuranceCost = (booking as any).travel_insurance_included ? Number((booking as any).travel_insurance_cost || 0) : 0;

      // r6 definido en bloque anterior; también aplica aquí
      const r6b = (n: number) => Math.round(n * 1000000) / 1000000;

      const membershipIncluded = (booking as any).membership_purchased === true;
      const membershipCost = membershipIncluded ? Number((booking as any).membership_cost || 0) : 0;

      precioTourBruto = r6b(depositAmount / 1.16);
      precioServicioBruto = serviceCharge > 0 ? r6b(serviceCharge / 1.16) : 0;
      precioSeguroBruto = insuranceCost > 0 ? r6b(insuranceCost / 1.16) : 0;
      precioMembresiaBruto = membershipCost > 0 ? r6b(membershipCost / 1.16) : 0;
      descuentoTour = discountAmountRaw > 0 ? r6b(discountAmountRaw / 1.16) : 0;
      descuentoServicio = serviceChargeDiscountRaw > 0 ? r6b(serviceChargeDiscountRaw / 1.16) : 0;
      exactTotal = Math.round((depositAmount + serviceCharge + insuranceCost + membershipCost - discountAmountRaw - serviceChargeDiscountRaw) * 100) / 100;
      invoiceType = "booking";
      effectivePaymentForm = payment_form || "03";

      if (discountAmountRaw > 0 || serviceChargeDiscountRaw > 0) {
        console.log(`CFDI con descuento: tour -${discountAmountRaw} MXN, servicio -${serviceChargeDiscountRaw} MXN`);
      }
    }

    // Add paid optional services total to exactTotal and build concepts
    const { data: paidOptionals } = await supabase
      .from("booking_optional_services")
      .select("service_kind, description, subtotal, total_paid")
      .eq("booking_id", booking.id)
      .eq("is_cancelled", false)
      .not("paid_at", "is", null);

    if (paidOptionals && paidOptionals.length > 0) {
      const optionalsTotal = paidOptionals.reduce((sum: number, opt: any) => sum + (opt.total_paid || opt.subtotal), 0);
      exactTotal = Math.round((exactTotal + optionalsTotal) * 100) / 100;
    }
    const iva = Math.round(exactTotal * 16 / 116 * 100) / 100;
    const subtotal = Math.round((exactTotal - iva) * 100) / 100;
    const total = exactTotal;

    // Build receptor data from separately-fetched traveler following SAT rules:
    // - Traveler with Mexican RFC: use their own fiscal data
    // - National traveler without RFC: XAXX010101000, their real name, 616/S01, issuer postal code
    // - Foreign traveler without RFC: XEXX010101000, their real name, 616/S01, issuer postal code
    // - Foreign traveler with NumRegIdTrib+ResidenciaFiscal: same as above + add those fields
    const traveler = travelerData;
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

    // Build "a cuenta de terceros" (agency pass-through) — solo aplica al concepto del tour
    // SAT CFDI40188: el RFC del tercero no puede coincidir con el del emisor ni el del receptor
    let terceroAgencia: CfdiTercero | undefined;
    if (
      agencyData?.rfc &&
      agencyData?.razon_social &&
      agencyData.rfc !== receptorRfc &&
      agencyData.rfc !== settings.pac_issuer_rfc
    ) {
      terceroAgencia = {
        rfc: agencyData.rfc,
        nombre: agencyData.razon_social,
        regimen_fiscal: agencyData.regimen_fiscal || "612",
        domicilio_fiscal: agencyData.postal_code || "06600",
      };
    }

    const tourName = tourData?.name || "";
    const bookingRef = booking.booking_code || booking.id;
    const checkinLabel = isCheckinCharge ? " (cobro en check-in)" : "";

    const conceptos: CfdiConcepto[] = [
      {
        clave_prod_serv: "90121500",
        cantidad: 1,
        clave_unidad: "E48",
        descripcion: `Servicio de viaje: ${tourName} (Reserva ${bookingRef})${checkinLabel}`,
        valor_unitario: precioTourBruto,
        ...(descuentoTour > 0 ? { descuento: descuentoTour } : {}),
        tercero: terceroAgencia,
      },
    ];

    if (precioServicioBruto > 0) {
      conceptos.push({
        clave_prod_serv: "81141600",
        cantidad: 1,
        clave_unidad: "E48",
        descripcion: `Cargo por servicio de plataforma (Reserva ${bookingRef})${checkinLabel}`,
        valor_unitario: precioServicioBruto,
        ...(descuentoServicio > 0 ? { descuento: descuentoServicio } : {}),
      });
    }

    if (precioSeguroBruto > 0) {
      conceptos.push({
        clave_prod_serv: "84111506",
        cantidad: 1,
        clave_unidad: "E48",
        descripcion: `Seguro de asistencia de viaje (Reserva ${bookingRef})`,
        valor_unitario: precioSeguroBruto,
      });
    }

    if (precioMembresiaBruto > 0) {
      const planLabel = (booking as any).membership_plan === "annual" ? "anual" : "mensual";
      conceptos.push({
        clave_prod_serv: "80141628",
        cantidad: 1,
        clave_unidad: "E48",
        descripcion: `Membresia ToursRed Plus (${planLabel}) - Reserva ${bookingRef}`,
        valor_unitario: precioMembresiaBruto,
      });
    }

    // Add paid optional services (pickup, language, traditional optionals) as separate concepts
    if (paidOptionals && paidOptionals.length > 0) {
      for (const opt of paidOptionals) {
        const optAmount = opt.total_paid || opt.subtotal;
        if (optAmount <= 0) continue;
        const optBruto = Math.round((optAmount / 1.16) * 100) / 100;
        const claveProdServ = opt.service_kind === "pickup"
          ? "78111804"
          : opt.service_kind === "language"
            ? "90121702"
            : "90121500";
        conceptos.push({
          clave_prod_serv: claveProdServ,
          cantidad: 1,
          clave_unidad: "E48",
          descripcion: opt.description || (opt.service_kind === "pickup" ? "Pick Up" : opt.service_kind === "language" ? "Idioma/Intérprete" : "Servicio opcional"),
          valor_unitario: optBruto,
          tercero: terceroAgencia,
        });
      }
    }

    const cfdiRequest: CfdiRequest = {
      tipo_de_comprobante: "I",
      serie: settings.cfdi_serie_booking || "A",
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
      payment_form: effectivePaymentForm,
    };

    // Descuento total consolidado (con IVA incluido)
    const descuentoTotal = Math.round((descuentoTour + descuentoServicio) * 1.16 * 100) / 100;

    // Create pending CFDI record
    const { data: cfdiRecord, error: insertError } = await supabase
      .from("cfdi_invoices")
      .insert({
        invoice_type: invoiceType,
        booking_id: booking.id,
        ...(isCheckinCharge ? { checkin_charge_id } : {}),
        agency_id: agencyData?.id || null,
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
        ...(descuentoTotal > 0 ? { discount_amount: descuentoTotal } : {}),
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
      cfdiResult = await stampCfdi(
        settings.pac_provider,
        settings.pac_api_key_encrypted!,
        settings.pac_organization_id || "",
        cfdiRequest,
        settings.pac_sandbox_mode,
        supabase
      );
    } catch (stampError) {
      const stampErrStr = String(stampError);
      console.error(`CFDI stamping failed for booking ${booking.id}: ${stampErrStr}`);
      await supabase
        .from("cfdi_invoices")
        .update({
          status: "error",
          error_message: stampErrStr,
          retry_count: cfdiRecord.retry_count + 1,
        })
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
