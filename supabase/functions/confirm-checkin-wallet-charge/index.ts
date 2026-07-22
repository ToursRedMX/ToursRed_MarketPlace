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

    const { booking_id, otp_code } = await req.json();

    if (!booking_id || !otp_code) {
      return new Response(
        JSON.stringify({ error: "booking_id y otp_code son requeridos" }),
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
        id, user_id, agency_id, total_price, deposit_amount, wallet_charged_at_checkin, status,
        agency:agencies(id, name, user_id)
      `)
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      return new Response(
        JSON.stringify({ error: "Reserva no encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isAgencyOwner = (booking.agency as any)?.user_id === user.id;

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
        JSON.stringify({ error: "No tienes permiso para confirmar cobros con wallet" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (booking.status === 'cancelled') {
      return new Response(
        JSON.stringify({ error: "No se puede cobrar en una reserva cancelada" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Buscar el OTP válido más reciente para esta reserva
    const { data: otpRecord, error: otpError } = await supabase
      .from("wallet_checkin_otps")
      .select("id, code, amount, expires_at, used")
      .eq("booking_id", booking_id)
      .eq("used", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (otpError || !otpRecord) {
      return new Response(
        JSON.stringify({ error: "No hay un código de verificación activo para esta reserva. Solicita uno nuevo." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verificar expiración
    if (new Date(otpRecord.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: "El código ha expirado. Solicita un nuevo código." }),
        { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verificar el código
    if (otpRecord.code !== otp_code.trim()) {
      return new Response(
        JSON.stringify({ error: "Código incorrecto. Verifica e intenta de nuevo." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const amountToCharge = parseFloat(otpRecord.amount);

    // Recalcular saldo pendiente para validar que sigue siendo válido
    const remainingAmount = Math.max(
      0,
      booking.total_price - booking.deposit_amount - (booking.wallet_charged_at_checkin || 0)
    );

    if (amountToCharge > remainingAmount) {
      return new Response(
        JSON.stringify({ error: "El monto a cobrar ya no es válido. El saldo pendiente cambió." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Obtener porcentaje de cargo por servicio
    const { data: platformSettings } = await supabase
      .from("platform_settings")
      .select("service_charge_percentage")
      .maybeSingle();
    const serviceChargePct = platformSettings?.service_charge_percentage ?? 5;

    // Calcular cargos exactamente igual que en request
    const grossServiceCharge = parseFloat((amountToCharge * serviceChargePct / 100).toFixed(2));

    // Aplicar exención de membresía via RPC centralizado (atómico, FOR UPDATE)
    const { data: exemptionResult } = await supabase
      .rpc("apply_membership_service_fee_exemption", { p_user_id: booking.user_id, p_gross_service_charge: grossServiceCharge });
    const exemptionApplied = parseFloat(exemptionResult?.exemption_applied ?? "0");
    const netServiceCharge = parseFloat(exemptionResult?.net_service_charge ?? grossServiceCharge.toString());
    const totalToDeduct = parseFloat((amountToCharge + netServiceCharge).toFixed(2));

    // Verificar saldo suficiente en el wallet
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
          error: `Saldo insuficiente. El viajero tiene $${walletBalance.toFixed(2)} y se requieren $${totalToDeduct.toFixed(2)}`
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- EJECUTAR EL COBRO ---

    // 1. Marcar OTP como usado
    await supabase
      .from("wallet_checkin_otps")
      .update({ used: true })
      .eq("id", otpRecord.id);

    // 2. Descontar del wallet del viajero
    const { data: walletResult, error: walletError } = await supabase
      .rpc("update_wallet_balance", {
        p_user_id: booking.user_id,
        p_amount: -totalToDeduct,
        p_type: "debit",
        p_description: `Cobro en check-in por ${(booking.agency as any)?.name || 'agencia'} - $${amountToCharge.toFixed(2)} + cargo servicio $${netServiceCharge.toFixed(2)}`,
        p_reference_id: booking_id,
        p_reference_type: "booking_checkin_charge",
      });

    if (walletError) {
      console.error("Error deduciendo wallet:", walletError);
      return new Response(
        JSON.stringify({ error: "Error al procesar el cobro en el monedero" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. La exención ya se consumió atómicamente en la RPC apply_membership_service_fee_exemption

    // 4. Actualizar wallet_charged_at_checkin en la reserva
    const newWalletCharged = parseFloat(((booking.wallet_charged_at_checkin || 0) + amountToCharge).toFixed(2));

    // 5. Acreditar ToursRed Points si el viajero tiene membresía activa
    let pointsEarned = 0;
    const { data: membership } = await supabase
      .from("memberships")
      .select("id, status, current_period_end, service_fee_exemption_used")
      .eq("user_id", booking.user_id)
      .eq("status", "active")
      .gt("current_period_end", new Date().toISOString())
      .maybeSingle();

    if (membership) {
      pointsEarned = Math.floor(amountToCharge);

      if (pointsEarned > 0) {
        // Obtener o crear billetera de puntos
        const { data: walletId } = await supabase
          .rpc("get_or_create_points_wallet", { p_user_id: booking.user_id });

        if (walletId) {
          // Leer balance actual para calcular balance_after
          const { data: pointsWallet } = await supabase
            .from("toursred_points_wallets")
            .select("id, balance, total_earned")
            .eq("id", walletId)
            .maybeSingle();

          if (pointsWallet) {
            const newBalance = pointsWallet.balance + pointsEarned;
            const newTotalEarned = pointsWallet.total_earned + pointsEarned;
            const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

            // Insertar transacción de puntos
            await supabase
              .from("toursred_points_transactions")
              .insert({
                wallet_id: walletId,
                user_id: booking.user_id,
                amount: pointsEarned,
                balance_after: newBalance,
                type: "earned",
                description: `Puntos por pago con ToursRed Cash en check-in (reserva ${booking_id.slice(0, 8)})`,
                reference_id: booking_id,
                reference_type: "booking",
                expires_at: expiresAt,
              });

            // Actualizar billetera de puntos
            await supabase
              .from("toursred_points_wallets")
              .update({ balance: newBalance, total_earned: newTotalEarned })
              .eq("id", walletId);
          }
        }
      }
    }

    // 6. Actualizar bookings: wallet cobrado, puntos ganados y ahorro de membresía en check-in
    const updatedMembershipSaved = parseFloat(
      ((booking.membership_service_fee_saved || 0) + exemptionApplied).toFixed(2)
    );
    await supabase
      .from("bookings")
      .update({
        wallet_charged_at_checkin: newWalletCharged,
        points_earned_at_checkin: pointsEarned,
        ...(exemptionApplied > 0 && { membership_service_fee_saved: updatedMembershipSaved }),
      })
      .eq("id", booking_id);

    // 7. Insertar registro de auditoría y capturar su ID para el CFDI
    const { data: checkinChargeRecord } = await supabase
      .from("wallet_checkin_charges")
      .insert({
        booking_id,
        amount_charged: amountToCharge,
        service_charge_applied: grossServiceCharge,
        membership_exemption_used: exemptionApplied,
        total_deducted_from_wallet: totalToDeduct,
        charged_by: user.id,
        otp_id: otpRecord.id,
      })
      .select("id")
      .single();

    // Trigger CFDI si el PAC está configurado (forma de pago 17 - Compensación)
    if (checkinChargeRecord?.id) {
      const { data: cfdiSettings } = await supabase
        .from("platform_settings")
        .select("pac_provider, pac_api_key_encrypted")
        .maybeSingle();

      if (cfdiSettings?.pac_provider && cfdiSettings.pac_provider !== "none" && cfdiSettings.pac_api_key_encrypted) {
        EdgeRuntime.waitUntil(
          fetch(`${supabaseUrl}/functions/v1/generate-booking-cfdi`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              booking_id,
              checkin_charge_id: checkinChargeRecord.id,
              payment_form: "17",
            }),
          }).catch((err) => console.error("CFDI trigger failed (checkin-wallet-charge):", err))
        );
      }
    }

    const newRemaining = Math.max(0, remainingAmount - amountToCharge);
    const walletResultJson = walletResult as any;
    const newWalletBalance = walletResultJson?.new_balance ?? (walletBalance - totalToDeduct);

    return new Response(
      JSON.stringify({
        success: true,
        amount_charged: amountToCharge,
        service_charge: grossServiceCharge,
        service_charge_pct: serviceChargePct,
        exemption_applied: exemptionApplied,
        net_service_charge: netServiceCharge,
        total_deducted_from_wallet: totalToDeduct,
        new_remaining_amount: newRemaining,
        new_wallet_balance: newWalletBalance,
        points_earned: pointsEarned,
        message: `Cobro realizado exitosamente. Se descontaron $${totalToDeduct.toFixed(2)} del monedero del viajero.${pointsEarned > 0 ? ` Se acreditaron ${pointsEarned} puntos ToursRed.` : ''}`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error en confirm-checkin-wallet-charge:", error);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor", details: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
