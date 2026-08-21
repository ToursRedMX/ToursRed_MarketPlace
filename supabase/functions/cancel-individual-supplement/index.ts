import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import * as Sentry from "npm:@sentry/deno@9";

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
    tracesSampleRate: 0.1,
  });
}

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

    const { booking_id, booking_supplement_id, quantity_to_cancel } = await req.json();
    if (!booking_id || !booking_supplement_id) {
      return new Response(JSON.stringify({ error: "Faltan parámetros: booking_id y booking_supplement_id son requeridos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: supplement, error: suppError } = await serviceClient
      .from("booking_supplements")
      .select(`
        id, booking_id, tour_supplement_id, quantity, unit_price, service_charge,
        membership_exemption_used, total_paid, status, points_earned, cfdi_invoice_id,
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

    const currentQuantity = Number(supplement.quantity) || 1;

    let qtyToCancel: number | null = null;
    if (quantity_to_cancel !== undefined && quantity_to_cancel !== null) {
      qtyToCancel = Number(quantity_to_cancel);
      if (!Number.isInteger(qtyToCancel) || qtyToCancel <= 0) {
        return new Response(JSON.stringify({ error: "quantity_to_cancel debe ser un entero positivo" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (qtyToCancel > currentQuantity) {
        return new Response(JSON.stringify({ error: "quantity_to_cancel no puede exceder la cantidad actual" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const isFullCancel = qtyToCancel === null || qtyToCancel === currentQuantity;

    const { data: booking, error: bookingError } = await serviceClient
      .from("bookings")
      .select("id, user_id, status, tours (name), agencies (id, user_id, rfc, razon_social, regimen_fiscal, codigo_postal_fiscal)")
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
    const supplementName = (supplement as any).tour_supplements?.name || "Suplemento";
    const tourName = (booking as any).tours?.name || "Tour";

    const oldTotalPaid = Number(supplement.total_paid) || 0;
    const oldServiceCharge = Number(supplement.service_charge) || 0;
    const unitPrice = Number(supplement.unit_price) || 0;

    let refundAmount: number;
    let updatePayload: Record<string, any>;
    const exemptionUsedTotal = Number(supplement.membership_exemption_used) || 0;

    if (isFullCancel) {
      refundAmount = isCancellable ? oldTotalPaid : 0;
      updatePayload = {
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: "traveler",
        refund_amount: refundAmount,
        updated_at: new Date().toISOString(),
      };
    } else {
      const effectiveQty = qtyToCancel!;
      const unitTotalPaid = currentQuantity > 0 ? oldTotalPaid / currentQuantity : 0;
      const unitServiceCharge = currentQuantity > 0 ? oldServiceCharge / currentQuantity : 0;
      const newQuantity = currentQuantity - effectiveQty;

      refundAmount = isCancellable ? Math.round(unitTotalPaid * effectiveQty * 100) / 100 : 0;
      const newTotalPaid = Math.round(unitTotalPaid * newQuantity * 100) / 100;
      const newServiceCharge = Math.round(unitServiceCharge * newQuantity * 100) / 100;
      const willBeZero = newQuantity === 0;

      updatePayload = {
        quantity: newQuantity,
        total_paid: newTotalPaid,
        service_charge: newServiceCharge,
        refund_amount: refundAmount,
        ...(willBeZero ? {
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancelled_by: "traveler",
        } : {}),
        updated_at: new Date().toISOString(),
      };
    }

    let transactionId: string | null = null;
    if (refundAmount > 0) {
      const { data: refundData, error: refundError } = await serviceClient.rpc("update_wallet_balance", {
        p_user_id: user.id,
        p_amount: refundAmount,
        p_type: "refund",
        p_description: `Reembolso por cancelación de "${supplementName}" en ${tourName}`,
        p_reference_id: supplement.id,
        p_reference_type: "supplement_cancellation",
        p_idempotency_key: `${supplement.id}_${crypto.randomUUID()}_refund`,
      });

      if (refundError) {
        return new Response(JSON.stringify({ error: "Error al procesar reembolso: " + refundError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      transactionId = refundData?.transaction_id || null;
    }

    const { error: updateError } = await serviceClient
      .from("booking_supplements")
      .update(updatePayload)
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
        const exemptionToRevert = isFullCancel
          ? exemptionUsed
          : Math.round(exemptionUsed * (qtyToCancel! / currentQuantity) * 100) / 100;
        if (exemptionToRevert > 0) {
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
            const newUsed = Math.max(0, currentUsed - exemptionToRevert);
            await serviceClient
              .from("memberships")
              .update({ service_fee_exemption_used: newUsed })
              .eq("id", activeMembership.id);
          }
        }
      } catch (exemptionErr) {
        console.error("Error revirtiendo exención de membresía (no crítico):", exemptionErr);
      }
    }

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

    // CFDI handling: cancel CFDI (motivo 03) for total, credit note for partial
    const cfdiInvoiceId = supplement.cfdi_invoice_id as string | null;
    if (cfdiInvoiceId && refundAmount > 0) {
      try {
        const { data: cfdiRow } = await serviceClient
          .from("cfdi_invoices")
          .select("id, uuid_fiscal, status")
          .eq("id", cfdiInvoiceId)
          .maybeSingle();

        if (cfdiRow && cfdiRow.status === "stamped" && cfdiRow.uuid_fiscal) {
          if (isFullCancel) {
            // Total cancellation: cancel CFDI with motivo "03"
            EdgeRuntime.waitUntil(
              (async () => {
                try {
                  await serviceClient.functions.invoke("cancel-cfdi", {
                    body: { cfdi_invoice_id: cfdiInvoiceId, motivo: "03" },
                  });
                } catch (cancelErr) {
                  console.error("Error cancelling supplement CFDI (no crítico):", cancelErr);
                }
              })()
            );
          } else {
            // Partial cancellation: generate credit note (tipo E, tipo_relacion "01")
            const agency = (booking as any).agencies;
            const terceroAgencia = agency?.rfc && agency?.codigo_postal_fiscal
              ? {
                  rfc: agency.rfc,
                  nombre: agency.razon_social || supplementName,
                  regimen_fiscal: agency.regimen_fiscal || "601",
                  domicilio_fiscal: agency.codigo_postal_fiscal,
                }
              : null;

            EdgeRuntime.waitUntil(
              serviceClient.functions.invoke("generate-credit-note-for-item-cancellation", {
                body: {
                  booking_id,
                  user_id: user.id,
                  refund_amount: refundAmount,
                  item_description: `Suplemento: ${supplementName} — ${tourName}`,
                  related_cfdi_invoice_id: cfdiInvoiceId,
                  related_cfdi_uuid: cfdiRow.uuid_fiscal,
                  item_type: "supplement",
                  tercero_agencia: terceroAgencia,
                },
              }).catch((err: any) => console.error("Credit note generation failed (no crítico):", err))
            );
          }
        }
      } catch (cfdiLookupErr) {
        console.error("Error looking up supplement CFDI (no crítico):", cfdiLookupErr);
      }
    }

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
    if (sentryDsn) {
      Sentry.captureException(error, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return new Response(JSON.stringify({ error: error.message || "Error al cancelar suplemento" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
