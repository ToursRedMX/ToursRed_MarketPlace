import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";
import * as Sentry from "npm:@sentry/deno@9";
import { mensajeDeError } from "../_shared/errores.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ContactFormData {
  name: string;
  email: string;
  message: string;
  turnstile_token?: string;
}

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
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { name, email, message, turnstile_token }: ContactFormData = await req.json();

    if (!name || !email || !message) {
      return new Response(
        JSON.stringify({ error: "Faltan campos requeridos" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Rate limit ────────────────────────────────────────────────────────
    //
    // M-1 de la auditoria del 05-sep-2026: el limite era por `email`, y el
    // email lo elige quien envia. Cambiar una letra lo reiniciaba, asi que
    // solo limitaba a quien no queria saltarselo. La IP ya se registraba mas
    // abajo pero no se usaba para nada.
    //
    // Ahora se limita por las dos. El limite por IP es mas holgado a
    // proposito: una oficina, una universidad o una red movil comparten IP, y
    // no se trata de castigar a quien esta detras de un NAT.
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const LIMITE_POR_EMAIL = 3;
    const LIMITE_POR_IP = 10;

    const { count: enviosDelEmail } = await supabase
      .from('contact_form_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('email', email)
      .gte('created_at', oneHourAgo);

    let enviosDeLaIp = 0;
    if (clientIp) {
      const { count } = await supabase
        .from('contact_form_submissions')
        .select('id', { count: 'exact', head: true })
        .eq('ip_address', clientIp)
        .gte('created_at', oneHourAgo);
      enviosDeLaIp = count ?? 0;
    }

    if ((enviosDelEmail ?? 0) >= LIMITE_POR_EMAIL || enviosDeLaIp >= LIMITE_POR_IP) {
      return new Response(
        JSON.stringify({ error: "Has alcanzado el limite de envios. Intenta de nuevo en una hora." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Turnstile ─────────────────────────────────────────────────────────
    //
    // Antes esto era `if (turnstile_token) { ... }`: el captcha solo actuaba
    // contra quien decidia someterse a el. Saltarselo era no mandar el campo.
    //
    // Ahora la decision la toma el SERVIDOR, leyendo la misma palanca que lee
    // el front (`platform_settings.turnstile_auth_enabled`, via
    // `useTurnstileEnabled`). La presencia del token ya no decide nada.
    const { data: ajustes, error: errorAjustes } = await supabase
      .from('platform_settings')
      .select('turnstile_auth_enabled')
      .maybeSingle();

    // Si no se puede leer la palanca, se exige el captcha. Lo contrario seria
    // el mismo fail-open con otro disfraz: bastaria con tumbar esa consulta.
    const turnstileExigido = errorAjustes ? true : ajustes?.turnstile_auth_enabled === true;

    if (turnstileExigido) {
      const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY');

      if (!turnstileSecret) {
        // Falla cerrado: la palanca esta encendida y no hay con que verificar.
        // Es una mala configuracion del proyecto, no un permiso para pasar.
        console.error('[contacto] turnstile_auth_enabled=true pero falta TURNSTILE_SECRET_KEY');
        return new Response(
          JSON.stringify({
            error: 'La verificacion de seguridad no esta disponible. Intenta de nuevo mas tarde.',
            code: 'CAPTCHA_NO_CONFIGURADO',
          }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!turnstile_token) {
        return new Response(
          JSON.stringify({ error: 'Falta la verificacion de seguridad.', code: 'CAPTCHA_REQUERIDO' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let verificado = false;
      try {
        // URLSearchParams en vez de concatenar: el token viene del cliente, y
        // un `&` dentro de el permitia inyectar parametros en la peticion a
        // Cloudflare.
        const cuerpo = new URLSearchParams({ secret: turnstileSecret, response: turnstile_token });
        if (clientIp) cuerpo.set('remoteip', clientIp);

        const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: cuerpo.toString(),
        });
        const verifyData = await verifyRes.json();
        verificado = verifyData?.success === true;
        if (!verificado) {
          console.error('[contacto] Turnstile rechazo el token:', verifyData?.['error-codes']);
        }
      } catch (e) {
        // Si no se puede hablar con Cloudflare, no se deja pasar. Mismo
        // criterio que el helper de AAL2 tras M-2.
        console.error('[contacto] fallo la verificacion de Turnstile:', e);
        verificado = false;
      }

      if (!verificado) {
        return new Response(
          JSON.stringify({ error: 'Verificacion de seguridad fallida', code: 'CAPTCHA_INVALIDO' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Log submission for rate limiting
    await supabase.from('contact_form_submissions').insert({
      name, email, message, ip_address: clientIp,
    });

    const { data: emailSettings, error: settingsError } = await supabase
      .from("email_settings")
      .select("*")
      .maybeSingle();

    if (settingsError || !emailSettings) {
      console.error("Error fetching email settings:", settingsError);
      return new Response(
        JSON.stringify({ error: "Error al obtener configuración de email" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!emailSettings.smtp_api_key) {
      console.error("SMTP API key not configured");
      return new Response(
        JSON.stringify({ error: "API key de SMTP no configurada" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const textContent = `
Has recibido un nuevo mensaje desde el formulario de contacto de ToursRed:

Nombre: ${name}
Email: ${email}

Mensaje:
${message}

---
Este mensaje fue enviado desde el formulario de contacto de ToursRed.
    `;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #1e40af; color: white; padding: 20px; text-align: center; }
    .logo { max-width: 200px; height: auto; margin-bottom: 10px; }
    .content { background-color: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
    .field { margin-bottom: 15px; }
    .label { font-weight: bold; color: #1e40af; }
    .message-box { background-color: white; padding: 15px; border-left: 4px solid #1e40af; margin-top: 10px; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" class="logo" />
      <h1>Nuevo Mensaje de Contacto</h1>
    </div>
    <div class="content">
      <p>Has recibido un nuevo mensaje desde el formulario de contacto de ToursRed:</p>
      
      <div class="field">
        <span class="label">Nombre:</span> ${name}
      </div>
      
      <div class="field">
        <span class="label">Email:</span> <a href="mailto:${email}">${email}</a>
      </div>
      
      <div class="field">
        <span class="label">Mensaje:</span>
        <div class="message-box">
          ${message.replace(/\n/g, "<br>")}
        </div>
      </div>
    </div>
    <div class="footer">
      <p>Este mensaje fue enviado desde el formulario de contacto de ToursRed.</p>
    </div>
  </div>
</body>
</html>
    `;

    const emailPayload = {
      api_key: emailSettings.smtp_api_key,
      to: [emailSettings.contact_email],
      sender: `no-reply@toursred.com`,
      subject: `Nuevo mensaje de contacto de ${name}`,
      text_body: textContent,
      html_body: htmlContent,
      custom_headers: [
        {
          header: "Reply-To",
          value: email
        }
      ]
    };

    console.log("Sending email via SMTP2GO API...");

    const response = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    });

    const result = await response.json();

    if (!response.ok || result.data?.error) {
      console.error("SMTP2GO API Error:", result);
      throw new Error(result.data?.error || `SMTP2GO API Error: ${response.status}`);
    }

    console.log("Email sent successfully:", result);

    return new Response(
      JSON.stringify({ success: true, message: "Email enviado correctamente" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error sending email:", error);
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
      JSON.stringify({ error: "Error al enviar el email", details: mensajeDeError(error) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
