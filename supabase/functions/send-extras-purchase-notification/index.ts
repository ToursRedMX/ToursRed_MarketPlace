import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function formatMXN(amount: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr + "T12:00:00").toLocaleDateString("es-MX", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

const TOURSRED_LOGO_HTML = `<img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" style="max-width:180px;height:auto;background:rgba(255,255,255,0.15);padding:8px 12px;border-radius:8px;" />`;

async function sendEmail(
  apiKey: string,
  senderEmail: string,
  to: string[],
  subject: string,
  html: string
): Promise<void> {
  const response = await fetch("https://api.smtp2go.com/v3/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      to,
      sender: senderEmail,
      subject,
      html_body: html,
    }),
  });
  const data = await response.json();
  if (data.data?.succeeded !== 1) {
    throw new Error("smtp2go error: " + JSON.stringify(data));
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { booking_id, extra_type, bos_id } = await req.json();

    if (!booking_id || !extra_type) {
      return new Response(JSON.stringify({ error: "booking_id y extra_type son requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: emailSettings } = await supabase
      .from("email_settings")
      .select("smtp_api_key, contact_email")
      .maybeSingle();

    if (!emailSettings?.smtp_api_key) {
      return new Response(JSON.stringify({ error: "Email settings no configurados" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch full booking data with all joins
    const { data: booking } = await supabase
      .from("bookings")
      .select(`
        id, booking_code, travelers_count,
        count_adultos, count_ninos, count_infantes, count_adultos_mayores,
        selected_date, travel_insurance_cost,
        tours:tour_id(
          name, destination, start_date, end_date, image_url,
          agencies(name, contact_email)
        ),
        users:user_id(first_name, last_name, email)
      `)
      .eq("id", booking_id)
      .maybeSingle();

    if (!booking) {
      return new Response(JSON.stringify({ error: "Reserva no encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tour = booking.tours as any;
    const agency = tour?.agencies as any;
    const user = booking.users as any;

    const travelerName = [user?.first_name, user?.last_name].filter(Boolean).join(" ") || "Viajero";
    const travelerEmail = user?.email || "";
    const agencyName = agency?.name || "Agencia";
    const agencyEmail = agency?.contact_email || "";
    const tourName = tour?.name || "Tour";

    const refDate = booking.selected_date || tour?.start_date;
    const endDate = tour?.end_date;
    let tourDays = 1;
    if (refDate && endDate) {
      const start = new Date(refDate);
      const end = new Date(endDate);
      tourDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    }

    const totalTravelers = Math.max(
      1,
      (booking.travelers_count || 0) ||
      ((booking.count_adultos || 0) + (booking.count_ninos || 0) +
       (booking.count_infantes || 0) + (booking.count_adultos_mayores || 0))
    );

    // ── INSURANCE ────────────────────────────────────────────────────────────
    if (extra_type === "insurance") {
      const insuranceCost = Number(booking.travel_insurance_cost || 0);

      // 1. Send traveler confirmation email
      if (travelerEmail) {
        const travelerHtml = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>Seguro contratado</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#064e3b,#065f46);padding:28px 40px;">
            ${TOURSRED_LOGO_HTML}
            <h1 style="color:#ffffff;font-size:22px;font-weight:700;margin:16px 0 4px;">¡Tu seguro de viaje está activo!</h1>
            <p style="color:#a7f3d0;font-size:14px;margin:0;">Tu tranquilidad está protegida</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <p style="color:#374151;font-size:15px;margin:0 0 24px;">Hola <strong>${travelerName}</strong>,</p>
            <p style="color:#374151;font-size:15px;margin:0 0 24px;">Tu seguro de asistencia de viaje ha sido contratado exitosamente para el siguiente tour:</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:24px;">
              <tr style="background:#f9fafb;"><td style="padding:10px 16px;color:#6b7280;font-size:13px;width:45%;">Reserva</td><td style="padding:10px 16px;font-weight:700;font-family:monospace;color:#111827;">${booking.booking_code}</td></tr>
              <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Tour</td><td style="padding:10px 16px;font-weight:600;color:#111827;">${tourName}</td></tr>
              <tr style="background:#f9fafb;"><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Agencia</td><td style="padding:10px 16px;color:#374151;">${agencyName}</td></tr>
              <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Fecha de salida</td><td style="padding:10px 16px;color:#374151;">${formatDate(refDate)}</td></tr>
              <tr style="background:#f9fafb;"><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Fecha de regreso</td><td style="padding:10px 16px;color:#374151;">${formatDate(endDate)}</td></tr>
              <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Personas aseguradas</td><td style="padding:10px 16px;font-weight:600;color:#111827;">${totalTravelers}</td></tr>
              ${insuranceCost > 0 ? `<tr style="background:#ecfdf5;border-top:2px solid #6ee7b7;"><td style="padding:10px 16px;color:#065f46;font-weight:700;font-size:15px;">Total pagado</td><td style="padding:10px 16px;font-weight:700;color:#065f46;font-size:16px;">${formatMXN(insuranceCost)}</td></tr>` : ""}
            </table>
            <div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
              <p style="margin:0;font-weight:600;color:#065f46;font-size:14px;">🛡️ Cobertura activa</p>
              <p style="margin:6px 0 0;color:#047857;font-size:13px;line-height:1.6;">Tu póliza de asistencia de viaje será emitida por <strong>Universal Assistance</strong>. Recibirás los documentos de tu póliza por separado antes de la fecha de salida.</p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">ToursRed — Tu plataforma de viajes de confianza</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
        await sendEmail(
          emailSettings.smtp_api_key,
          emailSettings.contact_email,
          [travelerEmail],
          `¡Tu seguro de viaje está activo! — ${booking.booking_code}`,
          travelerHtml
        ).catch((e) => console.error("Error sending traveler insurance email:", e));
      }

      // 2. Notify insurance team with COMPLETE data
      const insurancePayload = {
        booking_id,
        booking_code: booking.booking_code,
        tour_name: tourName,
        tour_start_date: tour?.start_date || refDate || "",
        tour_end_date: tour?.end_date || endDate || "",
        agency_name: agencyName,
        traveler_name: travelerName,
        traveler_email: travelerEmail,
        count_adultos: booking.count_adultos || 0,
        count_ninos: booking.count_ninos || 0,
        count_infantes: booking.count_infantes || 0,
        count_adultos_mayores: booking.count_adultos_mayores || 0,
        total_travelers: totalTravelers,
        tour_days: tourDays,
        insurance_cost: insuranceCost,
        insurance_discount_amount: 0,
        insurance_effective_cost: insuranceCost,
      };

      await fetch(`${supabaseUrl}/functions/v1/send-travel-insurance-notification`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
        body: JSON.stringify(insurancePayload),
      }).catch((e) => console.error("Error calling send-travel-insurance-notification:", e));

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── OPTIONAL SERVICE ──────────────────────────────────────────────────────
    if (extra_type === "optional_service") {
      if (!bos_id) {
        return new Response(JSON.stringify({ error: "bos_id es requerido para optional_service" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: bos } = await supabase
        .from("booking_optional_services")
        .select(`
          id, quantity, unit_price, subtotal, created_at,
          tour_optional_services!inner(name, description)
        `)
        .eq("id", bos_id)
        .maybeSingle();

      if (!bos) {
        return new Response(JSON.stringify({ error: "Servicio no encontrado" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const serviceInfo = bos.tour_optional_services as any;
      const serviceName = serviceInfo?.name || "Servicio opcional";
      const subtotal = Number(bos.subtotal || Number(bos.unit_price) * bos.quantity);

      // 1. Send traveler confirmation email
      if (travelerEmail) {
        const travelerHtml = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>Servicio adicional confirmado</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#0f766e,#0d9488);padding:28px 40px;">
            ${TOURSRED_LOGO_HTML}
            <h1 style="color:#ffffff;font-size:22px;font-weight:700;margin:16px 0 4px;">¡Servicio adicional confirmado!</h1>
            <p style="color:#99f6e4;font-size:14px;margin:0;">Tu servicio ha sido agregado a tu reserva</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <p style="color:#374151;font-size:15px;margin:0 0 24px;">Hola <strong>${travelerName}</strong>,</p>
            <p style="color:#374151;font-size:15px;margin:0 0 24px;">Se ha confirmado el siguiente servicio adicional para tu reserva:</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:24px;">
              <tr style="background:#f9fafb;"><td style="padding:10px 16px;color:#6b7280;font-size:13px;width:45%;">Reserva</td><td style="padding:10px 16px;font-weight:700;font-family:monospace;color:#111827;">${booking.booking_code}</td></tr>
              <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Tour</td><td style="padding:10px 16px;font-weight:600;color:#111827;">${tourName}</td></tr>
              <tr style="background:#f9fafb;"><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Agencia</td><td style="padding:10px 16px;color:#374151;">${agencyName}</td></tr>
              <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Servicio adicional</td><td style="padding:10px 16px;font-weight:600;color:#111827;">${serviceName}</td></tr>
              ${serviceInfo?.description ? `<tr style="background:#f9fafb;"><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Descripción</td><td style="padding:10px 16px;color:#374151;">${serviceInfo.description}</td></tr>` : ""}
              <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Cantidad</td><td style="padding:10px 16px;font-weight:600;color:#111827;">${bos.quantity}</td></tr>
              <tr style="background:#f9fafb;"><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Precio unitario</td><td style="padding:10px 16px;color:#374151;">${formatMXN(Number(bos.unit_price))}</td></tr>
              <tr style="background:#ecfdf5;border-top:2px solid #6ee7b7;"><td style="padding:10px 16px;color:#065f46;font-weight:700;font-size:15px;">Total pagado</td><td style="padding:10px 16px;font-weight:700;color:#065f46;font-size:16px;">${formatMXN(subtotal)}</td></tr>
            </table>
            <div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;padding:16px 20px;">
              <p style="margin:0;color:#0f766e;font-size:13px;line-height:1.6;">Tu servicio ha sido registrado y la agencia ha sido notificada. Cualquier duda contacta a través de la plataforma ToursRed.</p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">ToursRed — Tu plataforma de viajes de confianza</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
        await sendEmail(
          emailSettings.smtp_api_key,
          emailSettings.contact_email,
          [travelerEmail],
          `Servicio adicional confirmado — ${booking.booking_code}: ${serviceName}`,
          travelerHtml
        ).catch((e) => console.error("Error sending traveler optional service email:", e));
      }

      // 2. Notify agency
      if (agencyEmail) {
        const agencyHtml = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>Nuevo servicio adicional contratado</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#1e40af,#1d4ed8);padding:28px 40px;">
            ${TOURSRED_LOGO_HTML}
            <h1 style="color:#ffffff;font-size:22px;font-weight:700;margin:16px 0 4px;">Nuevo servicio adicional contratado</h1>
            <p style="color:#bfdbfe;font-size:14px;margin:0;">Un viajero ha adquirido un servicio adicional para su reserva</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <p style="color:#374151;font-size:15px;margin:0 0 24px;">Estimada agencia <strong>${agencyName}</strong>,</p>
            <p style="color:#374151;font-size:15px;margin:0 0 24px;">Un viajero ha contratado el siguiente servicio adicional:</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:24px;">
              <tr style="background:#f9fafb;"><td style="padding:10px 16px;color:#6b7280;font-size:13px;width:45%;">Reserva</td><td style="padding:10px 16px;font-weight:700;font-family:monospace;color:#111827;">${booking.booking_code}</td></tr>
              <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Tour</td><td style="padding:10px 16px;font-weight:600;color:#111827;">${tourName}</td></tr>
              <tr style="background:#f9fafb;"><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Viajero</td><td style="padding:10px 16px;color:#374151;">${travelerName}</td></tr>
              <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Email viajero</td><td style="padding:10px 16px;"><a href="mailto:${travelerEmail}" style="color:#1d4ed8;">${travelerEmail}</a></td></tr>
              <tr style="background:#f9fafb;"><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Servicio</td><td style="padding:10px 16px;font-weight:600;color:#111827;">${serviceName}</td></tr>
              ${serviceInfo?.description ? `<tr><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Descripción</td><td style="padding:10px 16px;color:#374151;">${serviceInfo.description}</td></tr>` : ""}
              <tr style="background:#f9fafb;"><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Cantidad</td><td style="padding:10px 16px;font-weight:600;color:#111827;">${bos.quantity}</td></tr>
              <tr style="background:#eff6ff;border-top:2px solid #93c5fd;"><td style="padding:10px 16px;color:#1e40af;font-weight:700;font-size:15px;">Total cobrado</td><td style="padding:10px 16px;font-weight:700;color:#1e40af;font-size:16px;">${formatMXN(subtotal)}</td></tr>
            </table>
            <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:16px 20px;">
              <p style="margin:0;font-weight:600;color:#1e40af;font-size:14px;">⚡ Acción requerida</p>
              <p style="margin:6px 0 0;color:#1d4ed8;font-size:13px;line-height:1.6;">Por favor coordinar la prestación de este servicio adicional con el viajero. El pago ya fue procesado exitosamente.</p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">ToursRed — Plataforma de viajes</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
        await sendEmail(
          emailSettings.smtp_api_key,
          emailSettings.contact_email,
          [agencyEmail],
          `Nuevo servicio adicional — ${booking.booking_code}: ${serviceName}`,
          agencyHtml
        ).catch((e) => console.error("Error sending agency optional service email:", e));
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "extra_type no valido" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("send-extras-purchase-notification error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
