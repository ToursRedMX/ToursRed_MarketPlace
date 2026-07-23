import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No autenticado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "No autenticado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { booking_id, amount } = await req.json();

    if (!booking_id || !amount || amount <= 0) {
      return new Response(
        JSON.stringify({ error: "booking_id y amount (mayor a 0) son requeridos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verificar que el usuario es agencia o admin
    const { data: currentUser } = await supabase
      .from("users")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle();

    const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';

    // Obtener la reserva
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        id, user_id, agency_id, total_price, deposit_amount, wallet_charged_at_checkin,
        status, payment_status,
        agency:agencies(id, name, user_id),
        traveler:users!bookings_user_id_fkey(id, first_name, last_name, email)
      `)
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      return new Response(
        JSON.stringify({ error: "Reserva no encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isAgencyOwner = booking.agency?.user_id === user.id;

    // Verificar si es staff autorizado de la agencia
    let isAuthorizedStaff = false;
    if (!isAgencyOwner && !isAdmin) {
      const { data: staffRecord } = await supabase
        .from("agency_staff")
        .select("id")
        .eq("user_id", user.id)
        .eq("agency_id", booking.agency_id)
        .eq("is_active", true)
        .maybeSingle();
      isAuthorizedStaff = !!staffRecord;
    }

    if (!isAgencyOwner && !isAdmin && !isAuthorizedStaff) {
      return new Response(
        JSON.stringify({ error: "Solo la agencia del tour puede solicitar cobros con wallet" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (booking.status === 'cancelled' || booking.status === 'cancellation_processing') {
      return new Response(
        JSON.stringify({ error: "No se puede cobrar en una reserva cancelada o en proceso de cancelación" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calcular saldo pendiente real
    const remainingAmount = Math.max(
      0,
      booking.total_price - booking.deposit_amount - (booking.wallet_charged_at_checkin || 0)
    );

    if (remainingAmount <= 0) {
      return new Response(
        JSON.stringify({ error: "Esta reserva no tiene saldo pendiente" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const amountParsed = parseFloat(amount);
    if (amountParsed > remainingAmount) {
      return new Response(
        JSON.stringify({ error: `El monto solicitado (${amountParsed}) excede el saldo pendiente (${remainingAmount})` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Obtener porcentaje de cargo por servicio
    const { data: platformSettings } = await supabase
      .from("platform_settings")
      .select("service_charge_percentage")
      .maybeSingle();
    const serviceChargePct = platformSettings?.service_charge_percentage ?? 5;

    // Calcular cargo por servicio bruto
    const grossServiceCharge = parseFloat((amountParsed * serviceChargePct / 100).toFixed(2));

    // Obtener exencion disponible de membresia del viajero (solo lectura — el consumo atómico ocurre en confirm-checkin-wallet-charge)
    const { data: exemptionResult } = await supabase
      .rpc("get_available_service_fee_exemption", { p_user_id: booking.user_id });
    const exemptionAvailable = parseFloat(exemptionResult ?? 0);

    // Exencion aplicada: no puede superar el cargo bruto
    const exemptionApplied = Math.min(exemptionAvailable, grossServiceCharge);
    const netServiceCharge = parseFloat((grossServiceCharge - exemptionApplied).toFixed(2));
    const totalToDeduct = parseFloat((amountParsed + netServiceCharge).toFixed(2));

    // Verificar saldo suficiente en el wallet del viajero
    const { data: wallet } = await supabase
      .from("toursred_cash_wallets")
      .select("balance")
      .eq("user_id", booking.user_id)
      .eq("is_active", true)
      .maybeSingle();

    const walletBalance = wallet?.balance ?? 0;
    if (walletBalance < totalToDeduct) {
      return new Response(
        JSON.stringify({
          error: `Saldo insuficiente en el monedero del viajero. Disponible: $${walletBalance.toFixed(2)}, Requerido: $${totalToDeduct.toFixed(2)}`
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generar OTP de 6 digitos
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutos

    // Invalidar OTPs anteriores no usados para esta reserva
    await supabase
      .from("wallet_checkin_otps")
      .update({ used: true })
      .eq("booking_id", booking_id)
      .eq("used", false);

    // Guardar nuevo OTP
    const { data: otpRecord, error: otpError } = await supabase
      .from("wallet_checkin_otps")
      .insert({
        booking_id,
        code: otpCode,
        amount: amountParsed,
        expires_at: expiresAt,
        used: false,
        requested_by: user.id,
      })
      .select("id")
      .single();

    if (otpError) {
      console.error("Error creando OTP:", otpError);
      return new Response(
        JSON.stringify({ error: "Error al generar el código de verificación" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Enviar email con el OTP al viajero
    const traveler = booking.traveler as any;
    const agencyName = (booking.agency as any)?.name || "La agencia";
    const travelerName = `${traveler?.first_name || ''} ${traveler?.last_name || ''}`.trim() || 'Viajero';

    const { data: emailSettings } = await supabase
      .from("email_settings")
      .select("smtp_api_key, contact_email")
      .maybeSingle();

    if (emailSettings?.smtp_api_key) {
      const fromEmail = emailSettings.contact_email || "contacto@toursred.com";
      await fetch("https://api.smtp2go.com/v3/email/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Smtp2go-Api-Key": emailSettings.smtp_api_key,
        },
        body: JSON.stringify({
          sender: fromEmail,
          to: [traveler?.email],
          subject: "Codigo de autorización - Cobro con ToursRed Cash",
          html_body: `
            <!DOCTYPE html>
            <html>
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
              </head>
              <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                  <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" style="max-width: 180px; height: auto; margin-bottom: 16px; background: white; padding: 8px; border-radius: 8px;" />
                  <h1 style="color: white; margin: 0; font-size: 24px;">Autorización de Cobro</h1>
                </div>

                <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
                  <h2 style="color: #dc2626; margin-top: 0;">Hola ${travelerName},</h2>

                  <p style="font-size: 15px; margin-bottom: 16px;">
                    <strong>${agencyName}</strong> está solicitando cobrar el siguiente monto de tu monedero <strong>ToursRed Cash</strong>:
                  </p>

                  <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0;">
                    <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
                      <tr>
                        <td style="padding: 6px 0; color: #6b7280;">Monto a cobrar:</td>
                        <td style="padding: 6px 0; text-align: right; font-weight: bold; color: #111827;">$${amountParsed.toFixed(2)} MXN</td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; color: #6b7280;">Cargo por servicio (${serviceChargePct}%):</td>
                        <td style="padding: 6px 0; text-align: right; color: #111827;">$${grossServiceCharge.toFixed(2)} MXN</td>
                      </tr>
                      ${exemptionApplied > 0 ? `
                      <tr>
                        <td style="padding: 6px 0; color: #059669;">Descuento membresía ToursRed+:</td>
                        <td style="padding: 6px 0; text-align: right; color: #059669;">-$${exemptionApplied.toFixed(2)} MXN</td>
                      </tr>
                      ` : ''}
                      <tr style="border-top: 2px solid #e5e7eb;">
                        <td style="padding: 10px 0 6px 0; font-weight: bold; font-size: 16px;">Total a descontar de tu monedero:</td>
                        <td style="padding: 10px 0 6px 0; text-align: right; font-weight: bold; font-size: 16px; color: #dc2626;">$${totalToDeduct.toFixed(2)} MXN</td>
                      </tr>
                    </table>
                  </div>

                  <div style="background: white; padding: 25px; border-radius: 8px; text-align: center; margin: 24px 0; border: 2px dashed #dc2626;">
                    <p style="font-size: 13px; color: #6b7280; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 1px;">Tu código de autorización</p>
                    <p style="font-size: 40px; font-weight: bold; color: #dc2626; margin: 8px 0; letter-spacing: 10px; font-family: 'Courier New', monospace;">
                      ${otpCode}
                    </p>
                    <p style="font-size: 12px; color: #9ca3af; margin: 8px 0 0 0;">
                      Válido por 5 minutos
                    </p>
                  </div>

                  <p style="font-size: 14px; color: #374151;">
                    Proporciona este código al agente de <strong>${agencyName}</strong> únicamente si deseas autorizar este cobro con tu monedero ToursRed Cash.
                  </p>

                  <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 14px 16px; margin: 20px 0; border-radius: 4px;">
                    <p style="margin: 0; font-size: 13px; color: #92400e;">
                      <strong>Aviso de seguridad:</strong> Si no solicitaste este cobro o no reconoces esta solicitud, no compartas el código. El código expirará automáticamente en 5 minutos.
                    </p>
                  </div>

                  <p style="font-size: 13px; color: #9ca3af; margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                    ¿Necesitas ayuda? Contáctanos respondiendo a este correo.
                  </p>
                </div>
              </body>
            </html>
          `,
        }),
      }).catch((err) => console.error("Error enviando email OTP:", err));
    }

    return new Response(
      JSON.stringify({
        success: true,
        otp_id: otpRecord.id,
        amount: amountParsed,
        service_charge: grossServiceCharge,
        service_charge_pct: serviceChargePct,
        exemption_applied: exemptionApplied,
        net_service_charge: netServiceCharge,
        total_to_deduct: totalToDeduct,
        expires_at: expiresAt,
        message: `Código enviado al correo del viajero. Expira en 5 minutos.`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error en request-checkin-wallet-charge:", error);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor", details: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
