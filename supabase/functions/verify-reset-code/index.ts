import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { email, code, newPassword } = await req.json();

    if (!email || !code || !newPassword) {
      return new Response(
        JSON.stringify({ success: false, error: "Faltan datos requeridos" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    if (newPassword.length < 6) {
      return new Response(
        JSON.stringify({ success: false, error: "La contraseña debe tener al menos 6 caracteres" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const { data: resetCode, error: codeError } = await supabase
      .from("password_reset_codes")
      .select("id, user_id, expires_at, used")
      .eq("email", email)
      .eq("code", code)
      .maybeSingle();

    if (codeError) {
      console.error("Error buscando código:", codeError);
      return new Response(
        JSON.stringify({ success: false, error: "Error al verificar el código" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    if (!resetCode) {
      return new Response(
        JSON.stringify({ success: false, error: "Código inválido" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    if (resetCode.used) {
      return new Response(
        JSON.stringify({ success: false, error: "Este código ya fue utilizado" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const expiresAt = new Date(resetCode.expires_at);
    const now = new Date();

    if (now > expiresAt) {
      return new Response(
        JSON.stringify({ success: false, error: "El código ha expirado. Solicita uno nuevo" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(
      resetCode.user_id,
      { password: newPassword }
    );

    if (updateError) {
      console.error("Error actualizando contraseña:", updateError);
      const isLeaked = /leaked|pwned|compromised|common password/i.test(updateError.message ?? "");
      return new Response(
        JSON.stringify({
          success: false,
          error: isLeaked
            ? "Esta contraseña ha sido expuesta en brechas de datos conocidas y no puede usarse. Por favor elige una contraseña diferente y más segura."
            : "Error al actualizar la contraseña",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: isLeaked ? 422 : 500,
        }
      );
    }

    const { error: markUsedError } = await supabase
      .from("password_reset_codes")
      .update({ used: true })
      .eq("id", resetCode.id);

    if (markUsedError) {
      console.error("Error marcando código como usado:", markUsedError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Contraseña actualizada exitosamente"
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error en verify-reset-code:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Error interno del servidor"
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});