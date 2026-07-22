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
  descuento?: number;
}

interface CfdiRequest {
  tipo_de_comprobante: string;
  serie: string;
  receptor: {
    rfc: string; nombre: string; domicilio_fiscal_receptor: string;
    regimen_fiscal_receptor: string; uso_cfdi: string;
    num_reg_id_trib?: string; residencia_fiscal?: string;
  };
  conceptos: CfdiConcepto[];
  payment_form?: string;
}

interface CfdiResult {
  pac_invoice_id: string; uuid_fiscal: string; folio: string;
  serie: string; xml_url: string; pdf_url: string; stamped_at: string;
}

const r6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

async function facturapiStamp(apiKey: string, organizationId: string, request: CfdiRequest): Promise<CfdiResult> {
  const baseUrl = "https://www.facturapi.io/v2";
  const isForeign = request.receptor.rfc === "XEXX010101000" && request.receptor.num_reg_id_trib;
  const effectiveTaxId = isForeign ? request.receptor.num_reg_id_trib! : request.receptor.rfc;
  const address: Record<string, unknown> = { zip: request.receptor.domicilio_fiscal_receptor };
  if (request.receptor.residencia_fiscal) address.country = request.receptor.residencia_fiscal;

  const body: Record<string, unknown> = {
    type: request.tipo_de_comprobante,
    series: request.serie,
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
    })),
  };

  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  if (organizationId) headers["X-Organization-Id"] = organizationId;

  const res = await fetch(`${baseUrl}/invoices`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`FacturAPI error ${res.status}: ${await res.text()}`);
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { booking_id, service_charge, total_paid, payment_method } = await req.json();
    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id es requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency
    const { data: existingCfdi } = await supabase
      .from("cfdi_invoices")
      .select("id, status")
      .eq("booking_id", booking_id)
      .eq("invoice_type", "post_booking_insurance")
      .in("status", ["stamped", "pending"])
      .maybeSingle();

    if (existingCfdi) {
      return new Response(JSON.stringify({ message: "CFDI ya existe", cfdi_id: existingCfdi.id }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load booking
    const { data: bookingData } = await supabase
      .from("bookings")
      .select("id, user_id, tour_id, agency_id, travel_insurance_cost, travel_insurance_included, booking_code")
      .eq("id", booking_id)
      .maybeSingle();

    if (!bookingData) {
      return new Response(JSON.stringify({ error: "Reserva no encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!bookingData.travel_insurance_included) {
      return new Response(JSON.stringify({ error: "La reserva no tiene seguro incluido" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const insuranceCost = Number(total_paid ?? bookingData.travel_insurance_cost ?? 0);
    const netServiceCharge = Number(service_charge ?? 0);
    const exactTotal = insuranceCost;

    // Load agency
    let agencyData: { id: string; postal_code?: string } | null = null;
    if (bookingData.agency_id) {
      const { data: ag } = await supabase
        .from("agencies")
        .select("id, postal_code")
        .eq("id", bookingData.agency_id)
        .maybeSingle();
      agencyData = ag;
    }

    // Load traveler
    const { data: traveler } = await supabase
      .from("users")
      .select("id, first_name, last_name, rfc, razon_social, regimen_fiscal, uso_cfdi, codigo_postal_fiscal, is_foreign_traveler, num_reg_id_trib, residencia_fiscal")
      .eq("id", bookingData.user_id)
      .maybeSingle();

    // Load PAC settings
    const { data: settings } = await supabase
      .from("platform_settings")
      .select("pac_provider, pac_api_key_encrypted, pac_organization_id, cfdi_serie_booking")
      .maybeSingle();

    if (!settings || settings.pac_provider === "none") {
      return new Response(JSON.stringify({ error: "PAC no configurado" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const issuerPostalCode = agencyData?.postal_code || "06600";
    const fullName = [traveler?.first_name, traveler?.last_name].filter(Boolean).join(" ").trim();
    const isForeign = traveler?.is_foreign_traveler === true;

    let receptorRfc: string, receptorNombre: string, receptorRegimen: string,
      receptorUsoCfdi: string, receptorCP: string,
      receptorNumRegIdTrib: string | undefined, receptorResidenciaFiscal: string | undefined;

    if (traveler?.rfc && traveler.rfc.length >= 12) {
      receptorRfc = traveler.rfc;
      receptorNombre = traveler.razon_social || fullName || traveler.rfc;
      receptorRegimen = traveler.regimen_fiscal || "616";
      receptorUsoCfdi = traveler.uso_cfdi || "S01";
      receptorCP = traveler.codigo_postal_fiscal || issuerPostalCode;
    } else if (isForeign && traveler?.num_reg_id_trib) {
      receptorRfc = "XEXX010101000";
      receptorNombre = fullName || "EXTRANJERO";
      receptorRegimen = "616"; receptorUsoCfdi = "S01"; receptorCP = issuerPostalCode;
      receptorNumRegIdTrib = traveler.num_reg_id_trib;
      if (traveler?.residencia_fiscal) receptorResidenciaFiscal = traveler.residencia_fiscal;
    } else {
      receptorRfc = "XAXX010101000";
      receptorNombre = fullName || "SIN NOMBRE";
      receptorRegimen = "616"; receptorUsoCfdi = "S01"; receptorCP = issuerPostalCode;
    }

    // Insurance: NO tercero node (ToursRed invoices directly)
    const bookingRef = bookingData.booking_code || booking_id.slice(0, 8).toUpperCase();
    const serie = (settings.cfdi_serie_booking || "A") + "I";

    const precioSeguroBruto = r6(insuranceCost / 1.16);
    const precioServicioCargo = netServiceCharge > 0 ? r6(netServiceCharge / 1.16) : 0;

    const iva = Math.round(exactTotal * 16 / 116 * 100) / 100;
    const subtotal_db = Math.round((exactTotal - iva) * 100) / 100;

    const conceptos: CfdiConcepto[] = [
      {
        clave_prod_serv: "84111506",
        cantidad: 1,
        clave_unidad: "E48",
        descripcion: `Seguro de asistencia de viaje post-reserva (Ref. ${bookingRef})`,
        valor_unitario: precioSeguroBruto,
      },
    ];

    if (precioServicioCargo > 0) {
      conceptos.push({
        clave_prod_serv: "81141600",
        cantidad: 1,
        clave_unidad: "E48",
        descripcion: `Cargo por servicio de plataforma - Seguro (Ref. ${bookingRef})`,
        valor_unitario: precioServicioCargo,
      });
    }

    const cfdiRequest: CfdiRequest = {
      tipo_de_comprobante: "I",
      serie,
      receptor: {
        rfc: receptorRfc, nombre: receptorNombre,
        domicilio_fiscal_receptor: receptorCP,
        regimen_fiscal_receptor: receptorRegimen,
        uso_cfdi: receptorUsoCfdi,
        ...(receptorNumRegIdTrib ? { num_reg_id_trib: receptorNumRegIdTrib } : {}),
        ...(receptorResidenciaFiscal ? { residencia_fiscal: receptorResidenciaFiscal } : {}),
      },
      conceptos,
      payment_form: payment_method === "stripe" ? "04" : payment_method === "paypal" ? "04" : payment_method === "mercadopago" ? "04" : "03",
    };

    const { data: cfdiRecord, error: insertError } = await supabase
      .from("cfdi_invoices")
      .insert({
        invoice_type: "post_booking_insurance",
        booking_id,
        agency_id: bookingData.agency_id || null,
        pac_provider: settings.pac_provider,
        serie,
        receptor_rfc: receptorRfc,
        receptor_razon_social: receptorNombre,
        receptor_regimen_fiscal: receptorRegimen,
        receptor_uso_cfdi: receptorUsoCfdi,
        receptor_codigo_postal: receptorCP,
        subtotal: subtotal_db,
        iva_amount: iva,
        total: exactTotal,
        status: "pending",
      })
      .select()
      .single();

    if (insertError || !cfdiRecord) {
      throw new Error(`Error creando registro CFDI: ${insertError?.message}`);
    }

    let cfdiResult: CfdiResult;
    try {
      if (settings.pac_provider !== "facturapi") {
        throw new Error(`PAC ${settings.pac_provider} no soportado. Usa facturapi.`);
      }
      cfdiResult = await facturapiStamp(settings.pac_api_key_encrypted!, settings.pac_organization_id || "", cfdiRequest);
    } catch (stampError) {
      await supabase.from("cfdi_invoices").update({
        status: "error",
        error_message: String(stampError),
        retry_count: cfdiRecord.retry_count + 1,
      }).eq("id", cfdiRecord.id);
      return new Response(JSON.stringify({ error: "Error al timbrar CFDI", detail: String(stampError) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    EdgeRuntime.waitUntil(
      supabase.functions.invoke("send-cfdi-email", {
        body: { cfdi_invoice_id: cfdiRecord.id, recipient_type: "traveler" },
      }).catch(() => {})
    );

    return new Response(JSON.stringify({
      success: true, cfdi_id: cfdiRecord.id,
      uuid_fiscal: cfdiResult.uuid_fiscal,
      xml_url: cfdiResult.xml_url,
      pdf_url: cfdiResult.pdf_url,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
