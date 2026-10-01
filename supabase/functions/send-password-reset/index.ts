import "jsr:@supabase/functions-js@2.112.4/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import * as Sentry from "npm:@sentry/deno@9.47.1";
import { mensajeDeError } from "../_shared/errores.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Los telefonos se guardan en formatos distintos segun quien los capturo
// (+525513209470, 5513209470, " 9831820183"), y el usuario escribe el suyo como
// quiere. Comparar el texto tal cual hacia que el codigo no saliera nunca —sin
// error, con la misma respuesta generica— mientras la pantalla decia que si.
// Se comparan los ultimos 10 digitos: el numero nacional de Mexico.
function ultimos10Digitos(telefono: string | null | undefined): string | null {
  const digitos = (telefono ?? "").replace(/\D/g, "");
  return digitos.length >= 10 ? digitos.slice(-10) : null;
}

// Roles que recuperan su contrasena SOLO con el correo. El telefono de este
// flujo no es un segundo factor —no se manda ningun SMS, solo se compara contra
// lo que el usuario escribe—, y estas cuentas o no tenian donde guardarlo
// (admin) o lo guardan en otra tabla (account_executives.phone), asi que nunca
// podian recuperar su contrasena. Su segundo factor real es el TOTP que MfaGate
// les exige al entrar.
const ROLES_SOLO_CORREO = new Set(["admin", "super_admin", "accountant", "account_executive"]);

