import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      throw new Error("Invalid user token");
    }

    const {
      tour_id,
      new_start_date,
      new_end_date,
      reason
    } = await req.json();

    if (!tour_id || !new_start_date || !new_end_date || !reason) {
      throw new Error("Missing required fields");
    }

    // Validar que el reason tenga al menos 20 caracteres
    if (reason.trim().length < 20) {
      throw new Error("El motivo debe tener al menos 20 caracteres");
    }

    // Obtener información del tour y verificar que pertenece a la agencia del usuario
    const { data: tour, error: tourError } = await supabase
      .from("tours")
      .select("*, agency:agencies!tours_agency_id_fkey(id, user_id, name, contact_email)")
      .eq("id", tour_id)
      .single();

    if (tourError || !tour) {
      throw new Error("Tour no encontrado");
    }

    if (tour.agency.user_id !== user.id) {
      throw new Error("No tienes permiso para reagendar este tour");
    }

    // Validar que el tour no haya iniciado ya
    const tourStartDate = new Date(tour.start_date);
    const now = new Date();

    // Normalizar ambas fechas a medianoche para comparar días completos
    const tourStartDay = new Date(tourStartDate);
    tourStartDay.setHours(0, 0, 0, 0);

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // Validar que quedan al menos 2 días completos para el inicio
    const daysUntilStart = Math.floor((tourStartDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilStart < 2) {
      throw new Error(`Deben quedar al menos 2 días completos para reagendar un tour. Quedan ${daysUntilStart} días.`);
    }

    // Validar que la nueva fecha sea al menos 4 días en el futuro
    const newStartDate = new Date(new_start_date);
    const daysUntilNewStart = (newStartDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);

    if (daysUntilNewStart < 4) {
      throw new Error("La nueva fecha debe ser al menos 4 días en el futuro");
    }

    // Verificar que no haya un reagendamiento activo para este tour
    const { data: existingReschedule } = await supabase
      .from("tour_reschedules")
      .select("id")
      .eq("tour_id", tour_id)
      .eq("status", "pending_responses")
      .maybeSingle();

    if (existingReschedule) {
      throw new Error("Ya existe un reagendamiento activo para este tour");
    }

    // Obtener todas las reservas activas del tour (confirmed o pending, que no estén canceladas)
    const { data: activeBookings, error: bookingsError } = await supabase
      .from("bookings")
      .select("*, user:users!bookings_user_id_fkey(id, first_name, last_name, email)")
      .eq("tour_id", tour_id)
      .in("status", ["confirmed", "pending"])
      .is("cancelled_at", null);

    if (bookingsError) {
      throw new Error("Error al obtener reservas");
    }

    if (!activeBookings || activeBookings.length === 0) {
      throw new Error("No hay reservas activas para este tour");
    }

    // Calcular fecha límite para respuestas (96 horas = 4 días)
    const responseDeadline = new Date();
    responseDeadline.setHours(responseDeadline.getHours() + 96);

    // Crear el registro de reagendamiento
    const { data: reschedule, error: rescheduleError } = await supabase
      .from("tour_reschedules")
      .insert({
        tour_id: tour_id,
        agency_id: tour.agency_id,
        original_start_date: tour.start_date,
        original_end_date: tour.end_date,
        new_start_date: new_start_date,
        new_end_date: new_end_date,
        reason: reason.trim(),
        created_by: user.id,
        affected_bookings_count: activeBookings.length,
        response_deadline: responseDeadline.toISOString()
      })
      .select()
      .single();

    if (rescheduleError || !reschedule) {
      throw new Error("Error al crear el reagendamiento");
    }

    // Crear respuestas pendientes para cada reserva y enviar notificaciones
    let notificationsSent = 0;
    let emailsSent = 0;

    for (const booking of activeBookings) {
      // Crear registro de respuesta
      const { error: responseError } = await supabase
        .from("booking_reschedule_responses")
        .insert({
          tour_reschedule_id: reschedule.id,
          booking_id: booking.id,
          user_id: booking.user_id,
          response: "pending"
        });

      if (responseError) {
        console.error("Error creating response record:", responseError);
        continue;
      }

      // Actualizar booking
      await supabase
        .from("bookings")
        .update({
          has_pending_reschedule: true,
          original_booking_date: booking.booking_date
        })
        .eq("id", booking.id);

      // Crear notificación in-app
      const { error: notifError } = await supabase
        .from("notifications")
        .insert({
          user_id: booking.user_id,
          type: "tour_rescheduled",
          title: "Tour Reagendado - Respuesta Requerida",
          message: `El tour "${tour.name}" ha sido reagendado. Por favor revisa y responde antes del ${responseDeadline.toLocaleDateString('es-MX')}.`,
          data: {
            booking_id: booking.id,
            tour_id: tour_id,
            tour_reschedule_id: reschedule.id,
            original_date: tour.start_date,
            new_date: new_start_date,
            deadline: responseDeadline.toISOString()
          }
        });

      if (!notifError) {
        notificationsSent++;

        // Actualizar flag de notificación enviada
        await supabase
          .from("booking_reschedule_responses")
          .update({ notification_sent: true })
          .eq("booking_id", booking.id)
          .eq("tour_reschedule_id", reschedule.id);
      }

      // Enviar email de notificación
      try {
        const { error: emailError } = await supabase.functions.invoke("send-tour-reschedule-notification", {
          body: {
            booking_id: booking.id,
            tour_reschedule_id: reschedule.id
          }
        });

        if (!emailError) {
          emailsSent++;

          // Actualizar flag de email enviado
          await supabase
            .from("booking_reschedule_responses")
            .update({ email_sent: true })
            .eq("booking_id", booking.id)
            .eq("tour_reschedule_id", reschedule.id);
        }
      } catch (emailErr) {
        console.error("Error sending email:", emailErr);
      }
    }

    // Actualizar el tour con las nuevas fechas
    await supabase
      .from("tours")
      .update({
        start_date: new_start_date,
        end_date: new_end_date
      })
      .eq("id", tour_id);

    // Enviar correo de confirmación a la agencia
    console.log("📧 Enviando correo de confirmación a la agencia...");
    try {
      // Obtener configuración de email
      const { data: emailSettings, error: emailError } = await supabase
        .from("email_settings")
        .select("*")
        .single();

      if (emailError || !emailSettings?.smtp_api_key) {
        console.error("❌ Email settings not configured:", emailError);
      } else {
        const formatDate = (dateStr: string) => {
          const date = new Date(dateStr);
          return date.toLocaleDateString('es-MX', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });
        };

        const originalDate = formatDate(tour.start_date);
        const newDate = formatDate(new_start_date);
        const deadlineDate = formatDate(responseDeadline.toISOString());
        const agencyName = tour.agency.name;
        const tourName = tour.name;

        const subject = `✅ Reagendamiento Creado - ${tourName}`;

        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reagendamiento Creado</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); padding: 40px 20px; text-align: center;">
              <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" style="width: 120px; height: auto; margin-bottom: 20px;" />
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">✅ Reagendamiento Creado</h1>
              <p style="color: #bfdbfe; margin: 10px 0 0 0; font-size: 14px;">Tour reagendado exitosamente</p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #dbeafe; border-left: 4px solid #3b82f6; padding: 20px; text-align: center;">
              <p style="margin: 0; color: #1e40af; font-weight: bold; font-size: 16px;">El tour ha sido reagendado y los viajeros han sido notificados</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hola <strong>${agencyName}</strong>,
              </p>
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
                Tu solicitud de reagendamiento para el tour <strong>${tourName}</strong> ha sido procesada exitosamente.
              </p>
              <div style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border: 2px solid #3b82f6; padding: 25px; margin: 30px 0; border-radius: 8px;">
                <h2 style="margin: 0 0 20px 0; color: #1e40af; font-size: 18px;">📅 Detalles del Reagendamiento</h2>
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Tour:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-weight: bold; font-size: 14px; text-align: right;">${tourName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Fecha Original:</td>
                    <td style="padding: 8px 0; color: #ef4444; font-weight: bold; font-size: 14px; text-align: right; text-decoration: line-through;">${originalDate}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Nueva Fecha:</td>
                    <td style="padding: 8px 0; color: #10b981; font-weight: bold; font-size: 14px; text-align: right;">${newDate}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Reservas Afectadas:</td>
                    <td style="padding: 8px 0; color: #1f2937; font-weight: bold; font-size: 14px; text-align: right;">${activeBookings.length}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Viajeros Notificados:</td>
                    <td style="padding: 8px 0; color: #3b82f6; font-weight: bold; font-size: 14px; text-align: right;">${emailsSent}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Fecha Límite Respuesta:</td>
                    <td style="padding: 8px 0; color: #f59e0b; font-weight: bold; font-size: 14px; text-align: right;">${deadlineDate}</td>
                  </tr>
                </table>
              </div>
              <div style="background-color: #fef3c7; border: 1px solid #fbbf24; padding: 20px; margin: 30px 0; border-radius: 8px;">
                <p style="margin: 0 0 10px 0; color: #92400e; font-weight: bold; font-size: 14px;">⏰ Próximos Pasos</p>
                <ul style="margin: 0; padding-left: 20px; color: #78350f; font-size: 14px; line-height: 1.8;">
                  <li>Todos los viajeros con reservas activas han sido notificados por email</li>
                  <li>Los viajeros tienen 4 días (96 horas) para responder</li>
                  <li>Si un viajero acepta, su reserva continúa con la nueva fecha</li>
                  <li>Si un viajero rechaza, su reserva se cancelará automáticamente con reembolso del 100%</li>
                  <li>Recibirás un correo cada vez que un viajero responda</li>
                </ul>
              </div>
              <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 30px 0 0 0;">
                Puedes monitorear las respuestas de los viajeros desde tu panel de agencia en ToursRed.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 12px; margin: 0 0 10px 0;">
                Este correo fue enviado por ToursRed
              </p>
              <p style="color: #6b7280; font-size: 12px; margin: 0;">
                © ${new Date().getFullYear()} ToursRed. Todos los derechos reservados.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
        `;

        const emailData = {
          personalizations: [
            {
              to: [{ email: tour.agency.contact_email, name: agencyName }],
              subject: subject,
            },
          ],
          from: {
            email: emailSettings.from_email,
            name: emailSettings.from_name || "ToursRed",
          },
          content: [
            {
              type: "text/html",
              value: htmlContent,
            },
          ],
        };

        const emailResponse = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${emailSettings.smtp_api_key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(emailData),
        });

        if (emailResponse.ok) {
          console.log("✅ Email de confirmación enviado a la agencia");
        } else {
          const errorText = await emailResponse.text();
          console.error("❌ Error enviando email a agencia:", errorText);
        }
      }
    } catch (emailErr: any) {
      console.error("❌ Error al enviar email a agencia:", emailErr);
      // No lanzamos error porque el reagendamiento ya se procesó exitosamente
    }

    return new Response(
      JSON.stringify({
        success: true,
        reschedule_id: reschedule.id,
        affected_bookings: activeBookings.length,
        notifications_sent: notificationsSent,
        emails_sent: emailsSent,
        response_deadline: responseDeadline.toISOString(),
        message: `Reagendamiento creado exitosamente. ${activeBookings.length} viajeros han sido notificados.`
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );

  } catch (error: any) {
    console.error("Error in process-tour-reschedule:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Error al procesar el reagendamiento"
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
