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

  console.log("============================================");
  console.log("FUNCIÓN RESPOND-TO-RESCHEDULE INICIADA");
  console.log("============================================");

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

    const { booking_id, response } = await req.json();

    console.log("📥 Request recibida:");
    console.log("- Booking ID:", booking_id);
    console.log("- Response:", response);
    console.log("- User ID:", user.id);

    if (!booking_id || !response) {
      throw new Error("Missing required fields");
    }

    if (!["accepted", "rejected"].includes(response)) {
      throw new Error("Invalid response value");
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        *,
        booking_code,
        user:users!bookings_user_id_fkey(first_name, last_name, email),
        tour:tours!bookings_tour_id_fkey(name, destination, start_date, end_date),
        agency:agencies!bookings_agency_id_fkey(name, contact_email, contact_phone, user_id)
      `)
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking) {
      console.error("Booking error:", bookingError);
      throw new Error("Booking not found");
    }

    console.log("✅ Booking encontrado:", booking.booking_code);
    console.log("✅ Agencia:", booking.agency.name);
    console.log("✅ Email agencia:", booking.agency.contact_email || "NO TIENE EMAIL");

    if (booking.user_id !== user.id) {
      throw new Error("No tienes permiso para responder a esta reserva");
    }

    if (!booking.has_pending_reschedule) {
      throw new Error("Esta reserva no tiene un reagendamiento pendiente");
    }

    const { data: rescheduleResponse, error: responseError } = await supabase
      .from("booking_reschedule_responses")
      .select(`
        *,
        reschedule:tour_reschedules!booking_reschedule_responses_tour_reschedule_id_fkey(*)
      `)
      .eq("booking_id", booking_id)
      .eq("response", "pending")
      .single();

    if (responseError || !rescheduleResponse) {
      throw new Error("No se encontró el reagendamiento pendiente");
    }

    const deadline = new Date(rescheduleResponse.reschedule.response_deadline);
    if (deadline < new Date()) {
      throw new Error("La fecha límite para responder ha expirado");
    }

    if (rescheduleResponse.response !== "pending") {
      throw new Error("Ya has respondido a este reagendamiento");
    }

    const now = new Date().toISOString();

    if (response === "accepted") {
      console.log("💚 PROCESANDO ACEPTACIÓN...");

      await supabase
        .from("booking_reschedule_responses")
        .update({
          response: "accepted",
          responded_at: now
        })
        .eq("id", rescheduleResponse.id);

      await supabase
        .from("bookings")
        .update({
          has_pending_reschedule: false,
          reschedule_response: "accepted",
          reschedule_responded_at: now,
          booking_date: rescheduleResponse.reschedule.new_start_date
        })
        .eq("id", booking_id);

      await supabase
        .from("notifications")
        .insert([
          {
            user_id: user.id,
            type: "booking_confirmed",
            title: "Reagendamiento Aceptado",
            message: `Has aceptado la nueva fecha para el tour "${booking.tour.name}". Tu reserva ha sido actualizada.`,
            data: {
              booking_id: booking_id,
              tour_id: booking.tour_id,
              new_date: rescheduleResponse.reschedule.new_start_date
            }
          },
          {
            user_id: booking.agency.user_id,
            type: "booking_confirmed",
            title: "Reagendamiento Aceptado",
            message: `${booking.user.first_name} ${booking.user.last_name} aceptó el reagendamiento del tour "${booking.tour.name}". La reserva continúa con la nueva fecha.`,
            data: {
              booking_id: booking_id,
              tour_id: booking.tour_id,
              new_date: rescheduleResponse.reschedule.new_start_date
            }
          }
        ]);

      console.log("\n🔥🔥🔥 ENVIANDO CORREOS 🔥🔥🔥\n");

      const apiUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      console.log("[1/2] 📧 Enviando email al VIAJERO...");
      try {
        const travelerResponse = await fetch(`${apiUrl}/functions/v1/send-reschedule-response-confirmation`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            booking_id: booking_id,
            response: "accepted"
          })
        });

        const travelerResult = await travelerResponse.text();
        console.log("Respuesta viajero:", travelerResult);

        if (!travelerResponse.ok) {
          console.error("❌ ERROR al enviar email al viajero:", travelerResponse.status, travelerResult);
        } else {
          console.log("✅ Email al viajero enviado");
        }
      } catch (err) {
        console.error("❌ EXCEPCIÓN email viajero:", err);
      }

      console.log("\n[2/2] 📧 Enviando email a la AGENCIA...");
      console.log("Email destino:", booking.agency.contact_email);

      if (!booking.agency.contact_email) {
        console.error("❌❌❌ LA AGENCIA NO TIENE EMAIL CONFIGURADO ❌❌❌");
      } else {
        try {
          const agencyResponse = await fetch(`${apiUrl}/functions/v1/send-reschedule-response-agency`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              booking_id: booking_id,
              response: "accepted"
            })
          });

          const agencyResult = await agencyResponse.text();
          console.log("Respuesta agencia:", agencyResult);

          if (!agencyResponse.ok) {
            console.error("❌ ERROR al enviar email a agencia:", agencyResponse.status, agencyResult);
          } else {
            console.log("✅✅✅ EMAIL A LA AGENCIA ENVIADO ✅✅✅");
          }
        } catch (err) {
          console.error("❌ EXCEPCIÓN email agencia:", err);
        }
      }

      console.log("\n🔥🔥🔥 PROCESO COMPLETADO 🔥🔥🔥\n");

      return new Response(
        JSON.stringify({
          success: true,
          response: "accepted",
          message: "Has aceptado la nueva fecha. Tu reserva ha sido actualizada exitosamente.",
          new_booking_date: rescheduleResponse.reschedule.new_start_date
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );

    } else if (response === "rejected") {
      console.log("🔴 PROCESANDO RECHAZO...");

      const refundAmount = Number(booking.deposit_amount);
      const toursredCashUsed = Number(booking.toursred_cash_used || 0);
      const totalRefund = refundAmount + toursredCashUsed;

      const { data: walletUpdate, error: walletError } = await supabase.rpc(
        "update_wallet_balance",
        {
          p_user_id: user.id,
          p_amount: totalRefund,
          p_type: "refund",
          p_description: `Reembolso por reagendamiento rechazado - ${booking.tour.name}`,
          p_reference_id: booking_id,
          p_reference_type: "reschedule_rejection"
        }
      );

      if (walletError) {
        throw new Error("Error al procesar el reembolso");
      }

      const transactionId = walletUpdate;

      await supabase
        .from("booking_reschedule_responses")
        .update({
          response: "rejected",
          responded_at: now,
          refund_processed: true,
          refund_transaction_id: transactionId
        })
        .eq("id", rescheduleResponse.id);

      await supabase
        .from("bookings")
        .update({
          status: "cancelled",
          has_pending_reschedule: false,
          reschedule_response: "rejected",
          reschedule_responded_at: now,
          cancelled_at: now,
          cancellation_type: "reschedule_rejection",
          cancellation_refund_amount: totalRefund
        })
        .eq("id", booking_id);

      await supabase
        .from("commission_records")
        .update({
          status: "disputed",
          agency_net_amount: 0,
          platform_total_revenue: 0
        })
        .eq("booking_id", booking_id);

      await supabase
        .from("notifications")
        .insert([
          {
            user_id: user.id,
            type: "booking_cancelled",
            title: "Reembolso Procesado",
            message: `Has rechazado el reagendamiento del tour "${booking.tour.name}". Se ha procesado tu reembolso de $${totalRefund.toFixed(2)} MXN a tu monedero ToursRed Cash.`,
            data: {
              booking_id: booking_id,
              tour_id: booking.tour_id,
              refund_amount: totalRefund,
              transaction_id: transactionId
            }
          },
          {
            user_id: booking.agency.user_id,
            type: "booking_cancelled",
            title: "Reagendamiento Rechazado",
            message: `${booking.user.first_name} ${booking.user.last_name} rechazó el reagendamiento del tour "${booking.tour.name}". La reserva fue cancelada y se procesó el reembolso completo.`,
            data: {
              booking_id: booking_id,
              tour_id: booking.tour_id,
              refund_amount: totalRefund
            }
          }
        ]);

      console.log("\n🔥🔥🔥 ENVIANDO CORREOS 🔥🔥🔥\n");

      const apiUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      console.log("[1/2] 📧 Enviando email al VIAJERO...");
      try {
        const travelerResponse = await fetch(`${apiUrl}/functions/v1/send-reschedule-response-confirmation`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            booking_id: booking_id,
            response: "rejected"
          })
        });

        const travelerResult = await travelerResponse.text();
        console.log("Respuesta viajero:", travelerResult);

        if (!travelerResponse.ok) {
          console.error("❌ ERROR al enviar email al viajero:", travelerResponse.status, travelerResult);
        } else {
          console.log("✅ Email al viajero enviado");
        }
      } catch (err) {
        console.error("❌ EXCEPCIÓN email viajero:", err);
      }

      console.log("\n[2/2] 📧 Enviando email a la AGENCIA...");
      console.log("Email destino:", booking.agency.contact_email);

      if (!booking.agency.contact_email) {
        console.error("❌❌❌ LA AGENCIA NO TIENE EMAIL CONFIGURADO ❌❌❌");
      } else {
        try {
          const agencyResponse = await fetch(`${apiUrl}/functions/v1/send-reschedule-response-agency`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              booking_id: booking_id,
              response: "rejected"
            })
          });

          const agencyResult = await agencyResponse.text();
          console.log("Respuesta agencia:", agencyResult);

          if (!agencyResponse.ok) {
            console.error("❌ ERROR al enviar email a agencia:", agencyResponse.status, agencyResult);
          } else {
            console.log("✅✅✅ EMAIL A LA AGENCIA ENVIADO ✅✅✅");
          }
        } catch (err) {
          console.error("❌ EXCEPCIÓN email agencia:", err);
        }
      }

      console.log("\n🔥🔥🔥 PROCESO COMPLETADO 🔥🔥🔥\n");

      return new Response(
        JSON.stringify({
          success: true,
          response: "rejected",
          message: "Has rechazado el reagendamiento. Tu reembolso ha sido procesado exitosamente.",
          refund_amount: totalRefund,
          transaction_id: transactionId
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

  } catch (error: any) {
    console.error("❌❌❌ ERROR GENERAL:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Error al procesar la respuesta"
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
