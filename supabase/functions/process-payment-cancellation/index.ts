import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
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

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(message: string, status = 400) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Auth verification (same pattern as admin-* and process-traveler-cancellation) ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return err("No authorization header", 401);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return err("Token inválido", 401);

    const { booking_id } = await req.json();
    if (!booking_id) return err("booking_id es requerido");

    // ── Load booking from DB — never trust client-supplied amounts ──
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        id, status, payment_status, deposit_amount, service_charge,
        user_id, tour_id, agency_id, booking_code, cancelled_at,
        points_used, toursred_cash_used,
        tours!bookings_tour_id_fkey(id, name, start_date)
      `)
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError || !booking) return err("Reserva no encontrada", 404);

    // Security: only the booking owner can cancel via this flow
    if (booking.user_id !== user.id) return err("No tienes permiso para cancelar esta reserva", 403);

    if (booking.cancelled_at || booking.status === "cancelled")
      return err("Esta reserva ya fue cancelada");
    if (booking.status === "cancellation_processing")
      return err("Esta reserva ya tiene una cancelación en proceso");

    const tour = (booking as any).tours;
    const now = new Date().toISOString();
    const tourStartDate = tour?.start_date || now.split("T")[0];

    // ── Derive refund amounts from DB, not from client parameters ──
    const pointsUsed = Number(booking.points_used || 0);
    const toursredCashUsed = parseFloat(booking.toursred_cash_used || "0");

    // ── Atomic cancellation: lock row, refund wallet, update status ──
    let transactionId: string | null = null;
    const { data: rpcResult, error: rpcError } = await supabase.rpc("process_cancellation_refund", {
      p_booking_id: booking_id,
      p_refund_amount: toursredCashUsed,
      p_reference_type: "payment_cancellation",
      p_description: `Reembolso por cancelación de pago - ${tour?.name || ""}`,
      p_new_status: "cancelled",
      p_set_cancelled_at: true,
      p_cancellation_type: "payment_cancelled",
      p_cancellation_refund_amount: toursredCashUsed,
    });

    if (rpcError || !rpcResult?.success) {
      return err(rpcError?.message || "Error procesando cancelación atómica");
    }
    transactionId = rpcResult.transaction_id || null;

    // ── Update payment_status (process_cancellation_refund doesn't touch it) ──
    await supabase
      .from("bookings")
      .update({ payment_status: "canceled" })
      .eq("id", booking_id);

    // ── Refund points — amount derived from bookings.points_used by the DB function ──
    let pointsRefunded = 0;
    if (pointsUsed > 0) {
      try {
        const { error: refundErr } = await supabase.rpc("refund_points_for_cancelled_booking", {
          p_booking_id: booking_id,
        });
        if (refundErr) {
          console.error("Error refunding points:", refundErr);
        } else {
          pointsRefunded = pointsUsed;
        }
      } catch (e) {
        console.error("Exception refunding points:", e);
      }
    }

    // ── Create booking_cancellations record (same pattern as process-traveler-cancellation) ──
    const { data: cancellationRecord, error: bcErr } = await supabase
      .from("booking_cancellations")
      .insert({
        booking_id,
        cancelled_by_user_id: user.id,
        cancelled_at: now,
        tour_start_date: tourStartDate,
        days_before_tour: 0,
        cancellation_policy_type: "payment_cancelled",
        original_deposit_amount: Number(booking.deposit_amount || 0),
        original_service_charge: Number(booking.service_charge || 0),
        total_principal_paid: 0,
        refund_amount_to_traveler: toursredCashUsed,
        amount_to_agency: 0,
        amount_to_platform: 0,
        toursred_cash_transaction_id: transactionId,
        refund_processed: toursredCashUsed > 0,
        cancellation_reason: "Pago cancelado por el usuario",
        service_charge_refunded_amount: 0,
        insurance_refund_amount: 0,
        optional_services_refund_amount: 0,
      })
      .select()
      .single();

    if (bcErr) {
      console.error("Error inserting booking_cancellations record:", bcErr);
    }

    // ── Audit log ──
    try {
      await supabase.rpc("insert_audit_log", {
        p_tenant_type: "traveler",
        p_actor_id: user.id,
        p_actor_email: user.email ?? null,
        p_actor_role: "traveler",
        p_target_id: booking_id,
        p_target_table: "bookings",
        p_action: "payment_cancel",
        p_severity: "medium",
        p_old_values: { status: booking.status, payment_status: booking.payment_status },
        p_new_values: { status: "cancelled", payment_status: "canceled", cancellation_type: "payment_cancelled" },
        p_metadata: { cancellation_id: cancellationRecord?.id, points_refunded: pointsRefunded, toursred_cash_refunded: toursredCashUsed },
      });
    } catch (e) {
      console.error("Error audit log:", e);
    }

    return ok({
      success: true,
      cancellation_id: cancellationRecord?.id || null,
      booking_code: booking.booking_code,
      points_refunded: pointsRefunded,
      toursred_cash_refunded: toursredCashUsed,
    });
  } catch (e: any) {
    if (sentryDsn) {
      Sentry.captureException(e, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    console.error("process-payment-cancellation error:", e);
    return err(e.message || "Error interno", 500);
  }
});
