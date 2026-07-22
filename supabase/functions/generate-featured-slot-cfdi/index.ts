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
}

interface CfdiConcepto {
  clave_prod_serv: string;
  cantidad: number;
  clave_unidad: string;
  descripcion: string;
  valor_unitario: number;
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
  organizationId: string,
  request: CfdiRequest
): Promise<CfdiResult> {
  const baseUrl = "https://www.facturapi.io/v2";

  const body: Record<string, unknown> = {
    type: request.tipo_de_comprobante,
    payment_form: request.payment_form ?? "03",
    payment_method: "PUE",
    customer: {
      legal_name: request.receptor.nombre,
      tax_id: request.receptor.rfc,
      tax_system: request.receptor.regimen_fiscal_receptor,
      address: { zip: request.receptor.domicilio_fiscal_receptor },
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { slot_id } = await req.json();

    if (!slot_id) {
      return new Response(
        JSON.stringify({ error: "slot_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Idempotencia: evitar CFDI duplicado para el mismo slot
    const { data: existing } = await supabase
      .from("cfdi_invoices")
      .select("id, status")
      .eq("featured_slot_id", slot_id)
      .in("status", ["stamped", "pending"])
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({ message: "CFDI already exists for this slot", cfdi_id: existing.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cargar datos del slot y la agencia
    const { data: slot, error: slotError } = await supabase
      .from("featured_tour_slots")
      .select(`
        id, agency_id, plan_id, status,
        subtotal, tax_amount, total_amount, payment_confirmed_at,
        featured_plans (name, duration_days, price),
        agencies (
          id, name, rfc, razon_social, regimen_fiscal, postal_code,
          users (rfc, razon_social, regimen_fiscal, uso_cfdi, codigo_postal_fiscal)
        )
      `)
      .eq("id", slot_id)
      .eq("status", "active")
      .maybeSingle();

    if (slotError || !slot) {
      return new Response(
        JSON.stringify({ error: "Slot not found or not active" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cargar configuracion de plataforma
    const { data: settings } = await supabase
      .from("platform_settings")
      .select("pac_provider, pac_api_key_encrypted, pac_organization_id, cfdi_serie_booking, pac_sandbox_mode, pac_issuer_rfc, pac_issuer_zip")
      .maybeSingle();

    if (!settings || settings.pac_provider === "none" || !settings.pac_api_key_encrypted) {
      return new Response(
        JSON.stringify({ error: "PAC provider not configured" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const agency = slot.agencies as Record<string, unknown>;
    const plan = slot.featured_plans as Record<string, unknown>;
    const agencyUser = (agency?.users as Record<string, unknown>) || {};

    // Determinar datos fiscales del receptor (agencia)
    const fallbackCP = (settings as any)?.pac_issuer_zip || "06600";
    let receptorRfc: string;
    let receptorNombre: string;
    let receptorRegimen: string;
    let receptorUsoCfdi: string;
    let receptorCP: string;

    const agencyRfc = (agency?.rfc as string) || "";
    const agencyRazon = (agency?.razon_social as string) || (agency?.name as string) || "";
    const agencyCP = (agency?.postal_code as string) || "";

    if (!agencyCP) {
      return new Response(
        JSON.stringify({ error: "La agencia no tiene Código Postal configurado en su perfil" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (agencyRfc && agencyRfc.length >= 12) {
      receptorRfc = agencyRfc;
      receptorNombre = agencyRazon;
      receptorRegimen = (agency?.regimen_fiscal as string) || (agencyUser?.regimen_fiscal as string) || "626";
      receptorUsoCfdi = (agencyUser?.uso_cfdi as string) || "G03";
      receptorCP = agencyCP;
    } else {
      receptorRfc = "XAXX010101000";
      receptorNombre = agencyRazon || "SIN NOMBRE";
      receptorRegimen = "616";
      receptorUsoCfdi = "S01";
      receptorCP = agencyCP;
    }

    const total = Number(slot.total_amount ?? plan?.price ?? 0);
    const subtotal = Math.round((total / 1.16) * 1000000) / 1000000;

    const planName = (plan?.name as string) || "Tour Destacado";
    const serie = ((settings.cfdi_serie_booking || "A") + "D");

    const cfdiRequest: CfdiRequest = {
      tipo_de_comprobante: "I",
      serie,
      receptor: {
        rfc: receptorRfc,
        nombre: receptorNombre,
        domicilio_fiscal_receptor: receptorCP,
        regimen_fiscal_receptor: receptorRegimen,
        uso_cfdi: receptorUsoCfdi,
      },
      conceptos: [
        {
          clave_prod_serv: "82101600",
          cantidad: 1,
          clave_unidad: "E48",
          descripcion: `Servicio de Publicidad Digital — Tour Destacado Plan ${planName}`,
          valor_unitario: subtotal,
        },
      ],
    };

    const iva = Math.round(total * 16 / 116 * 100) / 100;
    const subtotalFinal = Math.round((total - iva) * 100) / 100;

    // Crear registro pending
    const { data: cfdiRecord, error: insertError } = await supabase
      .from("cfdi_invoices")
      .insert({
        invoice_type: "featured_slot",
        featured_slot_id: slot_id,
        agency_id: slot.agency_id,
        pac_provider: settings.pac_provider,
        serie,
        receptor_rfc: receptorRfc,
        receptor_razon_social: receptorNombre,
        receptor_regimen_fiscal: receptorRegimen,
        receptor_uso_cfdi: receptorUsoCfdi,
        receptor_codigo_postal: receptorCP,
        subtotal: subtotalFinal,
        iva_amount: iva,
        total,
        status: "pending",
      })
      .select()
      .single();

    if (insertError || !cfdiRecord) {
      throw new Error(`Failed to create CFDI record: ${insertError?.message}`);
    }

    // Timbrar con FacturAPI
    let cfdiResult: CfdiResult;
    try {
      if (settings.pac_provider === "facturapi") {
        cfdiResult = await facturapiStamp(
          settings.pac_api_key_encrypted!,
          settings.pac_organization_id || "",
          cfdiRequest
        );
      } else {
        throw new Error(`PAC provider not supported for featured slots: ${settings.pac_provider}`);
      }
    } catch (stampError) {
      await supabase
        .from("cfdi_invoices")
        .update({
          status: "error",
          error_message: String(stampError),
          retry_count: (cfdiRecord.retry_count ?? 0) + 1,
        })
        .eq("id", cfdiRecord.id);

      return new Response(
        JSON.stringify({ error: "PAC stamping failed", detail: String(stampError) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Actualizar registro con resultado del timbre
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

    // Vincular CFDI al slot
    await supabase
      .from("featured_tour_slots")
      .update({ invoice_id: cfdiRecord.id, updated_at: new Date().toISOString() })
      .eq("id", slot_id);

    // Crear asiento contable (fire and forget)
    EdgeRuntime.waitUntil(
      supabase.rpc("create_accounting_entry_for_featured_slot", { p_slot_id: slot_id }).then(() => {}).catch(() => {})
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
