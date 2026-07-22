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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { installment_id, notification_type = "payment_plan_reminder" } = await req.json();
    if (!installment_id) {
      return new Response(JSON.stringify({ error: "installment_id es requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load installment with booking, tour, and user context
    const { data: installment } = await supabase
      .from("booking_payment_plan_installments")
      .select(`
        id, installment_number, label, amount_due, amount_paid, penalty_applied, due_date, status,
        booking_id,
        booking_payment_plans!inner(
          id,
          bookings!inner(
            id, user_id, booking_code,
            tours!inner(id, name)
          )
        )
      `)
      .eq("id", installment_id)
      .maybeSingle();

    if (!installment) {
      return new Response(JSON.stringify({ error: "Parcialidad no encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const plan = (installment.booking_payment_plans as any);
    const booking = plan.bookings as any;
    const tour = booking.tours as any;

    const amountPending = parseFloat(
      (Number(installment.amount_due) + Number(installment.penalty_applied) - Number(installment.amount_paid)).toFixed(2)
    );

    // Determine title and message based on notification_type
    let title: string;
    let message: string;

    if (notification_type === "payment_plan_overdue") {
      title = `Pago vencido: ${tour.name}`;
      message = `Tu parcialidad "${installment.label}" por $${amountPending.toFixed(2)} MXN venció el ${installment.due_date}. Realiza tu pago lo antes posible.`;
    } else if (notification_type === "payment_plan_overdue_critical") {
      title = `Pago en mora crítica: ${tour.name}`;
      message = `Tu parcialidad "${installment.label}" por $${amountPending.toFixed(2)} MXN lleva más de 30 días vencida. Tu reserva puede ser cancelada.`;
    } else {
      title = `Recordatorio de pago: ${tour.name}`;
      message = `Tu próxima parcialidad "${installment.label}" por $${amountPending.toFixed(2)} MXN vence el ${installment.due_date}.`;
    }

    // Create in-app notification
    await supabase.from("notifications").insert({
      user_id: booking.user_id,
      type: notification_type,
      title,
      message,
      data: {
        booking_id: booking.id,
        booking_code: booking.booking_code,
        plan_id: plan.id,
        installment_id: installment.id,
        amount_pending: amountPending,
        due_date: installment.due_date,
      },
    });

    // Send email via platform email service
    const { data: emailSettings } = await supabase
      .from("platform_settings")
      .select("smtp_host, smtp_port, smtp_user, smtp_password, smtp_from_name, smtp_from_email, supabase_service_key, platform_url")
      .maybeSingle();

    const appUrl = (emailSettings as any)?.platform_url || "https://toursredmx.netlify.app";

    const { data: traveler } = await supabase
      .from("users")
      .select("first_name, last_name, email")
      .eq("id", booking.user_id)
      .maybeSingle();

    if (traveler?.email && emailSettings) {
      EdgeRuntime.waitUntil(
        supabase.functions.invoke("send-email", {
          body: {
            to: traveler.email,
            subject: title,
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>${title}</h2>
                <p>Hola ${traveler.first_name},</p>
                <p>${message}</p>
                <p><strong>Tour:</strong> ${tour.name}</p>
                <p><strong>Reserva:</strong> ${booking.booking_code}</p>
                <p><strong>Monto pendiente:</strong> $${amountPending.toFixed(2)} MXN</p>
                <p><strong>Fecha de vencimiento:</strong> ${installment.due_date}</p>
                <br>
                <a href="${appUrl}/traveler/bookings"
                   style="background: #0ea5e9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
                  Realizar pago
                </a>
              </div>
            `,
          },
        }).catch(() => {})
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
