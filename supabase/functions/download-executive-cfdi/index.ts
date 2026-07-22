import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const commissionId = url.searchParams.get("commission_id");
    const fileType = url.searchParams.get("file_type");

    if (!commissionId || !fileType || !["xml", "pdf"].includes(fileType)) {
      return new Response(JSON.stringify({ error: "commission_id y file_type (xml|pdf) son requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: commission } = await supabaseAdmin
      .from("executive_commissions")
      .select("id, executive_id, cfdi_xml_url, cfdi_pdf_url")
      .eq("id", commissionId)
      .maybeSingle();

    if (!commission) {
      return new Response(JSON.stringify({ error: "Comisión no encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userData } = await supabaseAdmin.from("users").select("role").eq("id", user.id).maybeSingle();
    const isAdmin = userData?.role === "admin" || userData?.role === "super_admin";

    const { data: exec } = await supabaseAdmin
      .from("account_executives")
      .select("id, user_id, facturapi_api_key_encrypted")
      .eq("id", commission.executive_id)
      .maybeSingle();

    if (!exec) {
      return new Response(JSON.stringify({ error: "Ejecutivo no encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isOwner = exec.user_id === user.id;
    if (!isAdmin && !isOwner) {
      return new Response(JSON.stringify({ error: "Acceso denegado" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!exec.facturapi_api_key_encrypted) {
      return new Response(JSON.stringify({ error: "El ejecutivo no tiene FacturAPI configurado" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract FacturAPI invoice ID from stored URL
    const storedUrl = fileType === "pdf" ? commission.cfdi_pdf_url : commission.cfdi_xml_url;
    if (!storedUrl) {
      return new Response(JSON.stringify({ error: "URL de archivo no disponible" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // URL format: https://www.facturapi.io/v2/invoices/{id}/xml or /pdf
    const match = storedUrl.match(/\/invoices\/([^\/]+)\//);
    if (!match) {
      return new Response(JSON.stringify({ error: "No se pudo extraer el ID de la factura" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const invoiceId = match[1];
    const facturApiUrl = `https://www.facturapi.io/v2/invoices/${invoiceId}/${fileType}`;

    const fileRes = await fetch(facturApiUrl, {
      headers: { Authorization: `Bearer ${exec.facturapi_api_key_encrypted}` },
    });

    if (!fileRes.ok) {
      const errText = await fileRes.text();
      return new Response(JSON.stringify({ error: `FacturAPI error ${fileRes.status}`, detail: errText }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contentType = fileType === "pdf" ? "application/pdf" : "application/xml";
    const disposition = fileType === "pdf" ? "inline" : "attachment";
    const filename = `CFDI-comision-${commissionId}.${fileType}`;

    return new Response(fileRes.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Content-Disposition": `${disposition}; filename="${filename}"`,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
