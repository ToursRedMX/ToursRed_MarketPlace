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

async function facturapiStamp(apiKey: string, body: Record<string, unknown>): Promise<CfdiResult> {
  const res = await fetch("https://www.facturapi.io/v2/invoices", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { commission_ids } = await req.json() as { commission_ids: string[] };
    if (!commission_ids || commission_ids.length === 0) {
      return new Response(JSON.stringify({ error: "commission_ids is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: commissions, error: commError } = await supabase
      .from("executive_commissions")
      .select("id, executive_id, amount, commission_type, agencies(id, name)")
      .in("id", commission_ids)
      .eq("status", "pending");

    if (commError || !commissions || commissions.length === 0) {
      return new Response(JSON.stringify({ error: "No pending commissions found with those IDs" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const executiveIds = [...new Set(commissions.map((c: any) => c.executive_id))];
    if (executiveIds.length > 1) {
      return new Response(JSON.stringify({ error: "All commissions must belong to the same executive" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const executiveId = executiveIds[0] as string;

    const { data: exec } = await supabase
      .from("account_executives")
      .select("id, user_id, first_name, last_name, tax_rfc, tax_name, tax_regimen_fiscal, tax_zip, tax_withhold_isr, facturapi_api_key_encrypted, facturapi_organization_id")
      .eq("id", executiveId)
      .maybeSingle();

    if (!exec) {
      return new Response(JSON.stringify({ error: "Executive not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userData } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
    const isAdmin = userData?.role === "admin";
    const isOwner = exec.user_id === user.id;

    if (!isAdmin && !isOwner) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!exec.facturapi_api_key_encrypted) {
      return new Response(
        JSON.stringify({ error: "El ejecutivo no tiene FacturAPI configurado. Configúralo en Mi Perfil." }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!exec.tax_rfc || !exec.tax_name) {
      return new Response(
        JSON.stringify({ error: "El ejecutivo no tiene RFC o razón social fiscal configurados. Actualiza tus datos fiscales en Mi Perfil." }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: platform } = await supabase
      .from("platform_settings")
      .select("pac_issuer_rfc, pac_issuer_razon_social, pac_issuer_regimen_fiscal, pac_issuer_zip, cfdi_serie_commission")
      .maybeSingle();

    if (!platform?.pac_issuer_rfc || !platform?.pac_issuer_razon_social) {
      return new Response(
        JSON.stringify({ error: "No se han configurado los datos fiscales de ToursRed (PAC issuer). Configúralos en Configuración > Facturación." }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const totalAmount = commissions.reduce((s: number, c: any) => s + Number(c.amount), 0);
    const subtotalFacturapi = Math.round((totalAmount / 1.16) * 1000000) / 1000000;
    const ivaAmount = Math.round(totalAmount * 16 / 116 * 100) / 100;
    const subtotal = Math.round((totalAmount - ivaAmount) * 100) / 100;
    const withholdIsr = exec.tax_withhold_isr === true;
    const isrAmount = withholdIsr ? Math.round(subtotal * 0.10 * 100) / 100 : 0;

    const serie = platform.cfdi_serie_commission || "B";
    const description = `Honorarios / Comisiones de ejecutivo de cuenta — ${commissions.map((c: any) => (c.agencies as any)?.name || c.id).join(", ")}`;

    const taxes: Record<string, unknown>[] = [
      { type: "IVA", rate: 0.16, factor: "Tasa", withholding: false },
    ];
    if (withholdIsr) taxes.push({ type: "ISR", rate: 0.10, factor: "Tasa", withholding: true });

    const facturapiBody = {
      type: "I",
      series: serie,
      payment_form: "03",
      payment_method: "PUE",
      customer: {
        legal_name: platform.pac_issuer_razon_social,
        tax_id: platform.pac_issuer_rfc,
        tax_system: platform.pac_issuer_regimen_fiscal || "601",
        address: { zip: (platform as any).pac_issuer_zip || "11560" },
      },
      items: [{
        product: {
          description,
          product_key: "80141600",
          unit_key: "E48",
          price: subtotalFacturapi,
          tax_included: false,
          taxes,
        },
        quantity: 1,
      }],
    };

    let cfdiResult: CfdiResult;
    try {
      cfdiResult = await facturapiStamp(exec.facturapi_api_key_encrypted, facturapiBody);
    } catch (stampError) {
      return new Response(
        JSON.stringify({ error: "Error al timbrar con FacturAPI", detail: String(stampError) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date().toISOString();
    for (const comm of commissions) {
      await supabase.from("executive_commissions").update({
        status: "invoiced",
        cfdi_xml_url: cfdiResult.xml_url,
        cfdi_pdf_url: cfdiResult.pdf_url,
        cfdi_uuid_fiscal: cfdiResult.uuid_fiscal,
        cfdi_total: totalAmount,
        cfdi_uploaded_at: now,
      }).eq("id", (comm as any).id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        uuid_fiscal: cfdiResult.uuid_fiscal,
        xml_url: cfdiResult.xml_url,
        pdf_url: cfdiResult.pdf_url,
        folio: cfdiResult.folio,
        serie: cfdiResult.serie,
        stamped_at: cfdiResult.stamped_at,
        amounts: {
          subtotal,
          iva: ivaAmount,
          isr_retenido: isrAmount,
          total: totalAmount,
          neto_a_cobrar: Math.round((totalAmount - isrAmount) * 100) / 100,
        },
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
