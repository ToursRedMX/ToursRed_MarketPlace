import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";
import * as XLSX from "npm:xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface InsuranceNotificationRequest {
  booking_id: string;
  booking_code: string;
  tour_name: string;
  tour_start_date: string;
  tour_end_date: string;
  agency_name: string;
  traveler_name: string;
  traveler_email: string;
  count_adultos: number;
  count_ninos: number;
  count_infantes: number;
  count_adultos_mayores: number;
  total_travelers: number;
  tour_days: number;
  insurance_cost: number;
  insurance_discount_amount?: number;
  insurance_effective_cost?: number;
}

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

function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr + "T12:00:00");
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return dateStr;
  }
}

function generateXlsxBase64(
  travelers: any[],
  bookingCode: string,
  tourName: string,
  agencyName: string,
  tourStart: string,
  tourEnd: string
): { base64: string; filename: string } {
  const headers = [
    "Nombre",
    "Apellido",
    "País",
    "Tipo de documento",
    "Número de documento",
    "Fecha de nacimiento",
    "Email",
    "Nombre contacto emergencia",
    "Teléfono contacto emergencia",
  ];

  const rows = travelers.map((t) => {
    // Usar nombre_real/apellido_real del titular, luego el campo apellido separado de DB,
    // y como último recurso hacer split del campo nombre completo
    const nombre = t.nombre_real || (t.nombre || "").trim().split(/\s+/)[0] || "";
    const apellido = t.apellido_real || t.apellido || (t.nombre || "").trim().split(/\s+/).slice(1).join(" ") || "";
    const tipoDoc = t.documento_tipo === "pasaporte" ? "PASAPORTE" : "Otro";
    const numDoc = (t.documento_numero || t.curp_fallback || "").toUpperCase();
    return [
      nombre,
      apellido,
      "México",
      tipoDoc,
      numDoc,
      formatDateShort(t.fecha_nacimiento),
      t.email || "",
      t.emergency_contact_name || "",
      t.emergency_contact_phone || "",
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws["!cols"] = [
    { wch: 20 }, { wch: 25 }, { wch: 12 }, { wch: 18 },
    { wch: 22 }, { wch: 18 }, { wch: 30 }, { wch: 30 }, { wch: 22 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Pasajeros");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return { base64, filename: `seguro_${bookingCode}_pasajeros.xlsx` };
}

const TOURSRED_LOGO_HTML = `<img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" style="max-width:180px;height:auto;background:rgba(255,255,255,0.15);padding:8px 12px;border-radius:8px;" />`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const payload: InsuranceNotificationRequest = await req.json();

    const {
      booking_id,
      booking_code,
      tour_name,
      tour_start_date,
      tour_end_date,
      agency_name,
      traveler_name,
      traveler_email,
      count_adultos,
      count_ninos,
      count_infantes,
      count_adultos_mayores,
      total_travelers,
      tour_days,
      insurance_cost,
      insurance_discount_amount = 0,
      insurance_effective_cost,
    } = payload;

    const effectiveCost = insurance_effective_cost ?? insurance_cost;
    const discountAmount = insurance_discount_amount ?? 0;
    const isFree = effectiveCost === 0 && discountAmount > 0;

    const { data: emailSettings } = await supabase
      .from("email_settings")
      .select("smtp_api_key, contact_email")
      .maybeSingle();

    if (!emailSettings?.smtp_api_key) {
      throw new Error("Email settings no configurados");
    }

    // Obtener datos individuales de cada viajero asegurado (incluyendo apellido)
    const { data: bookingTravelers } = await supabase
      .from("booking_travelers")
      .select("nombre, apellido, fecha_nacimiento, documento_tipo, documento_numero, emergency_contact_name, emergency_contact_phone, email, categoria_viajero")
      .eq("booking_id", booking_id)
      .neq("categoria_viajero", "mascota")
      .eq("is_cancelled", false)
      .order("created_at", { ascending: true });

    // Obtener el CURP, nombre y apellidos del perfil del usuario titular como fallback
    const { data: bookingUser } = await supabase
      .from("bookings")
      .select("users!bookings_user_id_fkey(curp, nombre, apellidos)")
      .eq("id", booking_id)
      .maybeSingle();

    const userCurp = (bookingUser?.users as any)?.curp || "";
    const userNombre = (bookingUser?.users as any)?.nombre || "";
    const userApellidos = (bookingUser?.users as any)?.apellidos || "";

    // Deduplicar: si hay dos registros con el mismo nombre, quedarse con el más completo
    const dedupedTravelers = (bookingTravelers || []).reduce((acc: any[], t: any) => {
      const existing = acc.findIndex((x) => (x.nombre || "").trim().toLowerCase() === (t.nombre || "").trim().toLowerCase());
      const score = (t: any) => (t.documento_numero ? 2 : 0) + (t.fecha_nacimiento ? 1 : 0) + (t.emergency_contact_name ? 1 : 0);
      if (existing === -1) {
        acc.push(t);
      } else if (score(t) > score(acc[existing])) {
        acc[existing] = t;
      }
      return acc;
    }, []);

    // Inyectar curp_fallback y nombre/apellido del perfil cuando el viajero es el titular
    const travelers = dedupedTravelers.map((t) => {
      const isTitular =
        userNombre &&
        (t.nombre || "").trim().toLowerCase().includes(userNombre.trim().toLowerCase());
      return {
        ...t,
        curp_fallback: t.documento_numero ? "" : userCurp,
        nombre_real: isTitular ? userNombre : null,
        apellido_real: isTitular ? userApellidos : null,
      };
    });

    const recipientEmail = "seguros@toursred.com.mx";
    const pricePerDay = total_travelers > 0 ? insurance_cost / tour_days / total_travelers : insurance_cost;

    const travelerCountRows = [
      count_adultos > 0 ? `<tr><td style="padding:6px 12px;color:#374151;">Adultos</td><td style="padding:6px 12px;text-align:right;font-weight:600;">${count_adultos}</td></tr>` : "",
      count_ninos > 0 ? `<tr><td style="padding:6px 12px;color:#374151;">Niños</td><td style="padding:6px 12px;text-align:right;font-weight:600;">${count_ninos}</td></tr>` : "",
      count_infantes > 0 ? `<tr><td style="padding:6px 12px;color:#374151;">Infantes</td><td style="padding:6px 12px;text-align:right;font-weight:600;">${count_infantes}</td></tr>` : "",
      count_adultos_mayores > 0 ? `<tr><td style="padding:6px 12px;color:#374151;">Adultos mayores</td><td style="padding:6px 12px;text-align:right;font-weight:600;">${count_adultos_mayores}</td></tr>` : "",
    ].filter(Boolean).join("");

    const detailedTravelerRows = travelers.map((t, i) => {
      const tipoDoc = t.documento_tipo === "pasaporte" ? "Pasaporte" : "Otro";
      const numDoc = (t.documento_numero || t.curp_fallback || "").toUpperCase() || "—";
      const emergencia = t.emergency_contact_name
        ? `${t.emergency_contact_name}${t.emergency_contact_phone ? " · " + t.emergency_contact_phone : ""}`
        : "—";
      const bg = i % 2 === 0 ? "#f9fafb" : "#ffffff";
      return `
      <tr style="background:${bg};">
        <td style="padding:8px 10px;font-size:12px;color:#111827;font-weight:600;">${i + 1}. ${t.nombre || "—"}</td>
        <td style="padding:8px 10px;font-size:12px;color:#374151;">${formatDateShort(t.fecha_nacimiento)}</td>
        <td style="padding:8px 10px;font-size:12px;color:#374151;">${tipoDoc}: <span style="font-family:monospace;">${numDoc}</span></td>
        <td style="padding:8px 10px;font-size:12px;color:#6b7280;">${emergencia}</td>
      </tr>`;
    }).join("");

    const hasTravelerDetails = travelers.some(t => t.documento_numero || t.emergency_contact_name);

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Nueva solicitud de seguro de viaje</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

          <!-- Header con logo -->
          <tr>
            <td style="background:linear-gradient(135deg,#064e3b,#065f46);padding:28px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    ${TOURSRED_LOGO_HTML}
                    <p style="color:#a7f3d0;font-size:11px;margin:4px 0 0;">Plataforma de viajes</p>
                  </td>
                  <td align="right">
                    <div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:10px 16px;display:inline-block;text-align:center;">
                      <div style="font-size:28px;">🛡️</div>
                      <div style="color:#a7f3d0;font-size:11px;margin-top:4px;">Seguro de Viaje</div>
                    </div>
                  </td>
                </tr>
              </table>
              <h1 style="color:#ffffff;font-size:20px;font-weight:700;margin:16px 0 4px;">Nueva solicitud de seguro de viaje</h1>
              <p style="color:#a7f3d0;font-size:13px;margin:0;">Emitir póliza con Universal Assistance</p>
            </td>
          </tr>

          <!-- Alert -->
          <tr>
            <td style="padding:24px 40px 0;">
              ${isFree ? `
              <div style="background:#fefce8;border:1px solid #fde047;border-radius:8px;padding:14px 18px;">
                <p style="margin:0;font-weight:600;color:#713f12;font-size:14px;">⚠️ NO se requiere cobro — seguro con descuento 100%</p>
                <p style="margin:4px 0 0;color:#92400e;font-size:13px;">El viajero obtuvo el seguro <strong>GRATIS</strong> mediante un código de descuento (descuento aplicado: <strong>${formatMXN(discountAmount)}</strong>). El precio original era <strong>${formatMXN(insurance_cost)}</strong>. <strong>No buscar ningún pago por este seguro.</strong></p>
              </div>
              ` : `
              <div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:8px;padding:14px 18px;">
                <p style="margin:0;font-weight:600;color:#065f46;font-size:14px;">✅ Pago recibido — seguro contratado</p>
                <p style="margin:4px 0 0;color:#047857;font-size:13px;">El viajero pagó <strong>${formatMXN(effectiveCost)}</strong> por cobertura de seguro de viaje. Favor de emitir la póliza correspondiente.</p>
              </div>
              `}
            </td>
          </tr>

          <!-- Datos de la reserva -->
          <tr>
            <td style="padding:24px 40px;">
              <h2 style="font-size:15px;font-weight:700;color:#111827;margin:0 0 14px;border-bottom:2px solid #e5e7eb;padding-bottom:8px;">📋 Datos de la Reserva</h2>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr style="background:#f9fafb;"><td style="padding:8px 12px;color:#6b7280;font-size:13px;width:42%;">Código de reserva</td><td style="padding:8px 12px;font-weight:700;font-size:13px;font-family:monospace;color:#111827;">${booking_code}</td></tr>
                <tr><td style="padding:8px 12px;color:#6b7280;font-size:13px;">Tour</td><td style="padding:8px 12px;font-weight:600;font-size:13px;color:#111827;">${tour_name}</td></tr>
                <tr style="background:#f9fafb;"><td style="padding:8px 12px;color:#6b7280;font-size:13px;">Agencia</td><td style="padding:8px 12px;font-size:13px;color:#374151;">${agency_name || "—"}</td></tr>
                <tr><td style="padding:8px 12px;color:#6b7280;font-size:13px;">Fecha de salida</td><td style="padding:8px 12px;font-size:13px;color:#374151;">${formatDate(tour_start_date)}</td></tr>
                <tr style="background:#f9fafb;"><td style="padding:8px 12px;color:#6b7280;font-size:13px;">Fecha de regreso</td><td style="padding:8px 12px;font-size:13px;color:#374151;">${formatDate(tour_end_date)}</td></tr>
                <tr><td style="padding:8px 12px;color:#6b7280;font-size:13px;">Días de cobertura</td><td style="padding:8px 12px;font-weight:600;font-size:13px;color:#111827;">${tour_days} día${tour_days !== 1 ? "s" : ""}</td></tr>
              </table>
            </td>
          </tr>

          <!-- Viajero titular -->
          <tr>
            <td style="padding:0 40px 24px;">
              <h2 style="font-size:15px;font-weight:700;color:#111827;margin:0 0 14px;border-bottom:2px solid #e5e7eb;padding-bottom:8px;">👤 Viajero Titular</h2>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr style="background:#f9fafb;"><td style="padding:8px 12px;color:#6b7280;font-size:13px;width:42%;">Nombre</td><td style="padding:8px 12px;font-weight:600;font-size:13px;color:#111827;">${traveler_name || "—"}</td></tr>
                <tr><td style="padding:8px 12px;color:#6b7280;font-size:13px;">Email</td><td style="padding:8px 12px;font-size:13px;"><a href="mailto:${traveler_email}" style="color:#059669;">${traveler_email || "—"}</a></td></tr>
              </table>
            </td>
          </tr>

          <!-- Conteo -->
          <tr>
            <td style="padding:0 40px 24px;">
              <h2 style="font-size:15px;font-weight:700;color:#111827;margin:0 0 14px;border-bottom:2px solid #e5e7eb;padding-bottom:8px;">👥 Personas a Asegurar</h2>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
                ${travelerCountRows}
                <tr style="background:#ecfdf5;border-top:2px solid #6ee7b7;">
                  <td style="padding:8px 12px;color:#065f46;font-weight:700;font-size:13px;">Total de personas</td>
                  <td style="padding:8px 12px;text-align:right;font-weight:700;color:#065f46;font-size:15px;">${total_travelers}</td>
                </tr>
              </table>
            </td>
          </tr>

          ${hasTravelerDetails ? `
          <!-- Datos detallados -->
          <tr>
            <td style="padding:0 40px 24px;">
              <h2 style="font-size:15px;font-weight:700;color:#111827;margin:0 0 14px;border-bottom:2px solid #e5e7eb;padding-bottom:8px;">📄 Datos de Cada Asegurado</h2>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
                <tr style="background:#064e3b;">
                  <th style="padding:8px 10px;color:#a7f3d0;font-size:11px;font-weight:600;text-align:left;">Nombre completo</th>
                  <th style="padding:8px 10px;color:#a7f3d0;font-size:11px;font-weight:600;text-align:left;">Fecha nac.</th>
                  <th style="padding:8px 10px;color:#a7f3d0;font-size:11px;font-weight:600;text-align:left;">Documento</th>
                  <th style="padding:8px 10px;color:#a7f3d0;font-size:11px;font-weight:600;text-align:left;">Contacto emergencia</th>
                </tr>
                ${detailedTravelerRows}
              </table>
              <p style="font-size:11px;color:#9ca3af;margin:8px 0 0;">El archivo Excel adjunto contiene estos datos en el formato de importación de Universal Assistance.</p>
            </td>
          </tr>
          ` : ""}

          <!-- Costo -->
          <tr>
            <td style="padding:0 40px 32px;">
              <h2 style="font-size:15px;font-weight:700;color:#111827;margin:0 0 14px;border-bottom:2px solid #e5e7eb;padding-bottom:8px;">💰 Costo del Seguro</h2>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
                <tr style="background:#f9fafb;"><td style="padding:8px 12px;color:#6b7280;font-size:13px;">Precio por día por viajero</td><td style="padding:8px 12px;text-align:right;font-size:13px;color:#374151;">${formatMXN(pricePerDay)}</td></tr>
                <tr><td style="padding:8px 12px;color:#6b7280;font-size:13px;">Días × viajeros</td><td style="padding:8px 12px;text-align:right;font-size:13px;color:#374151;">${tour_days} × ${total_travelers}</td></tr>
                <tr style="background:#f9fafb;"><td style="padding:8px 12px;color:#6b7280;font-size:13px;">Precio original</td><td style="padding:8px 12px;text-align:right;font-size:13px;color:#374151;">${formatMXN(insurance_cost)}</td></tr>
                ${discountAmount > 0 ? `<tr><td style="padding:8px 12px;color:#b45309;font-size:13px;">Descuento aplicado (código)</td><td style="padding:8px 12px;text-align:right;font-size:13px;font-weight:600;color:#b45309;">-${formatMXN(discountAmount)}</td></tr>` : ""}
                <tr style="background:${isFree ? "#fefce8" : "#ecfdf5"};border-top:2px solid ${isFree ? "#fde047" : "#6ee7b7"};">
                  <td style="padding:10px 12px;color:${isFree ? "#713f12" : "#065f46"};font-weight:700;font-size:15px;">Total cobrado al viajero</td>
                  <td style="padding:10px 12px;text-align:right;font-weight:700;color:${isFree ? "#713f12" : "#065f46"};font-size:18px;">${isFree ? "GRATIS" : formatMXN(effectiveCost)}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Acción requerida -->
          <tr>
            <td style="padding:0 40px 32px;">
              <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:16px 20px;">
                <p style="margin:0 0 8px;font-weight:700;color:#92400e;font-size:14px;">⚡ Acción requerida</p>
                <p style="margin:0;color:#78350f;font-size:13px;line-height:1.6;">
                  Por favor emitir la póliza de asistencia de viaje para los viajeros indicados con <strong>Universal Assistance</strong>.
                  Enviar la póliza al email del viajero titular: <strong>${traveler_email}</strong><br/>
                  <span style="margin-top:6px;display:inline-block;">El archivo Excel adjunto contiene los datos de todos los pasajeros en el formato de importación de Universal Assistance.</span>
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                Este correo fue generado automáticamente por la plataforma ToursRed.<br/>
                Reserva ID: <code style="background:#e5e7eb;padding:1px 6px;border-radius:4px;">${booking_id}</code>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    // Generar Excel adjunto
    const { base64: xlsxBase64, filename: xlsxFilename } = generateXlsxBase64(
      travelers,
      booking_code,
      tour_name,
      agency_name,
      tour_start_date,
      tour_end_date
    );

    const emailPayload: any = {
      api_key: emailSettings.smtp_api_key,
      to: [recipientEmail],
      sender: emailSettings.contact_email,
      subject: `Seguro de viaje — ${booking_code} | ${tour_name}`,
      html_body: html,
      attachments: [
        {
          filename: xlsxFilename,
          fileblob: xlsxBase64,
          mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      ],
    };

    const smtpResponse = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emailPayload),
    });

    const smtpData = await smtpResponse.json();
    console.log("SMTP response:", JSON.stringify(smtpData));

    if (smtpData.data?.succeeded !== 1) {
      console.error("SMTP error:", smtpData);
      throw new Error("Error al enviar email de seguro: " + JSON.stringify(smtpData));
    }

    await supabase
      .from("bookings")
      .update({ insurance_email_sent: true })
      .eq("id", booking_id);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("send-travel-insurance-notification error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
