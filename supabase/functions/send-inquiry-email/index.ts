import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface InquiryData {
  name: string;
  email: string;
  phone: string;
  destination: string;
  travel_date?: string;
  num_people: number;
  tour_code?: string;
  message?: string;
  source?: string;
  user_id?: string;
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

    const inquiryData: InquiryData = await req.json();
    const { name, email, phone, destination, travel_date, num_people, tour_code, message, source, user_id } = inquiryData;

    if (!name || !email || !phone || !destination || !num_people) {
      return new Response(
        JSON.stringify({ error: "Faltan campos requeridos" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const inquirySource = source || "mega_travel";
    const formattedTourCode = tour_code
      ? (inquirySource === 'mega_travel' ? `MT-${tour_code}` : tour_code)
      : null;
    const isNefertari = inquirySource === 'nefertari_travel';
    const destinationLabel = isNefertari ? 'Nombre del Viaje' : 'Destino de Interes';
    const sourceLabel = isNefertari ? 'Nefertari Travel' : (inquirySource === 'mega_travel' ? 'Mega Travel' : inquirySource);

    // Insert inquiry into database
    const { data: inquiry, error: insertError } = await supabase
      .from("international_tour_inquiries")
      .insert({
        user_id: user_id || null,
        name,
        email,
        phone,
        destination,
        travel_date: travel_date || null,
        num_people,
        tour_code: formattedTourCode,
        message: message || null,
        source: inquirySource,
        status: "pending"
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error inserting inquiry:", insertError);
      return new Response(
        JSON.stringify({ error: "Error al guardar la cotización" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get email settings
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

    const logoUrl = "https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png";
    const contactPhone = "+52 55 47127668";
    const contactEmail = emailSettings.contact_email || "contacto@toursred.com";

    // Send email to admin
    const adminTextContent = `
Nueva Cotizacion de Tour Internacional - ${sourceLabel}

Detalles del Viajero:
Nombre: ${name}
Email: ${email}
Telefono: ${phone}

Detalles del Viaje:
${destinationLabel}: ${destination}
${formattedTourCode ? `Codigo de Viaje: ${formattedTourCode}` : ''}
Fecha Aproximada: ${travel_date || "No especificada"}
Numero de Personas: ${num_people}
Fuente: ${sourceLabel}

Mensaje/Comentarios:
${message || "Sin comentarios adicionales"}

---
Esta cotizacion fue enviada desde ToursRed.
ID de Cotizacion: ${inquiry.id}
    `;

    const adminHtmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f3f4f6; }
    .container { max-width: 600px; margin: 0 auto; }
    .logo-section { background-color: #ffffff; padding: 30px 20px; text-align: center; }
    .logo { max-width: 200px; height: auto; }
    .header { background-color: #b8dfe6; padding: 25px 20px; text-align: center; }
    .header h1 { margin: 0; color: #1e40af; font-size: 22px; }
    .header p { margin: 8px 0 0 0; color: #374151; font-size: 14px; }
    .content { background-color: #ffffff; padding: 30px 20px; }
    .section { margin-bottom: 25px; }
    .section-title { font-weight: bold; color: #1e40af; margin-bottom: 12px; font-size: 16px; }
    .info-row { padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
    .info-label { font-weight: 600; color: #374151; }
    .info-value { color: #1f2937; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .message-box { background-color: #f9fafb; padding: 15px; border-left: 4px solid #f59e0b; border-radius: 4px; margin-top: 10px; }
    .btn { display: inline-block; padding: 12px 24px; background-color: #1e40af; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; }
    .contact-section { background-color: #0d9488; padding: 20px; color: #ffffff; }
    .contact-section a { color: #ffffff; text-decoration: underline; }
    .footer { background-color: #f9fafb; padding: 20px; text-align: center; color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb; }
    .footer a { color: #1e40af; text-decoration: none; }
  </style>
</head>
<body>
  <div class=\"container\">
    <div class=\"logo-section\">
      <img src=\"${logoUrl}\" alt=\"ToursRed Logo\" class=\"logo\" />
    </div>
    <div class=\"header\">
      <h1>Nueva Cotizacion Internacional</h1>
      <p>Fuente: <strong>${sourceLabel}</strong> | ${destination}</p>
    </div>
    <div class=\"content\">
      <div class=\"section\">
        <div class=\"section-title\">Informacion del Viajero</div>
        <div class=\"info-row\">
          <span class=\"info-label\">Nombre:</span> <span class=\"info-value\">${name}</span>
        </div>
        <div class=\"info-row\">
          <span class=\"info-label\">Email:</span> <span class=\"info-value\"><a href=\"mailto:${email}\">${email}</a></span>
        </div>
        <div class=\"info-row\">
          <span class=\"info-label\">Telefono:</span> <span class=\"info-value\"><a href=\"tel:${phone}\">${phone}</a></span>
        </div>
      </div>

      <div class=\"section\">
        <div class=\"section-title\">Detalles del Viaje</div>
        <div class=\"info-row\">
          <span class=\"info-label\">${destinationLabel}:</span> <span class=\"info-value\"><strong>${destination}</strong></span>
        </div>
        ${formattedTourCode ? `
        <div class=\"info-row\">
          <span class=\"info-label\">Codigo de Viaje:</span> <span class=\"info-value\"><strong style=\"color: #f59e0b; font-size: 16px;\">${formattedTourCode}</strong></span>
        </div>
        ` : ''}
        <div class=\"info-row\">
          <span class=\"info-label\">Fecha Aproximada:</span> <span class=\"info-value\">${travel_date || "No especificada"}</span>
        </div>
        <div class=\"info-row\">
          <span class=\"info-label\">Numero de Personas:</span> <span class=\"info-value\">${num_people}</span>
        </div>
      </div>

      ${message ? `
      <div class=\"section\">
        <div class=\"section-title\">Mensaje/Comentarios</div>
        <div class=\"message-box\">
          ${message.replace(/\n/g, "<br>")}
        </div>
      </div>
      ` : ''}

      <div style=\"text-align: center; margin-top: 30px;\">
        <a href=\"mailto:${email}\" class=\"btn\">Responder al Viajero</a>
      </div>
    </div>
    <div class=\"footer\">
      <p style=\"margin: 0;\"><strong>ToursRed</strong></p>
      <p style=\"margin: 4px 0;\">Red de Agencias de Viajes Aliadas</p>
      <p style=\"margin: 4px 0;\">ID: ${inquiry.id}</p>
      <p style=\"margin: 4px 0;\">Recibida el ${new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
    </div>
  </div>
</body>
</html>
    `;

    const adminEmailPayload = {
      api_key: emailSettings.smtp_api_key,
      to: [emailSettings.contact_email],
      sender: `no-reply@toursred.com`,
      subject: `Nueva Cotizacion Internacional - ${sourceLabel} - ${destination}`,
      text_body: adminTextContent,
      html_body: adminHtmlContent,
      custom_headers: [
        {
          header: "Reply-To",
          value: email
        }
      ]
    };

    console.log("Sending admin email via SMTP2GO API...");

    const adminResponse = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(adminEmailPayload),
    });

    const adminResult = await adminResponse.json();

    if (!adminResponse.ok || adminResult.data?.error) {
      console.error("SMTP2GO API Error (Admin):", adminResult);
    } else {
      console.log("Admin email sent successfully");
    }

    // Send confirmation email to user
    const userTextContent = `
Hemos recibido tu solicitud - ${sourceLabel} Tours Internacionales

Hola ${name},

Nuestro equipo la esta revisando y se pondra en contacto contigo en menos de 24 horas.

Resumen de tu Solicitud:
Nombre: ${name}
Email: ${email}
Telefono: ${phone}
${destinationLabel}: ${destination}
${formattedTourCode ? `Codigo de Viaje: ${formattedTourCode}` : ''}
Fecha Aproximada: ${travel_date || "Por definir"}
Numero de Personas: ${num_people}

Necesitas ayuda inmediata?
Telefono: ${contactPhone}
Email: ${contactEmail}
Horario: Lunes a Viernes, 9:00 AM - 6:00 PM

ToursRed
Red de Agencias de Viajes Aliadas
    `;

    const userHtmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f3f4f6; }
    .container { max-width: 600px; margin: 0 auto; }
    .logo-section { background-color: #ffffff; padding: 30px 20px; text-align: center; }
    .logo { max-width: 200px; height: auto; }
    .content { background-color: #ffffff; padding: 30px 20px; }
    .title-section { text-align: center; margin-bottom: 25px; }
    .title-section h1 { color: #1f2937; font-size: 22px; margin: 0 0 10px 0; }
    .title-section p { color: #6b7280; font-size: 14px; margin: 0; }
    .section { margin-bottom: 25px; }
    .section-title { font-weight: bold; color: #1e40af; margin-bottom: 12px; font-size: 16px; }
    .info-row { padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
    .info-label { font-weight: 600; color: #374151; }
    .info-value { color: #1f2937; }
    .info-value a { color: #1e40af; text-decoration: underline; }
    .contact-section { background-color: #0d9488; padding: 20px; color: #ffffff; }
    .contact-section h3 { margin: 0 0 12px 0; font-size: 16px; }
    .contact-section p { margin: 6px 0; font-size: 14px; }
    .contact-section a { color: #ffffff; text-decoration: underline; }
    .footer { background-color: #f9fafb; padding: 20px; text-align: center; color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb; }
    .footer a { color: #1e40af; text-decoration: none; }
  </style>
</head>
<body>
  <div class=\"container\">
    <div class=\"logo-section\">
      <img src=\"${logoUrl}\" alt=\"ToursRed Logo\" class=\"logo\" />
    </div>
    <div class=\"content\">
      <div class=\"title-section\">
        <h1>Hemos recibido tu solicitud</h1>
        <p>Nuestro equipo la esta revisando y se pondra en contacto contigo en menos de 24 horas.</p>
      </div>

      <div class=\"section\">
        <div class=\"section-title\">Resumen de tu Solicitud</div>
        <div class=\"info-row\">
          <span class=\"info-label\">Nombre:</span> <span class=\"info-value\">${name}</span>
        </div>
        <div class=\"info-row\">
          <span class=\"info-label\">Email:</span> <span class=\"info-value\"><a href=\"mailto:${email}\">${email}</a></span>
        </div>
        <div class=\"info-row\">
          <span class=\"info-label\">Telefono:</span> <span class=\"info-value\">${phone}</span>
        </div>
        <div class=\"info-row\">
          <span class=\"info-label\">${destinationLabel}:</span> <span class=\"info-value\"><strong>${destination}</strong></span>
        </div>
        ${formattedTourCode ? `
        <div class=\"info-row\">
          <span class=\"info-label\">Codigo de Viaje:</span> <span class=\"info-value\"><strong style=\"color: #f59e0b;\">${formattedTourCode}</strong></span>
        </div>
        ` : ''}
        <div class=\"info-row\">
          <span class=\"info-label\">Fecha Aproximada:</span> <span class=\"info-value\">${travel_date || "Por definir"}</span>
        </div>
        <div class=\"info-row\">
          <span class=\"info-label\">Numero de Personas:</span> <span class=\"info-value\">${num_people}</span>
        </div>
      </div>
    </div>
    <div class=\"contact-section\">
      <h3>Necesitas ayuda inmediata?</h3>
      <p><strong>Telefono:</strong> ${contactPhone}</p>
      <p><strong>Email:</strong> <a href=\"mailto:${contactEmail}\">${contactEmail}</a></p>
      <p><strong>Horario:</strong> Lunes a Viernes, 9:00 AM - 6:00 PM</p>
    </div>
    <div class=\"footer\">
      <p style=\"margin: 0;\"><strong>ToursRed</strong></p>
      <p style=\"margin: 4px 0;\">Red de Agencias de Viajes Aliadas</p>
      <p style=\"margin: 8px 0 0 0;\"><a href=\"mailto:${contactEmail}\">${contactEmail}</a> | ${contactPhone}</p>
    </div>
  </div>
</body>
</html>
    `;

    const userEmailPayload = {
      api_key: emailSettings.smtp_api_key,
      to: [email],
      sender: `no-reply@toursred.com`,
      subject: `Cotizacion Recibida! - ${sourceLabel} Tours Internacionales`,
      text_body: userTextContent,
      html_body: userHtmlContent,
      custom_headers: [
        {
          header: "Reply-To",
          value: contactEmail
        }
      ]
    };

    console.log("Sending user confirmation email via SMTP2GO API...");

    const userResponse = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(userEmailPayload),
    });

    const userResult = await userResponse.json();

    if (!userResponse.ok || userResult.data?.error) {
      console.error("SMTP2GO API Error (User):", userResult);
    } else {
      console.log("User confirmation email sent successfully");
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Cotización enviada correctamente",
        inquiry_id: inquiry.id
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error processing inquiry:", error);
    return new Response(
      JSON.stringify({ error: "Error al procesar la cotización", details: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});