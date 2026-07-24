import { createClient } from "npm:@supabase/supabase-js@2.108.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Falta el header de autorización" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "No autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { booking_id, booking_optional_service_id } = await req.json();
    if (!booking_id || !booking_optional_service_id) {
      return new Response(JSON.stringify({ error: "Faltan parámetros: booking_id y booking_optional_service_id son requeridos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Load the optional service row with its parent tour_optional_services
    const { data: optService, error: optError } = await serviceClient
      .from("booking_optional_services")
      .select(`
        id, booking_id, tour_optional_service_id, quantity, unit_price, subtotal,
        service_charge, total_paid, membership_exemption_used, is_cancelled, service_kind,
        tour_optional_services (id, name, is_refundable)
      `)
      .eq("id", booking_optional_service_id)
      .eq("booking_id", booking_id)
      .maybeSingle();

    if (optError || !optService) {
      return new Response(JSON.stringify({ error: "Servicio opcional no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (optService.is_cancelled) {
      return new Response(JSON.stringify({ error: "Este servicio ya fue cancelado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify booking ownership
    const { data: booking, error: bookingError } = await serviceClient
      .from("bookings")
      .select("id, user_id, status, tours (name), agencies (id, user_id)")
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      return new Response(JSON.stringify({ error: "Reserva no encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (booking.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "No tienes permiso para cancelar este servicio" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["confirmed", "pending"].includes(booking.status)) {
      return new Response(JSON.stringify({ error: "Solo se pueden cancelar servicios en reservas confirmadas o pendientes" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isRefundable = (optService as any).tour_optional_services?.is_refundable === true;
    const refundAmount = isRefundable ? Number(optService.subtotal) : 0;
    const serviceName = (optService as any).tour_optional_services?.name || "Servicio opcional";
    const tourName = (booking as any).tours?.name || "Tour";

    // Refund to ToursRed Cash wallet (only subtotal, never service_charge)
    let transactionId: string | null = null;
    if (refundAmount > 0) {
      const { data: refundData, error: refundError } = await serviceClient.rpc("update_wallet_balance", {
        p_user_id: user.id,
        p_amount: refundAmount,
        p_type: "refund",
        p_description: `Reembolso por cancelación de "${serviceName}" en ${tourName}`,
        p_reference_id: optService.id,
        p_reference_type: "optional_service_cancellation",
      });

      if (refundError) {
        return new Response(JSON.stringify({ error: "Error al procesar reembolso: " + refundError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      transactionId = refundData?.transaction_id || null;
    }

    // Mark the optional service as cancelled
    const { error: updateError } = await serviceClient
      .from("booking_optional_services")
      .update({
        is_cancelled: true,
        cancelled_at: new Date().toISOString(),
        cancelled_by_agency: false,
        refund_amount: refundAmount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", booking_optional_service_id);

    if (updateError) {
      return new Response(JSON.stringify({ error: "Error al cancelar servicio: " + updateError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Revert membership_exemption_used so it's available again for future bookings
    const exemptionUsed = Number(optService.membership_exemption_used) || 0;
    if (exemptionUsed > 0) {
      try {
        await serviceClient.rpc("revert_membership_exemption", {
          p_user_id: user.id,
          p_amount: exemptionUsed,
          p_period: "monthly",
        });
      } catch (exemptionErr) {
        console.error("Error revirtiendo exención de membresía (no crítico):", exemptionErr);
      }
    }

    // Deduct points (1 peso = 1 punto)
    if (refundAmount > 0) {
      try {
        const pointsToDeduct = Math.floor(refundAmount);
        if (pointsToDeduct > 0) {
          await serviceClient.rpc("deduct_points_for_booking", {
            p_booking_id: booking_id,
            p_user_id: user.id,
            p_points_to_deduct: pointsToDeduct,
          });
        }
      } catch (pointsErr) {
        console.error("Error descontando puntos (no crítico):", pointsErr);
      }
    }

    // Notify the agency in-app
    try {
      const agencyUserId = (booking as any).agencies?.user_id;
      if (agencyUserId) {
        await serviceClient.rpc("create_user_notification", {
          p_user_id: agencyUserId,
          p_type: "booking_cancelled",
          p_title: "Cancelación de Servicio Opcional",
          p_message: `El viajero canceló "${serviceName}" en la reserva del tour "${tourName}".`,
          p_data: {
            booking_id,
            booking_optional_service_id,
            refund_amount: refundAmount,
            is_refundable: isRefundable,
          },
        });
      }
    } catch (notifErr) {
      console.error("Error enviando notificación (no crítico):", notifErr);
    }

    return new Response(JSON.stringify({
      success: true,
      refund_amount: refundAmount,
      is_refundable: isRefundable,
      transaction_id: transactionId,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error en cancel-optional-service:", error);
    return new Response(JSON.stringify({ error: error.message || "Error al cancelar servicio opcional" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
