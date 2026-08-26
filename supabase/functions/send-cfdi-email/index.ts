import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as Sentry from "npm:@sentry/deno@9";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { cfdi_invoice_id, recipient_type = "traveler" } = await req.json();

    if (!cfdi_invoice_id) {
      return new Response(
        JSON.stringify({ error: "cfdi_invoice_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: cfdi, error: cfdiError } = await supabase
      .from("cfdi_invoices")
      .select("*")
      .eq("id", cfdi_invoice_id)
      .maybeSingle();

    if (cfdiError || !cfdi) {
      return new Response(
        JSON.stringify({ error: "CFDI invoice not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (cfdi.status !== "stamped") {
      return new Response(
        JSON.stringify({ error: "CFDI is not stamped yet", status: cfdi.status }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: emailSettings } = await supabase
      .from("email_settings")
      .select("smtp_api_key, contact_email")
      .maybeSingle();

    if (!emailSettings?.smtp_api_key) {
      return new Response(
        JSON.stringify({ success: false, message: "Email settings not configured" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let recipientEmail = "";
    let recipientName = "";

    if (recipient_type === "traveler" && cfdi.booking_id) {
      const { data: booking } = await supabase
        .from("bookings")
        .select("user_id")
        .eq("id", cfdi.booking_id)
        .maybeSingle();

      if (booking?.user_id) {
        const { data: traveler } = await supabase
          .from("users")
          .select("email, first_name, last_name")
          .eq("id", booking.user_id)
          .maybeSingle();
        recipientEmail = traveler?.email || "";
        recipientName = [traveler?.first_name, traveler?.last_name].filter(Boolean).join(" ").trim();
      }
    } else if (recipient_type === "traveler" && cfdi.membership_id) {
      const { data: membership } = await supabase
        .from("memberships")
        .select("user_id")
        .eq("id", cfdi.membership_id)
        .maybeSingle();

      if (membership?.user_id) {
        const { data: traveler } = await supabase
          .from("users")
          .select("email, first_name, last_name")
          .eq("id", membership.user_id)
          .maybeSingle();
        recipientEmail = traveler?.email || "";
        recipientName = [traveler?.first_name, traveler?.last_name].filter(Boolean).join(" ").trim();
      }
    } else if (recipient_type === "agency" && cfdi.agency_id) {
      const { data: agency } = await supabase
        .from("agencies")
        .select("contact_email, name")
        .eq("id", cfdi.agency_id)
        .maybeSingle();
      recipientEmail = agency?.contact_email || "";
      recipientName = agency?.name || "";
    }

    if (!recipientEmail) {
      return new Response(
        JSON.stringify({ success: false, message: "Could not determine recipient email" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const invoiceTypeLabel = cfdi.invoice_type === "membership"
      ? "Membresia ToursRed Plus"
      : cfdi.invoice_type === "commission"
      ? "Comision"
      : "Servicio de Viaje";

    const folioDisplay = cfdi.folio ? `${cfdi.serie || ""}${cfdi.folio}` : cfdi.id.slice(0, 8).toUpperCase();
    const totalFormatted = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(cfdi.total) || 0);

    const senderEmail = emailSettings.contact_email || "noreply@toursred.com";
    const logoHtml = `<span style="font-size:20px;font-weight:700;color:#0e7490;">ToursRed</span>`;

    // Antes se enlazaba cfdi.xml_url / cfdi.pdf_url, que apuntan a la API PRIVADA
    // de FacturAPI (https://www.facturapi.io/v2/invoices/{id}/pdf). Esa URL exige
    // Authorization con la API key secreta, asi que el boton del correo daba 401
    // para el destinatario: los 33 CFDIs timbrados quedaron con el enlace roto.
    //
    // Ahora el comprobante viaja ADJUNTO. Se descarga aqui, del lado del servidor,
    // con las credenciales del PAC — mismo procedimiento que download-cfdi:127 —
    // y nunca salen del backend. Ademas evita depender de que el destinatario
    // tenga sesion abierta, cosa que un enlace de correo no puede asumir.
    const { data: pacSettings } = await supabase
      .from("platform_settings")
      .select("pac_organization_id")
      .maybeSingle();
    const { data: pacSecrets } = await supabase
      .from("platform_secrets")
      .select("pac_api_key_encrypted")
      .maybeSingle();
    const pacApiKey = pacSecrets?.pac_api_key_encrypted || null;

    const attachments: Array<{ filename: string; fileblob: string; mimetype: string }> = [];

    if (pacApiKey && cfdi.pac_invoice_id) {
      const pacHeaders: Record<string, string> = { Authorization: `Bearer ${pacApiKey}` };
      if (pacSettings?.pac_organization_id) {
        pacHeaders["X-Organization-Id"] = pacSettings.pac_organization_id;
      }

      for (const kind of [
        { ext: "pdf", mimetype: "application/pdf" },
        { ext: "xml", mimetype: "application/xml" },
      ]) {
        try {
          const fileRes = await fetch(
            `https://www.facturapi.io/v2/invoices/${cfdi.pac_invoice_id}/${kind.ext}`,
            { headers: pacHeaders }
          );
          if (!fileRes.ok) {
            console.error(`No se pudo descargar el ${kind.ext} del CFDI ${cfdi.id}: ${fileRes.status}`);
            continue;
          }
          const bytes = new Uint8Array(await fileRes.arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          attachments.push({
            filename: `factura-${folioDisplay}.${kind.ext}`,
            fileblob: btoa(binary),
            mimetype: kind.mimetype,
          });
        } catch (e) {
          // Un adjunto que falla no debe impedir el envio: el correo sale igual
          // y el destinatario siempre tiene el boton a su listado de facturas.
          console.error(`Error adjuntando ${kind.ext} del CFDI ${cfdi.id}:`, e);
        }
      }
    } else {
      console.error(`CFDI ${cfdi.id} sin pac_api_key o sin pac_invoice_id: se envia sin adjuntos`);
    }

    // El listado de facturas NO es el mismo para todos. TravelerInvoices filtra
    // por los 7 tipos del viajero y no incluye 'commission', asi que mandar a una
    // agencia a /traveler/invoices seria inutil (ademas de que la ruta exige rol
    // TRAVELER). AgencyCfdiList filtra solo por agency_id y si muestra comisiones.
    const appUrl = Deno.env.get("APP_URL") || "https://toursredmx.netlify.app";
    const invoicesPath = recipient_type === "agency" ? "/agency/invoices" : "/traveler/invoices";
    const invoicesLink =
      `<a href="${appUrl}${invoicesPath}" style="display:inline-block;background:#0e7490;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;margin:4px;">Ver todas mis facturas</a>`;

    const attachmentNote = attachments.length > 0
      ? `<p style="color:#4b5563;font-size:14px;margin:0 0 8px;">Tu comprobante viene adjunto a este correo en formato PDF y XML.</p>`
      : `<p style="color:#4b5563;font-size:14px;margin:0 0 8px;">Puedes descargar tu comprobante desde tu listado de facturas.</p>`;


    const emailHtml = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Tu Factura Electronica</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#0e7490;padding:32px;text-align:center;">
            ${logoHtml}
            <h1 style="color:#fff;margin:8px 0 4px;font-size:22px;">Tu Factura Electronica</h1>
            <p style="color:#a5f3fc;margin:0;font-size:14px;">${invoiceTypeLabel}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="color:#374151;font-size:15px;margin-top:0;">Hola <strong>${recipientName || "estimado cliente"}</strong>,</p>
            <p style="color:#6b7280;font-size:14px;">Tu comprobante fiscal digital (CFDI) ha sido generado y timbrado exitosamente. A continuacion encontraras los detalles y los enlaces para descargarlo.</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;padding:20px;margin:20px 0;border:1px solid #e2e8f0;">
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">
                  <span style="color:#6b7280;font-size:13px;">Folio</span>
                  <span style="float:right;color:#1e293b;font-weight:600;font-size:13px;">${folioDisplay}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">
                  <span style="color:#6b7280;font-size:13px;">Tipo de Comprobante</span>
                  <span style="float:right;color:#1e293b;font-weight:600;font-size:13px;">${invoiceTypeLabel}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">
                  <span style="color:#6b7280;font-size:13px;">RFC Receptor</span>
                  <span style="float:right;color:#1e293b;font-weight:600;font-size:13px;">${cfdi.receptor_rfc || "N/A"}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">
                  <span style="color:#6b7280;font-size:13px;">Razon Social</span>
                  <span style="float:right;color:#1e293b;font-weight:600;font-size:13px;">${cfdi.receptor_razon_social || "N/A"}</span>
                </td>
              </tr>
              ${cfdi.uuid_fiscal ? `<tr>
                <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">
                  <span style="color:#6b7280;font-size:13px;">UUID Fiscal (Folio SAT)</span>
                  <span style="float:right;color:#1e293b;font-size:11px;font-family:monospace;">${cfdi.uuid_fiscal}</span>
                </td>
              </tr>` : ""}
              <tr>
                <td style="padding:8px 0;">
                  <span style="color:#6b7280;font-size:13px;">Total</span>
                  <span style="float:right;color:#0e7490;font-weight:700;font-size:16px;">${totalFormatted}</span>
                </td>
              </tr>
            </table>

            <div style="text-align:center;margin:24px 0;">
              <p style="color:#374151;font-size:14px;font-weight:600;margin-bottom:12px;">Tu comprobante fiscal</p>
              ${attachmentNote}
              ${invoicesLink}
            </div>

            <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:24px;">
              Si tienes alguna duda sobre tu factura, contacta a nuestro equipo de soporte.<br>
              Este correo fue generado automaticamente, por favor no respondas a este mensaje.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:16px;text-align:center;border-top:1px solid #e2e8f0;">
            <p style="color:#9ca3af;font-size:12px;margin:0;">ToursRed &copy; ${new Date().getFullYear()} | toursred.com</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const emailPayload = {
      api_key: emailSettings.smtp_api_key,
      to: [recipientEmail],
      sender: senderEmail,
      subject: `Tu factura electronica ToursRed - ${invoiceTypeLabel} (${folioDisplay})`,
      html_body: emailHtml,
      ...(attachments.length > 0 ? { attachments } : {}),
    };

    const sendRes = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    });

    // SMTP2GO responde HTTP 200 aunque el envio falle: el resultado real va en el
    // cuerpo (data.succeeded / data.failed / data.failures). Antes solo se miraba
    // sendRes.ok, asi que la funcion devolvia success:true y marcaba
    // email_sent = true para correos que nunca salieron.
    const sendBody = await sendRes.text();
    let sendJson: any = null;
    try { sendJson = JSON.parse(sendBody); } catch { /* respuesta no-JSON */ }

    const succeeded = Number(sendJson?.data?.succeeded ?? 0);
    const failed = Number(sendJson?.data?.failed ?? 0);
    const failures = sendJson?.data?.failures ?? sendJson?.data?.error ?? null;

    if (!sendRes.ok || succeeded < 1) {
      console.error(
        `smtp2go no envio el CFDI ${cfdi_invoice_id} a ${recipientEmail}: ` +
          `http=${sendRes.status} succeeded=${succeeded} failed=${failed} ` +
          `failures=${JSON.stringify(failures)} body=${sendBody.slice(0, 500)}`
      );
      return new Response(
        JSON.stringify({
          success: false,
          message: "Email send failed",
          http: sendRes.status,
          succeeded,
          failed,
          failures,
          detail: sendBody.slice(0, 500),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase
      .from("cfdi_invoices")
      .update({ email_sent: true })
      .eq("id", cfdi_invoice_id);

    return new Response(
      JSON.stringify({ success: true, recipient: recipientEmail }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
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
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
