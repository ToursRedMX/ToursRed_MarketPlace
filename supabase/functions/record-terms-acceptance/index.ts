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
      throw new Error("No authorization header");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      throw new Error("Invalid user token");
    }

    const { terms_type } = await req.json();
    if (!terms_type || !["traveler", "agency"].includes(terms_type)) {
      throw new Error("terms_type inválido. Debe ser 'traveler' o 'agency'");
    }

    // Extraer IP real del request
    const ip =
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null;

    const userAgent = req.headers.get("user-agent") || null;

    // Obtener versión activa del tipo solicitado
    const { data: activeTerms, error: termsError } = await supabase
      .from("terms_versions")
      .select("id, version_number, terms_type")
      .eq("terms_type", terms_type)
      .eq("is_active", true)
      .maybeSingle();

    if (termsError || !activeTerms) {
      throw new Error(`No hay versión activa de T&C para el tipo: ${terms_type}`);
    }

    // Verificar si ya aceptó esta versión exacta (idempotente)
    const { data: existing } = await supabase
      .from("terms_acceptances")
      .select("id")
      .eq("user_id", user.id)
      .eq("terms_version_id", activeTerms.id)
      .maybeSingle();

    const acceptedAt = new Date().toISOString();

    if (!existing) {
      // Registrar aceptación
      const { error: insertError } = await supabase
        .from("terms_acceptances")
        .insert({
          user_id: user.id,
          terms_version_id: activeTerms.id,
          terms_type: activeTerms.terms_type,
          version_number: activeTerms.version_number,
          user_email: user.email || "",
          ip_address: ip,
          user_agent: userAgent,
          accepted_at: acceptedAt,
        });

      if (insertError) {
        throw new Error(`Error registrando aceptación: ${insertError.message}`);
      }
    }

    // Actualizar columna en users
    const columnName =
      terms_type === "traveler"
        ? "accepted_traveler_terms_version"
        : "accepted_agency_terms_version";

    const { error: updateError } = await supabase
      .from("users")
      .update({ [columnName]: activeTerms.version_number })
      .eq("id", user.id);

    if (updateError) {
      throw new Error(`Error actualizando usuario: ${updateError.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        version_number: activeTerms.version_number,
        accepted_at: acceptedAt,
        already_accepted: !!existing,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in record-terms-acceptance:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
