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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "No authorization header" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 401,
        }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid token" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 401,
        }
      );
    }

    const { code } = await req.json();

    if (!code) {
      return new Response(
        JSON.stringify({ success: false, error: "Código requerido" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Obtener el usuario con su código de verificación
    const { data: userData, error: userDataError } = await supabase
      .from("users")
      .select("id, email, verification_code, verification_code_expires_at, verification_code_attempts, email_verified")
      .eq("id", user.id)
      .single();

    if (userDataError || !userData) {
      return new Response(
        JSON.stringify({ success: false, error: "Usuario no encontrado" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        }
      );
    }

    // Verificar si ya está verificado
    if (userData.email_verified) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "El correo electrónico ya ha sido verificado" 
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Verificar si tiene un código
    if (!userData.verification_code) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "No hay un código de verificación activo" 
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Verificar intentos
    if (userData.verification_code_attempts >= 5) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Demasiados intentos fallidos. Solicita un nuevo código." 
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 429,
        }
      );
    }

    // Verificar expiración
    const expiresAt = new Date(userData.verification_code_expires_at);
    const now = new Date();

    if (now > expiresAt) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "El código ha expirado. Solicita uno nuevo." 
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Verificar el código
    if (code.trim() !== userData.verification_code) {
      // Incrementar intentos
      await supabase
        .from("users")
        .update({ 
          verification_code_attempts: userData.verification_code_attempts + 1 
        })
        .eq("id", user.id);

      const attemptsLeft = 5 - (userData.verification_code_attempts + 1);

      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Código incorrecto. Te quedan ${attemptsLeft} ${attemptsLeft === 1 ? 'intento' : 'intentos'}.` 
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Código correcto - marcar como verificado y limpiar campos
    const { error: updateError } = await supabase
      .from("users")
      .update({ 
        email_verified: true,
        verification_code: null,
        verification_code_expires_at: null,
        verification_code_attempts: 0
      })
      .eq("id", user.id);

    if (updateError) {
      console.error("Error actualizando usuario:", updateError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Error al verificar el correo" 
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    console.log(`✅ Correo verificado exitosamente para usuario: ${userData.email}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Correo electrónico verificado exitosamente" 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error en verify-email-code:", error);
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