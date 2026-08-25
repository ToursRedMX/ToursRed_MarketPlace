import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function generateTempPassword(length = 12): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%&*?";
  const all = upper + lower + digits + symbols;
  const chars: string[] = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ];
  for (let i = chars.length; i < length; i++) {
    chars.push(all[Math.floor(Math.random() * all.length)]);
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Token inválido" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (!userData || !["account_executive", "admin", "super_admin"].includes(userData.role)) {
      return new Response(
        JSON.stringify({ error: "No tienes permisos para realizar esta acción" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { agencyId, newEmail } = await req.json();

    if (!agencyId || !newEmail) {
      return new Response(
        JSON.stringify({ error: "Faltan campos requeridos (agencyId, newEmail)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedEmail = newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return new Response(
        JSON.stringify({ error: "Formato de correo inválido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: agency, error: agencyError } = await supabaseAdmin
      .from("agencies")
      .select("id, user_id, contact_email, account_executive_id, onboarding_status, name")
      .eq("id", agencyId)
      .maybeSingle();

    if (agencyError || !agency) {
      return new Response(
        JSON.stringify({ error: "Agencia no encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (agency.onboarding_status === "active") {
      return new Response(
        JSON.stringify({ error: "Esta agencia ya firmó su contrato y no se puede modificar el correo" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (userData.role === "account_executive") {
      const { data: execData } = await supabaseAdmin
        .from("account_executives")
        .select("id, is_active")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!execData || !execData.is_active) {
        return new Response(
          JSON.stringify({ error: "Ejecutivo no encontrado o inactivo" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (agency.account_executive_id !== execData.id) {
        return new Response(
          JSON.stringify({ error: "No tienes permiso sobre esta agencia" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const newTempPassword = generateTempPassword(12);

    const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(
      agency.user_id,
      { email: normalizedEmail, password: newTempPassword }
    );

    if (authUpdateError) {
      return new Response(
        JSON.stringify({ error: "Error al actualizar el correo en auth: " + authUpdateError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabaseAdmin
      .from("users")
      .update({ email: normalizedEmail, must_change_password: true })
      .eq("id", agency.user_id);

    await supabaseAdmin
      .from("agencies")
      .update({ contact_email: normalizedEmail })
      .eq("id", agency.id);

    await supabaseAdmin
      .from("agency_leads")
      .update({ contact_email: normalizedEmail, updated_at: new Date().toISOString() })
      .eq("converted_agency_id", agency.id);

    const { data: execData } = await supabaseAdmin
      .from("account_executives")
      .select("id, first_name, last_name, email")
      .eq("id", agency.account_executive_id)
      .maybeSingle();

    try {
      const executiveName = execData
        ? `${execData.first_name} ${execData.last_name || ""}`.trim()
        : "ToursRed";
      const executiveEmail = execData?.email || "contacto@toursred.com";

      const { data: leadData } = await supabaseAdmin
        .from("agency_leads")
        .select("contact_first_name, contact_last_name")
        .eq("converted_agency_id", agency.id)
        .maybeSingle();

      await fetch(`${supabaseUrl}/functions/v1/send-agency-credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          contactFirstName: leadData?.contact_first_name || "",
          contactLastName: leadData?.contact_last_name || "",
          agencyName: agency.name,
          password: newTempPassword,
          executiveEmail,
          executiveName,
        }),
      });
    } catch (emailErr) {
      console.error("Failed to resend credentials email:", emailErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Correo actualizado y credenciales reenviadas",
        newEmail: normalizedEmail,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in fix-agency-email:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
