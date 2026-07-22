import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface CfdiConcepto {
  clave_prod_serv: string;
  cantidad: number;
  clave_unidad: string;
  descripcion: string;
  valor_unitario: number;
  descuento?: number;
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
  payment_method?: string;
  // Complemento de pago (tipo P)
  payment_complement?: {
    related_uuid: string;
    num_parcialidad: number;
    imp_saldo_ant: number;
    imp_pagado: number;
    imp_saldo_insoluto: number;
  };
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

interface RequestBody {
  cfdi_type: "I" | "E" | "P";
  receptor: CfdiReceptor;
  conceptos: CfdiConcepto[];
  payment_form: string;
  payment_method?: "PUE" | "PPD";
  accounting_account_code?: string;
  source_notes?: string;
  recipient_id?: string;
  // Solo para tipo P
  payment_complement?: {
    related_uuid: string;
    num_parcialidad: number;
    imp_saldo_ant: number;
    imp_pagado: number;
    imp_saldo_insoluto: number;
  };
}

// ─── FacturAPI Adapter ────────────────────────────────────────────────────────

async function facturapiStamp(
  apiKey: string,
  organizationId: string,
  request: CfdiRequest,
  sandboxMode: boolean
): Promise<CfdiResult> {
  const baseUrl = "https://www.facturapi.io/v2";

  const address: Record<string, unknown> = { zip: request.receptor.domicilio_fiscal_receptor };

  const customer: Record<string, unknown> = {
    legal_name: request.receptor.nombre,
    tax_id: request.receptor.rfc,
    tax_system: request.receptor.regimen_fiscal_receptor,
    address,
  };

  const paymentMethod = request.payment_method ?? "PUE";

  // Para tipo P (complemento de pago) FacturAPI usa un endpoint diferente
  if (request.tipo_de_comprobante === "P" && request.payment_complement) {
    const pc = request.payment_complement;
    const payBody: Record<string, unknown> = {
      type: "P",
      customer,
      use: request.receptor.uso_cfdi,
      // El complemento de pago en FacturAPI v2 usa "related_documents"
      payment: {
        form: request.payment_form ?? "03",
        related_documents: [
          {
            uuid: pc.related_uuid,
            serie: request.serie,
            installment: pc.num_parcialidad,
            last_balance: pc.imp_saldo_ant,
            amount: pc.imp_pagado,
            taxes: [{ type: "IVA", rate: 0.16, factor: "Tasa" }],
          },
        ],
      },
    };

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    if (organizationId) headers["X-Organization-Id"] = organizationId;

    const res = await fetch(`${baseUrl}/invoices`, {
      method: "POST",
      headers,
      body: JSON.stringify(payBody),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`FacturAPI complemento de pago error ${res.status}: ${err}`);
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

  // Tipos I y E — factura normal o nota de crédito
  const body: Record<string, unknown> = {
    type: request.tipo_de_comprobante,
    payment_form: request.payment_form ?? "03",
    payment_method: paymentMethod,
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

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body: RequestBody = await req.json();

    // Validaciones básicas
    if (!body.cfdi_type || !["I", "E", "P"].includes(body.cfdi_type)) {
      return new Response(JSON.stringify({ error: "cfdi_type debe ser I, E o P" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!body.receptor?.rfc || !body.receptor?.nombre) {
      return new Response(JSON.stringify({ error: "receptor.rfc y receptor.nombre son requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (body.cfdi_type !== "P" && (!body.conceptos || body.conceptos.length === 0)) {
      return new Response(JSON.stringify({ error: "Se requiere al menos un concepto para tipo I o E" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (body.cfdi_type === "P" && !body.payment_complement) {
      return new Response(JSON.stringify({ error: "payment_complement es requerido para tipo P" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cargar configuracion del PAC
    const { data: settings } = await supabase
      .from("platform_settings")
      .select("pac_provider, pac_api_key_encrypted, pac_organization_id, cfdi_serie_booking, pac_sandbox_mode")
      .maybeSingle();

    if (!settings?.pac_provider || settings.pac_provider === "none" || !settings.pac_api_key_encrypted) {
      return new Response(JSON.stringify({ error: "PAC provider no configurado" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calcular totales para el registro
    const paymentMethod = body.payment_method ?? "PUE";
    let subtotal = 0;
    let ivaAmount = 0;

    if (body.cfdi_type !== "P" && body.conceptos) {
      for (const c of body.conceptos) {
        const base = Math.round((c.valor_unitario - (c.descuento ?? 0)) * c.cantidad * 100) / 100;
        subtotal += base;
        ivaAmount += Math.round(base * 0.16 * 100) / 100;
      }
    } else if (body.cfdi_type === "P" && body.payment_complement) {
      subtotal = body.payment_complement.imp_pagado;
      ivaAmount = 0; // El complemento de pago no lleva IVA propio
    }

    const total = Math.round((subtotal + ivaAmount) * 100) / 100;
    subtotal = Math.round(subtotal * 100) / 100;
    ivaAmount = Math.round(ivaAmount * 100) / 100;

    // Determinar serie según tipo
    const serie = settings.cfdi_serie_booking ?? "A";

    const cfdiRequest: CfdiRequest = {
      tipo_de_comprobante: body.cfdi_type,
      serie,
      receptor: body.receptor,
      conceptos: body.conceptos ?? [],
      payment_form: body.payment_form ?? "03",
      payment_method: paymentMethod,
      payment_complement: body.payment_complement,
    };

    // Crear registro pendiente
    const { data: cfdiRecord, error: insertErr } = await supabase
      .from("cfdi_invoices")
      .insert({
        invoice_type: "manual",
        is_manual: true,
        cfdi_type: body.cfdi_type,
        payment_method_sat: paymentMethod,
        pac_provider: settings.pac_provider,
        serie,
        receptor_rfc: body.receptor.rfc,
        receptor_razon_social: body.receptor.nombre,
        receptor_regimen_fiscal: body.receptor.regimen_fiscal_receptor,
        receptor_uso_cfdi: body.receptor.uso_cfdi,
        receptor_codigo_postal: body.receptor.domicilio_fiscal_receptor,
        subtotal,
        iva_amount: ivaAmount,
        total,
        accounting_account_code: body.accounting_account_code ?? null,
        source_notes: body.source_notes ?? null,
        status: "pending",
      })
      .select()
      .single();

    if (insertErr || !cfdiRecord) {
      throw new Error(`Error al crear registro CFDI: ${insertErr?.message}`);
    }

    // Timbrar con PAC
    let cfdiResult: CfdiResult;
    try {
      if (settings.pac_provider !== "facturapi") {
        throw new Error("Solo FacturAPI está soportado para CFDI manual en esta versión");
      }
      cfdiResult = await facturapiStamp(
        settings.pac_api_key_encrypted!,
        settings.pac_organization_id ?? "",
        cfdiRequest,
        settings.pac_sandbox_mode ?? false
      );
    } catch (stampErr) {
      await supabase
        .from("cfdi_invoices")
        .update({ status: "error", error_message: String(stampErr), retry_count: cfdiRecord.retry_count + 1 })
        .eq("id", cfdiRecord.id);

      return new Response(JSON.stringify({ error: "Error al timbrar", detail: String(stampErr) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Actualizar con datos del timbrado
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

    // Generar asiento contable automáticamente
    EdgeRuntime.waitUntil(
      supabase.rpc("create_accounting_entry_for_manual_cfdi", {
        p_cfdi_invoice_id: cfdiRecord.id,
      }).then(({ error }) => { if (error) console.error("Error asiento contable:", error); })
    );

    // Guardar o actualizar receptor en directorio si se solicitó
    if (body.recipient_id) {
      EdgeRuntime.waitUntil(
        supabase
          .from("manual_cfdi_recipients")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", body.recipient_id)
          .then(() => {})
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        cfdi_id: cfdiRecord.id,
        uuid_fiscal: cfdiResult.uuid_fiscal,
        folio: cfdiResult.folio,
        xml_url: cfdiResult.xml_url,
        pdf_url: cfdiResult.pdf_url,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
