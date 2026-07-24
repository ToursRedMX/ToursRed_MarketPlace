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

    const { booking_id, booking_supplement_id } = await req.json();
    if (!booking_id || !booking_supplement_id) {
      return new Response(JSON.stringify({ error: "Faltan parámetros: booking_id y booking_supplement_id son requeridos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Load the supplement row with its parent tour_supplements
    const { data: supplement, error: suppError } = await serviceClient
      .from("booking_supplements")
      .select(`
        id, booking_id, tour_supplement_id, quantity, unit_price, service_charge,
        membership_exemption_used, total_paid, status, points_earned,
        tour_supplements (id, name, is_cancellable)
      `)
      .eq("id", booking_supplement_id)
      .eq("booking_id", booking_id)
      .maybeSingle();

    if (suppError || !supplement) {
      return new Response(JSON.stringify({ error: "Suplemento no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (supplement.status !== "paid") {
      return new Response(JSON.stringify({ error: "Solo se pueden cancelar suplementos pagados" }), {
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
      return new Response(JSON.stringify({ error: "No tienes permiso para cancelar este suplemento" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["confirmed", "pending"].includes(booking.status)) {
      return new Response(JSON.stringify({ error: "Solo se pueden cancelar suplementos en reservas confirmadas o pendientes" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isCancellable = (supplement as any).tour_supplements?.is_cancellable === true;
    const refundAmount = isCancellable ? Number(supplement.total_paid) : 0;
    const supplementName = (supplement as any).tour_supplements?.name || "Suplemento";
    const tourName = (booking as any).tours?.name || "Tour";

    // Refund to ToursRed Cash wallet (only total_paid, never service_charge)
    let transactionId: string | null = null;
    if (refundAmount > 0) {
      const { data: refundData, error: refundError } = await serviceClient.rpc("update_wallet_balance", {
        p_user_id: user.id,
        p_amount: refundAmount,
        p_type: "refund",
        p_description: `Reembolso por cancelación de "${supplementName}" en ${tourName}`,
        p_reference_id: supplement.id,
        p_reference_type: "supplement_cancellation",
      });

      if (refundError) {
        return new Response(JSON.stringify({ error: "Error al procesar reembolso: " + refundError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      transactionId = refundData?.transaction_id || null;
    }

    // Mark the supplement as cancelled
    const { error: updateError } = await serviceClient
      .from("booking_supplements")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: "traveler",
        refund_amount: refundAmount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", booking_supplement_id);

    if (updateError) {
      return new Response(JSON.stringify({ error: "Error al cancelar suplemento: " + updateError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const exemptionUsed = Number(supplement.membership_exemption_used) || 0;
    if (exemptionUsed > 0) {
      try {
        const { data: activeMembership } = await serviceClient
          .from("memberships")
          .select("id, service_fee_exemption_used")
          .eq("user_id", user.id)
          .neq("status", "expired")
          .gt("current_period_end", new Date().toISOString())
          .order("current_period_end", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (activeMembership) {
          const currentUsed = Number(activeMembership.service_fee_exemption_used) || 0;
          const newUsed = Math.max(0, currentUsed - exemptionUsed);
          await serviceClient
            .from("memberships")
            .update({
              service_fee_exemption_used: newUsed,
            })
            .eq("id", activeMembership.id);
        }
      } catch (exemptionErr) {
        console.error("Error revirtiendo exención de membresía (no crítico):", exemptionErr);
      }
    }

    // Deduct points (1 peso = 1 punto)
    const pointsEarned = Number(supplement.points_earned) || 0;
    if (pointsEarned > 0 && refundAmount > 0) {
      try {
        const pointsToDeduct = Math.min(Math.floor(refundAmount), pointsEarned);
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
          p_title: "Cancelación de Suplemento",
          p_message: `El viajero canceló "${supplementName}" en la reserva del tour "${tourName}".`,
          p_data: {
            booking_id,
            booking_supplement_id,
            refund_amount: refundAmount,
            is_cancellable: isCancellable,
          },
        });
      }
    } catch (notifErr) {
      console.error("Error enviando notificación (no crítico):", notifErr);
    }

    return new Response(JSON.stringify({
      success: true,
      refund_amount: refundAmount,
      is_cancellable: isCancellable,
      transaction_id: transactionId,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error en cancel-individual-supplement:", error);
    return new Response(JSON.stringify({ error: error.message || "Error al cancelar suplemento" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
