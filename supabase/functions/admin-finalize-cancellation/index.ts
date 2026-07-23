import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { markPointsAsClawedBack } from "../_shared/pointsTraceability.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const err = (msg: string, status = 400) =>
    new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const ok = (data: Record<string, unknown>) =>
    new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    // Verify admin via JWT
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return err("No autorizado", 401);

    const { data: adminUser } = await supabase
      .from("users")
      .select("role, email")
      .eq("id", user.id)
      .maybeSingle();

    if (!adminUser || !["super_admin", "admin"].includes(adminUser.role)) {
      return err("Permisos insuficientes", 403);
    }

    const {
      booking_id,
      cancellation_id,
      admin_cancellation_id,
    } = await req.json();

    if (!booking_id) return err("booking_id es requerido");
    if (!cancellation_id) return err("cancellation_id es requerido");
    if (!admin_cancellation_id) return err("admin_cancellation_id es requerido");

    // Service-role client for mutations
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // ============================================================
    // Guard 1: Check current booking status
    // ============================================================
    const { data: booking, error: bookingErr } = await serviceClient
      .from("bookings")
      .select("id, status, user_id, tour_id, agency_id, points_used, points_earned, toursred_cash_used")
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingErr || !booking) return err("Reserva no encontrada", 404);

    if (booking.status === "cancelled") {
      return err("Esta cancelación ya fue finalizada anteriormente.");
    }
    if (booking.status !== "cancellation_processing") {
      return err(`Estado de reserva inesperado: '${booking.status}'. Se esperaba 'cancellation_processing'.`);
    }

    // ============================================================
    // Guard 2: Verify ALL payment transactions have refunds initiated
    // ============================================================
    const { data: transactions } = await serviceClient
      .from("payment_transactions")
      .select("id, amount, charge_context, charge_reference_id")
      .eq("booking_id", booking_id)
      .eq("status", "succeeded");

    if (!transactions || transactions.length === 0) {
      return err("No se encontraron transacciones de pago para esta reserva.");
    }

    // Check each transaction has a refund in 'processing' or 'succeeded'
    const txIds = transactions.map((t) => t.id);
    const { data: refunds } = await serviceClient
      .from("payment_refunds")
      .select("payment_transaction_id, status, requested_amount")
      .in("payment_transaction_id", txIds)
      .in("status", ["processing", "succeeded"]);

    const refundedTxIds = new Set((refunds || []).map((r) => r.payment_transaction_id));
    const missingTxIds = txIds.filter((id) => !refundedTxIds.has(id));

    if (missingTxIds.length > 0) {
      const missingLines = transactions
        .filter((t) => missingTxIds.includes(t.id))
        .map((t) => `${t.charge_context || "booking_deposit"} ($${t.amount})`);
      return err(`Faltan reembolsos por iniciar en las siguientes líneas: ${missingLines.join(", ")}. La reserva permanece en 'cancellation_processing'.`);
    }

    // Also check for any failed refunds
    const { data: failedRefunds } = await serviceClient
      .from("payment_refunds")
      .select("payment_transaction_id, status, failure_reason")
      .in("payment_transaction_id", txIds)
      .eq("status", "failed");

    if (failedRefunds && failedRefunds.length > 0) {
      const failedTxIds = new Set(failedRefunds.map((r) => r.payment_transaction_id));
      const failedLines = transactions
        .filter((t) => failedTxIds.has(t.id))
        .map((t) => `${t.charge_context || "booking_deposit"} ($${t.amount})`);
      return err(`Las siguientes líneas tienen reembolsos fallidos: ${failedLines.join(", ")}. Reintenta o usa reembolso manual para esas líneas.`);
    }

    // ============================================================
    // Step 1: Clawback earned points — 1 peso reembolsado = 1 punto.
    // Sum all refund amounts (processing or succeeded) and deduct
    // Math.floor(total) points. This matches process-traveler-cancellation.
    // ============================================================
    const totalRefundAmount = (refunds || []).reduce(
      (sum, r) => sum + Number(r.requested_amount || 0),
      0
    );
    const pointsToDeduct = Math.floor(totalRefundAmount);
    let pointsDeducted = 0;
    if (pointsToDeduct > 0) {
      try {
        const { error: pointsError } = await serviceClient.rpc("deduct_points", {
          p_user_id: booking.user_id,
          p_amount: pointsToDeduct,
          p_description: `Puntos revertidos por cancelación administrativa (reserva ${booking_id.slice(0, 8)})`,
          p_reference_id: booking_id,
          p_reference_type: "booking_cancellation",
        });

        if (!pointsError) {
          pointsDeducted = pointsToDeduct;
        } else {
          console.error("Error deducting points in finalize:", pointsError);
        }
      } catch (e) {
        console.error("Exception deducting points:", e);
      }
    }

    // Mark points as clawed back (audit traceability)
    if (pointsDeducted > 0) {
      await markPointsAsClawedBack(serviceClient, booking_id, cancellation_id, "administrativa");
    }

    // ============================================================
    // Step 2: Cancel optional services
    // ============================================================
    try {
      await serviceClient.rpc("cancel_booking_optional_services", {
        p_booking_id: booking_id,
        p_cancelled_by_agency: false,
      });
    } catch (e) {
      console.error("Error cancelling optional services in finalize:", e);
    }

    // ============================================================
    // Step 3: Cancel paid supplements
    // ============================================================
    try {
      const { data: paidSupplements } = await serviceClient
        .from("booking_supplements")
        .select("id, tour_supplements(is_cancellable)")
        .eq("booking_id", booking_id)
        .eq("status", "paid");

      for (const supp of (paidSupplements || [])) {
        if ((supp as any).tour_supplements?.is_cancellable !== false) {
          await serviceClient.from("booking_supplements")
            .update({
              status: "cancelled",
              cancelled_at: new Date().toISOString(),
              cancelled_by: "tour_cancellation",
              refund_amount: (supp as any).total_paid || 0,
              updated_at: new Date().toISOString(),
            })
            .eq("id", supp.id);
        }
      }
    } catch (e) {
      console.error("Error cancelling supplements in finalize:", e);
    }

    // ============================================================
    // Step 4: Update booking status to 'cancelled'
    // ============================================================
    const now = new Date().toISOString();
    const { error: updateErr } = await serviceClient
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_at: now,
      })
      .eq("id", booking_id)
      .eq("status", "cancellation_processing");

    if (updateErr) {
      console.error("Error updating booking to cancelled:", updateErr);
      return err("Error al finalizar la cancelación", 500);
    }

    // ============================================================
    // Step 5: Mark booking_cancellations.refund_processed = true
    // ============================================================
    await serviceClient
      .from("booking_cancellations")
      .update({ refund_processed: true })
      .eq("id", cancellation_id);

    // ============================================================
    // Step 6: Audit log
    // ============================================================
    try {
      await serviceClient.rpc("insert_audit_log", {
        p_tenant_type: "admin",
        p_actor_id: user.id,
        p_actor_email: adminUser.email ?? null,
        p_actor_role: adminUser.role,
        p_target_id: booking_id,
        p_target_table: "bookings",
        p_action: "admin_cancel_finalize",
        p_severity: "high",
        p_old_values: { status: "cancellation_processing" },
        p_new_values: { status: "cancelled", cancellation_type: "admin_cancelled" },
        p_metadata: { admin_cancellation_id, cancellation_id, points_deducted: pointsDeducted },
      });
    } catch (e) {
      console.error("Error audit log (finalize):", e);
    }

    // ============================================================
    // Step 7: Send full notifications (traveler, agency, admin)
    // ============================================================
    const { data: cancellationRecord } = await serviceClient
      .from("booking_cancellations")
      .select("reason_for_traveler, reason_for_agency, refund_amount")
      .eq("id", cancellation_id)
      .maybeSingle();

    const { data: adminCancellation } = await serviceClient
      .from("admin_booking_cancellations")
      .select("refund_method")
      .eq("id", admin_cancellation_id)
      .maybeSingle();

    const { data: agencyData } = await serviceClient
      .from("agencies")
      .select("contact_email")
      .eq("id", booking.agency_id)
      .maybeSingle();

    const notificationPromises: Promise<void>[] = [];

    // 1. Notify traveler
    notificationPromises.push(
      fetch(`${supabaseUrl}/functions/v1/send-cancellation-notification-traveler`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          booking_id,
          cancellation_id,
          admin_cancellation: true,
          admin_reason: cancellationRecord?.reason_for_traveler || "",
          refund_amount: cancellationRecord?.refund_amount || 0,
          refund_method: adminCancellation?.refund_method || "original_payment_method",
          receipt_url: null,
          receipt_file_path: null,
        }),
      }).then(() => {}).catch((e) => console.error("Error notifying traveler (finalize):", e))
    );

    // 2. Notify agency
    if (agencyData?.contact_email) {
      notificationPromises.push(
        fetch(`${supabaseUrl}/functions/v1/send-cancellation-notification-agency`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            booking_id,
            cancellation_id,
            admin_cancellation: true,
            admin_reason: cancellationRecord?.reason_for_agency || "",
          }),
        }).then(() => {}).catch((e) => console.error("Error notifying agency (finalize):", e))
      );
    }

    // 3. Notify admin
    notificationPromises.push(
      fetch(`${supabaseUrl}/functions/v1/send-cancellation-notification-admin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          booking_id,
          cancellation_id,
          admin_cancellation: true,
          admin_reason_for_traveler: cancellationRecord?.reason_for_traveler || "",
          admin_reason_for_agency: cancellationRecord?.reason_for_agency || "",
          refund_amount: cancellationRecord?.refund_amount || 0,
          refund_method: adminCancellation?.refund_method || "original_payment_method",
          receipt_url: null,
        }),
      }).then(() => {}).catch((e) => console.error("Error notifying admin (finalize):", e))
    );

    await Promise.allSettled(notificationPromises);

    // Mark emails as sent
    await serviceClient
      .from("booking_cancellations")
      .update({ emails_sent: true })
      .eq("id", cancellation_id);

    return ok({
      success: true,
      message: "Cancelación finalizada exitosamente",
      booking_id,
      cancellation_id,
      points_deducted: pointsDeducted,
      booking_status: "cancelled",
    });
  } catch (e: any) {
    console.error("admin-finalize-cancellation error:", e);
    return err(e.message || "Error interno", 500);
  }
});
