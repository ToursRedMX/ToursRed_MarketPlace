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

    const { booking_id, booking_optional_service_id, quantity_to_cancel } = await req.json();
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
        tax_treatment, exempt_ratio,
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

    const currentQuantity = Number(optService.quantity) || 1;

    // Validate quantity_to_cancel
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
    const serviceName = (optService as any).tour_optional_services?.name || "Servicio opcional";
    const tourName = (booking as any).tours?.name || "Tour";

    const oldSubtotal = Number(optService.subtotal) || 0;
    const oldServiceCharge = Number(optService.service_charge) || 0;
    const oldTotalPaid = Number(optService.total_paid) || 0;

    let refundAmount: number;
    let updatePayload: Record<string, any>;
    const exemptionUsedTotal = Number(optService.membership_exemption_used) || 0;

    if (isFullCancel) {
      refundAmount = isRefundable ? oldSubtotal : 0;
      updatePayload = {
        is_cancelled: true,
        cancelled_at: new Date().toISOString(),
        cancelled_by_agency: false,
        refund_amount: refundAmount,
        updated_at: new Date().toISOString(),
      };
    } else {
      const effectiveQty = qtyToCancel!;
      const unitSubtotal = currentQuantity > 0 ? oldSubtotal / currentQuantity : 0;
      const unitServiceCharge = currentQuantity > 0 ? oldServiceCharge / currentQuantity : 0;
      const unitTotalPaid = currentQuantity > 0 ? oldTotalPaid / currentQuantity : 0;
      const newQuantity = currentQuantity - effectiveQty;

      refundAmount = isRefundable ? Math.round(unitSubtotal * effectiveQty * 100) / 100 : 0;
      const newSubtotal = Math.round(unitSubtotal * newQuantity * 100) / 100;
      const newServiceCharge = Math.round(unitServiceCharge * newQuantity * 100) / 100;
      const newTotalPaid = Math.round(unitTotalPaid * newQuantity * 100) / 100;
      const willBeZero = newQuantity === 0;

      updatePayload = {
        quantity: newQuantity,
        subtotal: newSubtotal,
        service_charge: newServiceCharge,
        total_paid: newTotalPaid,
        refund_amount: refundAmount,
        ...(willBeZero ? {
          is_cancelled: true,
          cancelled_at: new Date().toISOString(),
          cancelled_by_agency: false,
        } : {}),
        updated_at: new Date().toISOString(),
      };
    }

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
        p_idempotency_key: `${optService.id}_${crypto.randomUUID()}_refund`,
      });

      if (refundError) {
        return new Response(JSON.stringify({ error: "Error al procesar reembolso: " + refundError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      transactionId = refundData?.transaction_id || null;
    }

    // Update the optional service row
    const { error: updateError } = await serviceClient
      .from("booking_optional_services")
      .update(updatePayload)
      .eq("id", booking_optional_service_id);

    if (updateError) {
      return new Response(JSON.stringify({ error: "Error al cancelar servicio: " + updateError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Revert membership exemption proportionally
    if (exemptionUsedTotal > 0) {
      try {
        const exemptionToRevert = isFullCancel
          ? exemptionUsedTotal
          : Math.round(exemptionUsedTotal * (qtyToCancel! / currentQuantity) * 100) / 100;
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
              .update({
                service_fee_exemption_used: newUsed,
              })
              .eq("id", activeMembership.id);
          }
        }
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

    // CFDI handling — cancel CFDI (motivo 03) for total with own CFDI, credit note for partial/bundled
    if (refundAmount > 0) {
      try {
        // Check if this optional service has its own CFDI (generated via generate-optional-service-cfdi)
        const { data: ownCfdi } = await serviceClient
          .from("cfdi_invoices")
          .select("id, uuid_fiscal, status")
          .eq("booking_optional_service_id", booking_optional_service_id)
          .eq("status", "stamped")
          .maybeSingle();

        if (ownCfdi && ownCfdi.uuid_fiscal) {
          if (isFullCancel) {
            // Total cancellation of an optional with its own CFDI: cancel with motivo "03"
            EdgeRuntime.waitUntil(
              (async () => {
                try {
                  await serviceClient.functions.invoke("cancel-cfdi", {
                    body: { cfdi_invoice_id: ownCfdi.id, motivo: "03" },
                  });
                } catch (cancelErr) {
                  console.error("Error cancelling optional service CFDI (no crítico):", cancelErr);
                }
              })()
            );
          } else {
            // Partial cancellation: generate credit note (tipo E, tipo_relacion "01")
            const agency = (booking as any).agencies;
            const terceroAgencia = agency?.rfc && agency?.codigo_postal_fiscal
              ? {
                  rfc: agency.rfc,
                  nombre: agency.razon_social || serviceName,
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
                  item_description: `Servicio opcional: ${serviceName} — ${tourName}`,
                  related_cfdi_invoice_id: ownCfdi.id,
                  related_cfdi_uuid: ownCfdi.uuid_fiscal,
                  item_type: "optional_service",
                  tercero_agencia: terceroAgencia,
                  // Snapshot fiscal del cobro original: el reembolso conserva
                  // proporcionalmente la composicion de lo cobrado. Un opcional
                  // exento (p.ej. entrada a Six Flags) no puede generar una nota
                  // de credito con IVA trasladado que nunca se cobro.
                  tax_treatment: (optService as { tax_treatment?: string }).tax_treatment ?? null,
                  exempt_ratio: (optService as { exempt_ratio?: number }).exempt_ratio ?? null,
                },
              }).catch((err: any) => console.error("Credit note generation failed (no crítico):", err))
            );
          }
        } else {
          // No own CFDI — it's bundled in the booking deposit CFDI. Generate credit note referencing that.
          const { data: depositCfdi } = await serviceClient
            .from("cfdi_invoices")
            .select("id, uuid_fiscal, status")
            .eq("booking_id", booking_id)
            .eq("invoice_type", "booking")
            .eq("status", "stamped")
            .maybeSingle();

          if (depositCfdi && depositCfdi.uuid_fiscal) {
            const agency = (booking as any).agencies;
            const terceroAgencia = agency?.rfc && agency?.codigo_postal_fiscal
              ? {
                  rfc: agency.rfc,
                  nombre: agency.razon_social || serviceName,
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
                  item_description: `Servicio opcional: ${serviceName} — ${tourName}`,
                  related_cfdi_invoice_id: depositCfdi.id,
                  related_cfdi_uuid: depositCfdi.uuid_fiscal,
                  item_type: "optional_service",
                  tercero_agencia: terceroAgencia,
                  // Snapshot fiscal del cobro original: el reembolso conserva
                  // proporcionalmente la composicion de lo cobrado. Un opcional
                  // exento (p.ej. entrada a Six Flags) no puede generar una nota
                  // de credito con IVA trasladado que nunca se cobro.
                  tax_treatment: (optService as { tax_treatment?: string }).tax_treatment ?? null,
                  exempt_ratio: (optService as { exempt_ratio?: number }).exempt_ratio ?? null,
                },
              }).catch((err: any) => console.error("Credit note generation failed (no crítico):", err))
            );
          }
        }
      } catch (cfdiErr) {
        console.error("Error in CFDI handling for optional service cancellation (no crítico):", cfdiErr);
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
    if (sentryDsn) {
      Sentry.captureException(error, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return new Response(JSON.stringify({ error: error.message || "Error al cancelar servicio opcional" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
