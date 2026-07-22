import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

    const { rfc, razon_social, regimen_fiscal, postal_code } = await req.json();

    if (!rfc || !razon_social || !regimen_fiscal) {
      return new Response(JSON.stringify({ error: "rfc, razon_social y regimen_fiscal son obligatorios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rfcUpper = rfc.trim().toUpperCase();
    if (rfcUpper.length < 12 || rfcUpper.length > 13) {
      return new Response(JSON.stringify({ valid: false, errors: [{ message: "El RFC debe tener 12 (persona moral) o 13 (persona física) caracteres" }] }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load PAC credentials from platform_settings
    const { data: settings } = await supabase
      .from("platform_settings")
      .select("pac_provider, pac_api_key_encrypted, pac_organization_id, pac_sandbox_mode")
      .maybeSingle();

    if (!settings?.pac_api_key_encrypted) {
      return new Response(JSON.stringify({ error: "PAC no configurado en platform_settings" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = settings.pac_sandbox_mode
      ? "https://www.facturapi.io/v2"
      : "https://www.facturapi.io/v2";

    // Create customer via POST /v2/customers — FacturAPI validates RFC against SAT LRFC automatically.
    // create_edit_link is NOT used, so validation runs immediately.
    const customerBody: Record<string, unknown> = {
      legal_name: razon_social.trim(),
      tax_id: rfcUpper,
      tax_system: regimen_fiscal,
    };

    if (postal_code) {
      customerBody.address = { zip: postal_code.trim() };
    }

    const facturapiRes = await fetch(`${baseUrl}/customers`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${settings.pac_api_key_encrypted}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(customerBody),
    });

    if (facturapiRes.ok) {
      const customerData = await facturapiRes.json();
      return new Response(JSON.stringify({
        valid: true,
        customer_id: customerData.id,
        message: "RFC validado correctamente contra el SAT",
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      const errData = await facturapiRes.json().catch(() => ({}));
      const rawMessage = String(errData.message || errData.errors?.[0]?.message || "RFC no válido según el SAT");
      const errStr = rawMessage.toLowerCase();

      let error_type: "rfc_not_found" | "postal_code_mismatch" | "other" = "other";

      if (errStr.includes("domiciliofiscalreceptor") || errStr.includes("address.zip")) {
        error_type = "postal_code_mismatch";
      } else if (
        errStr.includes("no se encontró") ||
        errStr.includes("not found") ||
        errStr.includes("no existe") ||
        errStr.includes("cancelado") ||
        errStr.includes("inscrito") ||
        errStr.includes("cfdi40192") ||
        errStr.includes("domiciliofiscalacuentaterceros")
      ) {
        error_type = "rfc_not_found";
      }

      const userMessage = error_type === "postal_code_mismatch"
        ? "El código postal no coincide con el domicilio fiscal registrado en el SAT para este RFC. Verifica que el RFC, razón social y código postal sean exactamente los que aparecen en tu constancia de situación fiscal."
        : error_type === "rfc_not_found"
          ? "El RFC no está inscrito o está cancelado en el SAT. No es posible registrar esta agencia con un RFC inválido."
          : rawMessage;

      return new Response(JSON.stringify({
        valid: false,
        error_type,
        message: userMessage,
        errors: [{ message: userMessage }],
        status_code: facturapiRes.status,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    console.error("Error in validate-agency-rfc:", err);
    return new Response(JSON.stringify({ error: "Error interno del servidor", detail: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
