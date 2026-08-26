import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as Sentry from "npm:@sentry/deno@9";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    tracesSampleRate: 0.1,
  });
}

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
      .select("id, executive_id, pac_invoice_id, cfdi_source, cfdi_xml_url, cfdi_pdf_url")
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

    const storedUrl = fileType === "pdf" ? commission.cfdi_pdf_url : commission.cfdi_xml_url;

    // Un CFDI subido a mano vive en Supabase Storage, no en el PAC. Se sirve desde
    // ahi: ese ejecutivo normalmente NO tiene FacturAPI configurado, y exigirselo
    // era lo que devolvia 422 en su propia descarga.
    const isManual = commission.cfdi_source === "manual" ||
      (!commission.pac_invoice_id && !!storedUrl && !storedUrl.includes("facturapi.io"));

    let fileRes: Response;

    if (isManual) {
      if (fileType === "pdf") {
        return new Response(
          JSON.stringify({ error: "Este CFDI se subio manualmente y solo tiene XML, no PDF" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!storedUrl) {
        return new Response(JSON.stringify({ error: "El archivo del CFDI no esta disponible" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      fileRes = await fetch(storedUrl);
      if (!fileRes.ok) {
        return new Response(
          JSON.stringify({ error: "No se pudo leer el archivo almacenado del CFDI" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      if (!exec.facturapi_api_key_encrypted) {
        return new Response(JSON.stringify({ error: "El ejecutivo no tiene FacturAPI configurado" }), {
          status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // pac_invoice_id es la via normal. El regex queda SOLO como respaldo para
      // filas viejas anteriores a la migracion, que no tienen la columna poblada.
      const invoiceId = commission.pac_invoice_id ??
        storedUrl?.match(/\/invoices\/([^\/]+)\//)?.[1];

      if (!invoiceId) {
        return new Response(JSON.stringify({ error: "Este CFDI no tiene id de factura registrado" }), {
          status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const facturApiUrl = `https://www.facturapi.io/v2/invoices/${invoiceId}/${fileType}`;
      fileRes = await fetch(facturApiUrl, {
        headers: { Authorization: `Bearer ${exec.facturapi_api_key_encrypted}` },
      });

      if (!fileRes.ok) {
        // El detalle del PAC se queda en el log: puede traer datos del emisor y el
        // front lo mostraria tal cual al usuario.
        console.error(`FacturAPI ${fileRes.status} al descargar ${fileType} de ${commissionId}:`, await fileRes.text());
        return new Response(JSON.stringify({ error: "El PAC no devolvio el comprobante" }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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
    if (sentryDsn) {
      Sentry.captureException(err, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
