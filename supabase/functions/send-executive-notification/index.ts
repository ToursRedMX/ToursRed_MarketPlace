import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface BasePayload {
  type: "agency_approved" | "first_tour_published" | "first_booking" | "monthly_commission";
  executiveEmail: string;
  executiveFirstName: string;
  executiveLastName: string;
}

interface AgencyApprovedPayload extends BasePayload {
  type: "agency_approved";
  agencyName: string;
  commissionAmount: number;
}

interface FirstTourPublishedPayload extends BasePayload {
  type: "first_tour_published";
  agencyName: string;
}

interface FirstBookingPayload extends BasePayload {
  type: "first_booking";
  agencyName: string;
  commissionAmount: number;
}

interface MonthlyCommissionPayload extends BasePayload {
  type: "monthly_commission";
  periodMonth: number;
  periodYear: number;
  totalAmount: number;
  agenciesDetail: Array<{ agencyName: string; amount: number }>;
}

type NotificationPayload =
  | AgencyApprovedPayload
  | FirstTourPublishedPayload
  | FirstBookingPayload
  | MonthlyCommissionPayload;

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function formatMXN(amount: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(amount);
}

function buildEmailLayout(
  logoUrl: string,
  fromEmail: string,
  appUrl: string,
  firstName: string,
  subjectLine: string,
  bodyHtml: string
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subjectLine}</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f3f4f6;">
  <table role="presentation" style="width:100%;border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#ffffff;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.07);">

          <!-- Header -->
          <tr>
            <td style="padding:36px 40px 28px 40px;text-align:center;background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);border-radius:12px 12px 0 0;">
              <img src="${logoUrl}" alt="ToursRed" style="max-width:160px;height:auto;margin-bottom:16px;background:white;padding:8px 16px;border-radius:8px;" />
              <p style="margin:0;color:rgba(255,255,255,0.9);font-size:14px;letter-spacing:0.5px;text-transform:uppercase;font-weight:600;">Ejecutivo de Cuenta</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px 40px;">
              <p style="margin:0 0 20px 0;color:#374151;font-size:17px;line-height:28px;">
                Hola <strong>${firstName}</strong>,
              </p>
              ${bodyHtml}
              <!-- CTA Button -->
              <div style="text-align:center;margin-top:36px;">
                <a href="${appUrl}/ejecutivo/comisiones"
                   style="display:inline-block;padding:15px 40px;background-color:#dc2626;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">
                  Ver mi estado de cuenta
                </a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;background-color:#f9fafb;border-radius:0 0 12px 12px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0 0 4px 0;color:#9ca3af;font-size:13px;">¿Tienes dudas? Escríbenos a <a href="mailto:${fromEmail}" style="color:#dc2626;text-decoration:none;">${fromEmail}</a></p>
              <p style="margin:0;color:#d1d5db;font-size:12px;">© ${new Date().getFullYear()} ToursRed. Todos los derechos reservados.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildEmailContent(payload: NotificationPayload, logoUrl: string, fromEmail: string, appUrl: string): {
  subject: string;
  html: string;
  text: string;
} {
  const fullName = `${payload.executiveFirstName} ${payload.executiveLastName}`.trim();

  if (payload.type === "agency_approved") {
    const subject = `¡Felicidades! Ganaste ${formatMXN(payload.commissionAmount)} por aprobar a ${payload.agencyName}`;
    const body = `
      <p style="margin:0 0 24px 0;color:#4b5563;font-size:15px;line-height:26px;">
        Excelente trabajo. La agencia <strong>${payload.agencyName}</strong> ha sido aprobada en ToursRed y ya está lista para operar.
      </p>
      <!-- Commission highlight -->
      <div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1px solid #86efac;border-radius:12px;padding:28px;text-align:center;margin:0 0 24px 0;">
        <p style="margin:0 0 6px 0;color:#15803d;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Comisión de aprobación generada</p>
        <p style="margin:0;color:#14532d;font-size:38px;font-weight:800;">${formatMXN(payload.commissionAmount)}</p>
        <p style="margin:8px 0 0 0;color:#16a34a;font-size:13px;">Esta comisión ya está registrada en tu portal como pendiente.</p>
      </div>
      <p style="margin:0;color:#6b7280;font-size:14px;line-height:24px;">
        Cuando estés listo, sube tu CFDI desde tu portal para iniciar el proceso de cobro. Recuerda que además comenzó el período de <strong>comisiones por actividad de plataforma</strong> para esta agencia.
      </p>
    `;
    const text = `Hola ${fullName},\n\nLa agencia ${payload.agencyName} ha sido aprobada. Ganaste ${formatMXN(payload.commissionAmount)} de comisión de aprobación.\n\nConsulta tu estado de cuenta en: ${appUrl}/ejecutivo/comisiones`;
    return { subject, html: buildEmailLayout(logoUrl, fromEmail, appUrl, payload.executiveFirstName, subject, body), text };
  }

  if (payload.type === "first_tour_published") {
    const subject = `${payload.agencyName} publicó su primer tour en ToursRed`;
    const body = `
      <p style="margin:0 0 24px 0;color:#4b5563;font-size:15px;line-height:26px;">
        ¡Buenas noticias! La agencia <strong>${payload.agencyName}</strong> acaba de publicar su <strong>primer tour</strong> en el catálogo de ToursRed.
      </p>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:24px;margin:0 0 24px 0;">
        <p style="margin:0 0 8px 0;color:#1d4ed8;font-size:15px;font-weight:600;">¿Que sigue?</p>
        <ul style="margin:0;padding-left:20px;color:#3b82f6;font-size:14px;line-height:26px;">
          <li>Ayuda a la agencia a difundir su tour en redes sociales</li>
          <li>Cuando consigan su primera venta, recibirás tu comisión de <em>primer tour y reserva</em></li>
          <li>El período de comisiones de plataforma ya está activo para esta agencia</li>
        </ul>
      </div>
      <p style="margin:0;color:#6b7280;font-size:14px;line-height:24px;">
        Puedes ver el detalle del progreso de tus agencias en tu portal de ejecutivo.
      </p>
    `;
    const text = `Hola ${fullName},\n\n${payload.agencyName} acaba de publicar su primer tour en ToursRed.\n\nConsulta tu estado de cuenta en: ${appUrl}/ejecutivo/comisiones`;
    return { subject, html: buildEmailLayout(logoUrl, fromEmail, appUrl, payload.executiveFirstName, subject, body), text };
  }

  if (payload.type === "first_booking") {
    const subject = `¡Primera venta! ${payload.agencyName} recibió su primera reserva pagada`;
    const body = `
      <p style="margin:0 0 24px 0;color:#4b5563;font-size:15px;line-height:26px;">
        ¡Felicidades! La agencia <strong>${payload.agencyName}</strong> acaba de completar su <strong>primera reserva pagada</strong> en ToursRed.
      </p>
      <!-- Commission highlight -->
      <div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1px solid #86efac;border-radius:12px;padding:28px;text-align:center;margin:0 0 24px 0;">
        <p style="margin:0 0 6px 0;color:#15803d;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Comisión de primer tour y reserva</p>
        <p style="margin:0;color:#14532d;font-size:38px;font-weight:800;">${formatMXN(payload.commissionAmount)}</p>
        <p style="margin:8px 0 0 0;color:#16a34a;font-size:13px;">Esta comisión ya está registrada en tu portal como pendiente.</p>
      </div>
      <p style="margin:0;color:#6b7280;font-size:14px;line-height:24px;">
        Sigue acompañando a <strong>${payload.agencyName}</strong> para que sigan creciendo. Las comisiones de plataforma continuarán acumulándose cada mes durante el período activo.
      </p>
    `;
    const text = `Hola ${fullName},\n\n${payload.agencyName} completó su primera reserva pagada. Ganaste ${formatMXN(payload.commissionAmount)} de comisión.\n\nConsulta tu estado de cuenta en: ${appUrl}/ejecutivo/comisiones`;
    return { subject, html: buildEmailLayout(logoUrl, fromEmail, appUrl, payload.executiveFirstName, subject, body), text };
  }

  // monthly_commission
  const monthName = MONTH_NAMES[payload.periodMonth - 1] || `Mes ${payload.periodMonth}`;
  const subject = `Tu resumen de comisiones de ${monthName} ${payload.periodYear} — ${formatMXN(payload.totalAmount)}`;
  const agencyRows = payload.agenciesDetail
    .map(
      (a) => `
      <tr>
        <td style="padding:10px 16px;color:#374151;font-size:14px;border-bottom:1px solid #f3f4f6;">${a.agencyName}</td>
        <td style="padding:10px 16px;color:#374151;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #f3f4f6;">${formatMXN(a.amount)}</td>
      </tr>`
    )
    .join("");

  const body = `
    <p style="margin:0 0 24px 0;color:#4b5563;font-size:15px;line-height:26px;">
      Aquí tienes el resumen de tus comisiones por actividad de plataforma en <strong>${monthName} ${payload.periodYear}</strong>.
    </p>
    <!-- Total highlight -->
    <div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1px solid #86efac;border-radius:12px;padding:28px;text-align:center;margin:0 0 24px 0;">
      <p style="margin:0 0 6px 0;color:#15803d;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Total acumulado en ${monthName} ${payload.periodYear}</p>
      <p style="margin:0;color:#14532d;font-size:42px;font-weight:800;">${formatMXN(payload.totalAmount)}</p>
    </div>
    <!-- Agencies detail table -->
    <table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin:0 0 24px 0;">
      <thead>
        <tr style="background:#f9fafb;">
          <th style="padding:10px 16px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Agencia</th>
          <th style="padding:10px 16px;text-align:right;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Comisión</th>
        </tr>
      </thead>
      <tbody>
        ${agencyRows}
      </tbody>
    </table>
    <p style="margin:0;color:#6b7280;font-size:14px;line-height:24px;">
      Estas comisiones ya están registradas en tu portal. Para cobrarlas, sube el CFDI correspondiente desde tu estado de cuenta.
    </p>
  `;
  const agenciesText = payload.agenciesDetail.map((a) => `  - ${a.agencyName}: ${formatMXN(a.amount)}`).join("\n");
  const text = `Hola ${fullName},\n\nResumen de comisiones ${monthName} ${payload.periodYear}:\n\n${agenciesText}\n\nTotal: ${formatMXN(payload.totalAmount)}\n\nConsulta tu estado de cuenta en: ${appUrl}/ejecutivo/comisiones`;
  return { subject, html: buildEmailLayout(logoUrl, fromEmail, appUrl, payload.executiveFirstName, subject, body), text };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const payload: NotificationPayload = await req.json();

    if (!payload.type || !payload.executiveEmail || !payload.executiveFirstName) {
      return new Response(
        JSON.stringify({ error: "type, executiveEmail y executiveFirstName son requeridos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [{ data: emailSettings }, { data: platformSettingsData }] = await Promise.all([
      supabase.from("email_settings").select("smtp_api_key, contact_email").maybeSingle(),
      supabase.from("platform_settings").select("platform_url").maybeSingle(),
    ]);

    if (!emailSettings?.smtp_api_key) {
      console.error("SMTP API key not configured");
      return new Response(
        JSON.stringify({ error: "API key de SMTP no configurada" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fromEmail = emailSettings.contact_email || "contacto@toursred.com";
    const logoUrl = `${supabaseUrl}/storage/v1/object/public/images/email-logo.png`;
    const appUrl = platformSettingsData?.platform_url || "https://toursredmx.netlify.app";

    const { subject, html, text } = buildEmailContent(payload, logoUrl, fromEmail, appUrl);

    const emailPayload = {
      api_key: emailSettings.smtp_api_key,
      to: [payload.executiveEmail],
      sender: fromEmail,
      subject,
      html_body: html,
      text_body: text,
    };

    const response = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emailPayload),
    });

    const result = await response.json();

    if (!response.ok || result.data?.error) {
      console.error("SMTP2GO API Error:", result);
      throw new Error(result.data?.error || `SMTP2GO error: ${response.status}`);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in send-executive-notification:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
