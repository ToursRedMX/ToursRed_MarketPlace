import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

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
  tercero?: {
    rfc: string;
    nombre: string;
    regimen_fiscal: string;
    domicilio_fiscal: string;
  } | null;
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

interface CfdiRequest {
  tipo_de_comprobante: string;
  serie: string;
  receptor: CfdiReceptor;
  conceptos: CfdiConcepto[];
  payment_form?: string;
  related_documents?: { relationship: string; cfdi_uuids: string[] }[];
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

  if (request.related_documents && request.related_documents.length > 0) {
    body.related_documents = request.related_documents.map((rd) => ({
      relationship: rd.relationship,
      cfdi_uuids: rd.cfdi_uuids,
    }));
  }

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const {
      booking_id,
      user_id,
      refund_amount,
      item_description,
      related_cfdi_invoice_id,
      related_cfdi_uuid,
      item_type,
      tercero_agencia,
    } = await req.json();

    if (!booking_id || !user_id || !refund_amount || !related_cfdi_invoice_id || !related_cfdi_uuid || !item_type) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!["optional_service", "supplement"].includes(item_type)) {
      return new Response(
        JSON.stringify({ error: "item_type must be 'optional_service' or 'supplement'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: settings } = await supabase
      .from("platform_settings")
      .select("pac_provider, pac_api_key_encrypted, pac_organization_id, cfdi_serie_booking")
      .maybeSingle();

    if (!settings || settings.pac_provider === "none" || !settings.pac_api_key_encrypted) {
      console.warn("PAC not configured, skipping credit note generation");
      return new Response(
        JSON.stringify({ success: true, message: "PAC not configured, skipped" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Idempotency check — avoid duplicate credit notes for the same item + amount
    const { data: existing } = await supabase
      .from("cfdi_invoices")
      .select("id, status")
      .eq("invoice_type", "credit_note")
      .eq("related_cfdi_invoice_id", related_cfdi_invoice_id)
      .eq("credit_note_for_item_type", item_type)
      .eq("total", refund_amount)
      .in("status", ["stamped", "pending"])
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({ success: true, message: "Credit note already exists", cfdi_id: existing.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: traveler } = await supabase
      .from("users")
      .select("first_name, last_name, rfc, razon_social, regimen_fiscal, uso_cfdi, codigo_postal_fiscal, is_foreign_traveler, num_reg_id_trib, residencia_fiscal")
      .eq("id", user_id)
      .maybeSingle();

    const fullName = [traveler?.first_name, traveler?.last_name].filter(Boolean).join(" ").trim();
    const isForeign = traveler?.is_foreign_traveler === true;
    const issuerPostalCode = "06600";

    let receptorRfc: string;
    let receptorNombre: string;
    let receptorRegimen: string;
    let receptorUsoCfdi: string;
    let receptorCP: string;
    let numRegIdTrib: string | undefined;
    let residenciaFiscal: string | undefined;

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
      numRegIdTrib = traveler.num_reg_id_trib;
      residenciaFiscal = traveler.residencia_fiscal;
    } else {
      receptorRfc = "XAXX010101000";
      receptorNombre = fullName || "SIN NOMBRE";
      receptorRegimen = "616";
      receptorUsoCfdi = "S01";
      receptorCP = issuerPostalCode;
    }

    const r6 = (n: number) => Math.round(n * 1000000) / 1000000;
    const subtotalBruto = r6(refund_amount / 1.16);
    const iva = Math.round(refund_amount * 16 / 116 * 100) / 100;
    const subtotal = Math.round((refund_amount - iva) * 100) / 100;
    const total = refund_amount;

    const conceptos: CfdiConcepto[] = [{
      clave_prod_serv: "90121500",
      cantidad: 1,
      clave_unidad: "E48",
      descripcion: `Nota de crédito — ${item_description}`,
      valor_unitario: subtotalBruto,
      tercero: tercero_agencia || null,
    }];

    const cfdiRequest: CfdiRequest = {
      tipo_de_comprobante: "E",
      serie: settings.cfdi_serie_booking || "A",
      receptor: {
        rfc: receptorRfc,
        nombre: receptorNombre,
        domicilio_fiscal_receptor: receptorCP,
        regimen_fiscal_receptor: receptorRegimen,
        uso_cfdi: receptorUsoCfdi,
        ...(numRegIdTrib ? { num_reg_id_trib: numRegIdTrib } : {}),
        ...(residenciaFiscal ? { residencia_fiscal: residenciaFiscal } : {}),
      },
      conceptos,
      payment_form: "03",
      related_documents: [{ relationship: "01", cfdi_uuids: [related_cfdi_uuid] }],
    };

    const { data: cfdiRecord, error: insertError } = await supabase
      .from("cfdi_invoices")
      .insert({
        invoice_type: "credit_note",
        booking_id,
        related_cfdi_invoice_id,
        tipo_relacion: "01",
        credit_note_for_item_type: item_type,
        pac_provider: settings.pac_provider,
        serie: settings.cfdi_serie_booking || "A",
        receptor_rfc: receptorRfc,
        receptor_razon_social: receptorNombre,
        receptor_regimen_fiscal: receptorRegimen,
        receptor_uso_cfdi: receptorUsoCfdi,
        receptor_codigo_postal: receptorCP,
        cfdi_type: "E",
        subtotal,
        iva_amount: iva,
        total,
        currency: "MXN",
        status: "pending",
      })
      .select()
      .single();

    if (insertError || !cfdiRecord) {
      throw new Error(`Failed to create credit note record: ${insertError?.message}`);
    }

    let cfdiResult: CfdiResult;
    try {
      cfdiResult = await facturapiStamp(
        settings.pac_api_key_encrypted!,
        settings.pac_organization_id || "",
        cfdiRequest
      );
    } catch (stampError) {
      const stampErrStr = String(stampError);
      console.error(`Credit note stamping failed: ${stampErrStr}`);
      await supabase
        .from("cfdi_invoices")
        .update({ status: "error", error_message: stampErrStr })
        .eq("id", cfdiRecord.id);

      return new Response(
        JSON.stringify({ error: "PAC stamping failed", detail: stampErrStr }),
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
        body: { cfdi_invoice_id: cfdiRecord.id, recipient_type: "traveler" },
      }).catch(() => {})
    );

    return new Response(
      JSON.stringify({
        success: true,
        cfdi_id: cfdiRecord.id,
        uuid_fiscal: cfdiResult.uuid_fiscal,
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
