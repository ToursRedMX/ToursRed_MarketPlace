import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Find bookings with partial payments (user_payment > 0) that are still incomplete
    // Status must be pending or payment_pending_bnpl, and payment_status not succeeded
    const { data: bookings, error } = await supabase
      .from("bookings")
      .select(`
        id, booking_code, user_id, total_price, deposit_amount, user_payment,
        payment_status, status, created_at,
        incomplete_payment_reminder_72h_sent_at,
        incomplete_payment_reminder_24h_sent_at,
        tours(id, name)
      `)
      .in("status", ["pending", "payment_pending_bnpl"])
      .in("payment_status", ["pending", "processing"])
      .gt("user_payment", 0);

    if (error) {
      console.error("Error fetching incomplete bookings:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!bookings || bookings.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = Date.now();
    let reminders72hSent = 0;
    let reminders24hSent = 0;
    let cancellationsProcessed = 0;

    for (const booking of bookings) {
      const firstPaymentTime = new Date(booking.created_at).getTime();
      const elapsedMs = now - firstPaymentTime;
      const elapsedHours = elapsedMs / (1000 * 60 * 60);

      const requiredAmount = Number(booking.deposit_amount) || Number(booking.total_price) || 0;
      const paidAmount = Number(booking.user_payment) || 0;

      // Skip if already fully paid (shouldn't happen due to filters, but safety check)
      if (paidAmount >= requiredAmount) continue;

      // ─── 72h reminder ──────────────────────────────────────────
      if (elapsedHours >= 72 && elapsedHours < (6 * 24) && !booking.incomplete_payment_reminder_72h_sent_at) {
        try {
          const { data: userData } = await supabase
            .from("users")
            .select("email, first_name")
            .eq("id", booking.user_id)
            .maybeSingle();

          if (userData?.email) {
            const tourName = (booking.tours as any)?.name || "tu tour";
            const remainingAmount = requiredAmount - paidAmount;

            await fetch(`${supabaseUrl}/functions/v1/send-payment-plan-reminder`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({
                email: userData.email,
                firstName: userData.first_name || "Viajero",
                booking_id: booking.id,
                booking_code: booking.booking_code,
                tour_name: tourName,
                remaining_amount: remainingAmount,
                deadline_type: "incomplete_72h",
                deadline_date: new Date(firstPaymentTime + 7 * 24 * 60 * 60 * 1000).toISOString(),
              }),
            }).catch((e) => console.error(`Error sending 72h reminder for booking ${booking.id}:`, e));
          }

          await supabase
            .from("bookings")
            .update({ incomplete_payment_reminder_72h_sent_at: new Date().toISOString() })
            .eq("id", booking.id);

          reminders72hSent++;
        } catch (err) {
          console.error(`Error processing 72h reminder for booking ${booking.id}:`, err);
        }
      }

      // ─── 24h before cancellation reminder (day 6) ─────────────
      if (elapsedHours >= (6 * 24) && elapsedHours < (7 * 24) && !booking.incomplete_payment_reminder_24h_sent_at) {
        try {
          const { data: userData } = await supabase
            .from("users")
            .select("email, first_name")
            .eq("id", booking.user_id)
            .maybeSingle();

          if (userData?.email) {
            const tourName = (booking.tours as any)?.name || "tu tour";
            const remainingAmount = requiredAmount - paidAmount;

            await fetch(`${supabaseUrl}/functions/v1/send-payment-plan-reminder`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({
                email: userData.email,
                firstName: userData.first_name || "Viajero",
                booking_id: booking.id,
                booking_code: booking.booking_code,
                tour_name: tourName,
                remaining_amount: remainingAmount,
                deadline_type: "incomplete_24h",
                deadline_date: new Date(firstPaymentTime + 7 * 24 * 60 * 60 * 1000).toISOString(),
              }),
            }).catch((e) => console.error(`Error sending 24h reminder for booking ${booking.id}:`, e));
          }

          await supabase
            .from("bookings")
            .update({ incomplete_payment_reminder_24h_sent_at: new Date().toISOString() })
            .eq("id", booking.id);

          reminders24hSent++;
        } catch (err) {
          console.error(`Error processing 24h reminder for booking ${booking.id}:`, err);
        }
      }

      // ─── 7 days: cancel and refund to wallet ──────────────────
      if (elapsedHours >= (7 * 24)) {
        try {
          const { data: userData } = await supabase
            .from("users")
            .select("email, first_name")
            .eq("id", booking.user_id)
            .maybeSingle();

          // Cancel the booking
          await supabase
            .from("bookings")
            .update({
              status: "cancelled",
              payment_status: "cancelled",
              cancelled_at: new Date().toISOString(),
              cancellation_reason: "pago incompleto después de 7 días",
            })
            .eq("id", booking.id);

          // Refund user_payment to ToursRed Cash wallet, minus service charge
          const refundAmount = Math.max(0, paidAmount - (paidAmount * 0.05));

          if (refundAmount > 0 && booking.user_id) {
            const { data: walletId } = await supabase.rpc("get_or_create_points_wallet", {
              p_user_id: booking.user_id,
            });

            if (walletId) {
              // Actually refund to ToursRed Cash wallet, not points wallet
              const { data: cashWalletId } = await supabase.rpc("get_or_create_wallet", {
                p_user_id: booking.user_id,
              });

              if (cashWalletId) {
                await supabase.rpc("update_wallet_balance", {
                  p_wallet_id: cashWalletId,
                  p_amount: refundAmount,
                  p_type: "refund",
                  p_description: `Reembolso por cancelación - pago incompleto (Reserva ${booking.booking_code})`,
                  p_reference_id: booking.id,
                  p_reference_type: "booking_cancellation",
                  p_idempotency_key: `incomplete_cancel_${booking.id}`,
                });
              }
            }
          }

          // Send cancellation notification email
          if (userData?.email) {
            await fetch(`${supabaseUrl}/functions/v1/send-cancellation-notification-traveler`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({
                booking_id: booking.id,
                reason: "pago incompleto después de 7 días",
              }),
            }).catch((e) => console.error(`Error sending cancellation email for booking ${booking.id}:`, e));
          }

          cancellationsProcessed++;
          console.log(`Booking ${booking.id} cancelled for incomplete payment after 7 days`);
        } catch (err) {
          console.error(`Error processing cancellation for booking ${booking.id}:`, err);
        }
      }
    }

    console.log(`process-incremental-payment-deadlines: 72h=${reminders72hSent}, 24h=${reminders24hSent}, cancellations=${cancellationsProcessed}`);

    return new Response(JSON.stringify({
      processed: bookings.length,
      reminders_72h_sent: reminders72hSent,
      reminders_24h_sent: reminders24hSent,
      cancellations_processed: cancellationsProcessed,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Error in process-incremental-payment-deadlines:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