// Para los logs: lo suficiente para encontrar el caso, sin dejar el correo entero.
function correoEnmascarado(correo: string): string {
  const [usuario, dominio] = correo.split("@");
  return `${(usuario ?? "").slice(0, 2)}***@${dominio ?? ""}`;
}

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    release: Deno.env.get("SENTRY_RELEASE"),
    tracesSampleRate: 0.1,
  });
}

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

    const cuerpo = await req.json();
    // auth.users guarda el correo en minusculas y sync_user_email lo copia asi a
    // public.users, de modo que "Axel@..." no encontraba la cuenta.
    const email = String(cuerpo.email ?? "").trim().toLowerCase();
    const phoneNumber = String(cuerpo.phoneNumber ?? "").trim();

    if (!email) {
      return new Response(
        JSON.stringify({ success: false, error: "El correo electrónico es requerido" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id, email, phone_number, first_name, last_name, role")
      .eq("email", email)
      .maybeSingle();

    if (userError) {
      console.error("Error buscando usuario:", userError);
      return new Response(
        JSON.stringify({ success: false, error: "Error al buscar usuario" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    // Anti-enumeration: always return the same generic response regardless of
    // whether the email exists or the phone matches. Only proceed with sending
    // the code if all checks pass — but the external response is identical.
    const GENERIC_MSG = "Si los datos coinciden con una cuenta registrada, se enviará un código de verificación.";

    if (!userData) {
      console.warn(`send-password-reset: ${correoEnmascarado(email)} no tiene cuenta, no se manda codigo`);
      return new Response(
        JSON.stringify({ success: true, message: GENERIC_MSG }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    const soloCorreo = ROLES_SOLO_CORREO.has(userData.role);
    const telefonosDeLaCuenta: (string | null)[] = [userData.phone_number];

    if (!soloCorreo && userData.role === 'agency') {
      const { data: agencyData, error: agencyError } = await supabase
        .from("agencies")
        .select("contact_phone")
        .eq("user_id", userData.id)
        .maybeSingle();

      if (agencyError) {
        console.error("Error buscando datos de agencia:", agencyError);
        return new Response(
          JSON.stringify({ success: true, message: GENERIC_MSG }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }

      if (agencyData) {
        telefonosDeLaCuenta.unshift(agencyData.contact_phone);
      }
    }

    const telefonoEscrito = ultimos10Digitos(phoneNumber);
    const telefonoCoincide = telefonoEscrito !== null &&
      telefonosDeLaCuenta.some((t) => ultimos10Digitos(t) === telefonoEscrito);

    if (!soloCorreo && !telefonoCoincide) {
      const tieneTelefono = telefonosDeLaCuenta.some((t) => ultimos10Digitos(t) !== null);
      console.warn(
        `send-password-reset: ${correoEnmascarado(email)} (${userData.role}) ` +
        (tieneTelefono ? "escribio un telefono que no coincide" : "no tiene telefono registrado") +
        ", no se manda codigo",
      );
      return new Response(
        JSON.stringify({ success: true, message: GENERIC_MSG }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // A-1 (auditoria 05-sep-2026): esta funcion tiene que seguir siendo publica
    // —quien recupera su contrasena no tiene sesion— y no es un relay abierto,
    // porque el destinatario debe existir en users y el contenido es un codigo
    // generado aqui. Lo que si permitia era bombardear a un usuario conocido con
    // correos ilimitados. Tope: 3 codigos por correo por hora.
    //
    // Va DESPUES de la respuesta generica anti-enumeracion, asi que un atacante
    // no puede usar el 429 para distinguir correos registrados de los que no.
    const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: codigosRecientes } = await supabase
      .from("password_reset_codes")
      .select("id", { count: "exact", head: true })
      .eq("email", email)
      .gte("created_at", haceUnaHora);

    if ((codigosRecientes ?? 0) >= 3) {
      console.warn(`send-password-reset: ${email} supero 3 codigos en 1h, no se manda otro`);
      return new Response(
        JSON.stringify({ success: true, message: GENERIC_MSG }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const { error: insertError } = await supabase
      .from("password_reset_codes")
      .insert({
        user_id: userData.id,
        email: email,
        code: code,
        expires_at: expiresAt.toISOString(),
      });

    if (insertError) {
      console.error("Error guardando código:", insertError);
      return new Response(
        JSON.stringify({ success: false, error: "Error al generar código de recuperación" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    const { data: emailSettings, error: settingsError } = await supabase
      .from("email_settings")
      .select("smtp_api_key, contact_email")
      .maybeSingle();

    if (settingsError) {
      console.error("Error obteniendo configuración de email:", settingsError);
    }

    const smtpApiKey = emailSettings?.smtp_api_key;

    if (!smtpApiKey) {
      console.error("API key de SMTP2GO no configurada");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Configuración de correo no disponible"
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    const fromEmail = emailSettings?.contact_email || "contacto@toursred.com";
    const displayName = `${userData.first_name || ''} ${userData.last_name || ''}`.trim() || 'Usuario';

    const emailResponse = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Smtp2go-Api-Key": smtpApiKey,
      },
      body: JSON.stringify({
        sender: fromEmail,
        to: [email],
        subject: "Recuperación de contraseña - ToursRed",
        html_body: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" style="max-width: 200px; height: auto; margin-bottom: 20px; background: white; padding: 10px; border-radius: 8px;" />
                <h1 style="color: white; margin: 0; font-size: 28px;">Recuperación de Contraseña</h1>
              </div>

              <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
                <h2 style="color: #667eea; margin-top: 0;">Hola ${displayName},</h2>

                <p style="font-size: 16px; margin-bottom: 20px;">
                  Recibimos una solicitud para restablecer tu contraseña. Usa el siguiente código para continuar con el proceso:
                </p>

                <div style="background: white; padding: 25px; border-radius: 8px; text-align: center; margin: 30px 0; border: 2px dashed #667eea;">
                  <p style="font-size: 14px; color: #666; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 1px;">Tu código de recuperación</p>
                  <p style="font-size: 36px; font-weight: bold; color: #667eea; margin: 10px 0; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                    ${code}
                  </p>
                  <p style="font-size: 12px; color: #999; margin: 10px 0 0 0;">
                    Este código expira en 15 minutos
                  </p>
                </div>

                <p style="font-size: 14px; color: #666; margin-top: 30px;">
                  <strong>¿Cómo restablecer tu contraseña?</strong><br>
                  1. Ingresa el código de 6 dígitos en la página de recuperación<br>
                  2. Establece tu nueva contraseña<br>
                  3. ¡Listo! Podrás acceder con tu nueva contraseña
                </p>

                <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
                  <p style="margin: 0; font-size: 14px; color: #856404;">
                    <strong>⚠️ Nota de seguridad:</strong> Si no solicitaste restablecer tu contraseña, ignora este correo. Tu código expirará automáticamente en 15 minutos.
                  </p>
                </div>

                <p style="font-size: 14px; color: #999; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
                  ¿Necesitas ayuda? Contáctanos respondiendo a este correo.
                </p>
              </div>
            </body>
          </html>
        `,
      }),
    });

    const emailData = await emailResponse.json();

    if (!emailResponse.ok || emailData.data?.error) {
      console.error("Error enviando correo:", emailData);
      return new Response(
        JSON.stringify({
          success: false,
          error: emailData.data?.error || "No se pudo enviar el correo de recuperación"
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    console.log("Correo de recuperación enviado:", emailData);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Código de recuperación enviado exitosamente"
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error en send-password-reset:", error);
    if (sentryDsn) {
      Sentry.captureException(error, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return new Response(
      JSON.stringify({
        success: false,
        error: mensajeDeError(error) || "Error interno del servidor"
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});