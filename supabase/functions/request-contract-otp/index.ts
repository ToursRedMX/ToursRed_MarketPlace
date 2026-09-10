import "jsr:@supabase/functions-js@2.112.4/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2.114.0";
import * as Sentry from "npm:@sentry/deno@9.47.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    release: Deno.env.get("SENTRY_RELEASE"),
    tracesSampleRate: 0.1,
  });
}

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function hashOtp(otp: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(otp));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sendOtpEmail(
  email: string,
  otp: string,
  folio: string,
  // Solo se usa .from(). `ReturnType<typeof createClient>` exige que los
  // genericos coincidan exactamente con los del cliente que se pasa, y no
  // coincidian. Mismo patron que cliente administrativo de Supabase.
  supabase: Pick<SupabaseClient, "from">
): Promise<void> {
  const { data: emailSettings } = await supabase
    .from("email_settings")
    .select("smtp_api_key, contact_email")
    // El cliente llega como ReturnType<typeof createClient> (Database=any) y con
    // eso supabase-js resuelve la fila a never. Se declara lo que el select pide.
    .returns<{ smtp_api_key: string | null; contact_email: string | null }[]>()
    .maybeSingle();

  const smtpApiKey = emailSettings?.smtp_api_key;
  if (!smtpApiKey) {
    console.warn("SMTP API key not configured â€” OTP stored in DB but email not sent");
    return;
  }

  const fromEmail = emailSettings?.contact_email || "contacto@toursred.com";

  const res = await fetch("https://api.smtp2go.com/v3/email/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Smtp2go-Api-Key": smtpApiKey,
    },
    body: JSON.stringify({
      sender: fromEmail,
      to: [email],
      subject: "CÃ³digo de verificaciÃ³n para firma de contrato â€” ToursRed",
      html_body: `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2d6a9f 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
      <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" style="max-width: 200px; height: auto; margin-bottom: 20px; background: white; padding: 10px; border-radius: 8px;" />
      <h1 style="color: white; margin: 0; font-size: 24px;">Firma de Contrato</h1>
    </div>
    <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
      <p style="font-size: 16px; margin-bottom: 20px;">
        Para firmar tu contrato de colaboraciÃ³n con ToursRed, usa el siguiente cÃ³digo de verificaciÃ³n:
      </p>
      <div style="background: white; padding: 25px; border-radius: 8px; text-align: center; margin: 30px 0; border: 2px dashed #2d6a9f;">
        <p style="font-size: 14px; color: #666; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 1px;">CÃ³digo de verificaciÃ³n</p>
        <p style="font-size: 36px; font-weight: bold; color: #1e3a5f; margin: 10px 0; letter-spacing: 8px; font-family: 'Courier New', monospace;">
          ${otp}
        </p>
        <p style="font-size: 12px; color: #999; margin: 10px 0 0 0;">
          Folio: ${folio} Â· Expira en 10 minutos
        </p>
      </div>
      <p style="font-size: 14px; color: #999; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
        Si no solicitaste este cÃ³digo, ignora este correo.
      </p>
    </div>
  </body>
</html>`,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("SMTP send failed:", text);
    throw new Error(`Email send failed: ${text}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: corsHeaders });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase    = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: corsHeaders });

    const { data: agency } = await supabase
      .from("agencies")
      .select("id, onboarding_status, contact_email, pending_amendment_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!agency) return new Response(JSON.stringify({ error: "Agencia no encontrada" }), { status: 404, headers: corsHeaders });

    const isInitialFlow   = agency.onboarding_status === "pending_signature";
    const isAmendmentFlow = agency.pending_amendment_id != null;

    if (!isInitialFlow && !isAmendmentFlow) {
      return new Response(JSON.stringify({ error: "La agencia no tiene una firma pendiente" }), { status: 409, headers: corsHeaders });
    }

    const { data: existing } = await supabase
      .from("contract_acceptances")
      .select("id, otp_request_count, otp_window_started_at, folio_contrato")
      .eq("agency_id", agency.id)
      .eq("status", "pending")
      .maybeSingle();

    if (!existing) {
      const mode = isAmendmentFlow ? "pending amendment" : "pending_signature";
      console.error(`Inconsistent state: agency ${agency.id} is ${mode} but has no pending contract_acceptances record`);
      return new Response(
        JSON.stringify({ error: "Error de estado: no se encontrÃ³ el registro del contrato. Contacta a soporte." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!existing.folio_contrato) {
      console.error(`Inconsistent state: contract_acceptances ${existing.id} has null folio_contrato`);
      return new Response(
        JSON.stringify({ error: "Error de estado: folio de contrato ausente. Contacta a soporte." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Rate-limit: 3 requests per 15-minute window
    const now            = new Date();
    const WINDOW_MINUTES = 15;
    const MAX_REQUESTS   = 3;

    const windowStarted  = existing.otp_window_started_at ? new Date(existing.otp_window_started_at) : null;
    const windowExpired  = !windowStarted || (now.getTime() - windowStarted.getTime()) > WINDOW_MINUTES * 60 * 1000;

    let newCount         = 1;
    let newWindowStarted = now.toISOString();

    if (!windowExpired) {
      const currentCount = existing.otp_request_count ?? 0;
      if (currentCount >= MAX_REQUESTS) {
        const msRemaining   = WINDOW_MINUTES * 60 * 1000 - (now.getTime() - windowStarted!.getTime());
        const minsRemaining = Math.ceil(msRemaining / 60000);
        return new Response(
          JSON.stringify({
            error: `Demasiados intentos. Espera ${minsRemaining} minuto${minsRemaining !== 1 ? "s" : ""} para solicitar un nuevo cÃ³digo.`,
            retry_after_minutes: minsRemaining,
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      newCount         = currentCount + 1;
      newWindowStarted = windowStarted!.toISOString();
    }

    // Generate OTP
    const otp       = generateOtp();
    const otpHash   = await hashOtp(otp);
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();

    const { error: updErr } = await supabase
      .from("contract_acceptances")
      .update({
        otp_code_hash:         otpHash,
        otp_expires_at:        expiresAt,
        otp_request_count:     newCount,
        otp_window_started_at: newWindowStarted,
      })
      .eq("id", existing.id)
      .eq("status", "pending");

    if (updErr) throw updErr;

    // Send OTP via email â€” non-blocking: if email fails, OTP is still in DB
    const recipientEmail = agency.contact_email ?? user.email ?? "";
    let emailSent = true;
    try {
      await sendOtpEmail(recipientEmail, otp, existing.folio_contrato, supabase);
    } catch (emailErr) {
      console.error("Failed to send OTP email:", emailErr);
      emailSent = false;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        message: emailSent
          ? "CÃ³digo enviado al correo registrado."
          : "CÃ³digo generado. Revisa tu correo o contacta a soporte si no lo recibiste.",
        folio: existing.folio_contrato,
        email_sent: emailSent,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    if (sentryDsn) {
      Sentry.captureException(err, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return new Response(JSON.stringify({ error: "Error interno del servidor" }), { status: 500, headers: corsHeaders });
  }
});

