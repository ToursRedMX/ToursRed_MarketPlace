import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface BookingConfirmationRequest {
  booking_id: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    console.log("🚀 send-booking-confirmation: Función iniciada");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { booking_id }: BookingConfirmationRequest = await req.json();
    console.log("📝 Booking ID recibido:", booking_id);

    if (!booking_id) {
      console.error("❌ No se proporcionó booking_id");
      return new Response(
        JSON.stringify({ error: "El ID de reserva es requerido" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        *,
        tour:tours(*),
        traveler:users!bookings_user_id_fkey(id, first_name, last_name, email, phone_number),
        agency:agencies(*)
      `)
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      console.error("Error fetching booking:", bookingError);
      return new Response(
        JSON.stringify({ error: "No se encontró la reserva" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: paymentTransaction } = await supabase
      .from("payment_transactions")
      .select("payment_method_type")
      .eq("booking_id", booking_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const pointsUsed = booking.points_used || 0;
    const pointsEarned = booking.points_earned || 0;

    let paymentMethod = booking.payment_method || 'Tarjeta de Crédito/Débito';
    if (paymentTransaction?.payment_method_type) {
      const methodMap: Record<string, string> = {
        'card': 'Tarjeta de Crédito/Débito',
        'toursred_cash': 'ToursRed Cash',
        'toursred_points_cash': 'Puntos ToursRed + ToursRed Cash',
        'stripe': 'Tarjeta de Crédito/Débito'
      };
      paymentMethod = methodMap[paymentTransaction.payment_method_type] || paymentTransaction.payment_method_type;
    } else if (booking.toursred_cash_used > 0 && pointsUsed > 0) {
      paymentMethod = 'Puntos ToursRed + ToursRed Cash + Stripe';
    } else if (pointsUsed > 0) {
      paymentMethod = 'Puntos ToursRed + Stripe';
    } else if (booking.toursred_cash_used > 0) {
      paymentMethod = 'ToursRed Cash + Stripe';
    }

    const { data: lockResult } = await supabase.rpc('claim_booking_email_lock', {
      p_booking_id: booking_id
    });

    if (!lockResult) {
      console.log("Emails de confirmación ya fueron enviados o reclamados por otro proceso");
      return new Response(
        JSON.stringify({
          success: true,
          message: "Los emails de confirmación ya fueron enviados previamente",
          already_sent: true
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const [emailSettingsResult, platformSettingsResult] = await Promise.all([
      supabase.from("email_settings").select("*").maybeSingle(),
      supabase.from("platform_settings").select("*").maybeSingle()
    ]);

    if (emailSettingsResult.error || !emailSettingsResult.data || !emailSettingsResult.data.smtp_api_key) {
      console.error("Email settings not configured:", emailSettingsResult.error);
      return new Response(
        JSON.stringify({
          success: false,
          message: "Configuración de email no disponible"
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (platformSettingsResult.error || !platformSettingsResult.data) {
      console.error("Platform settings not configured:", platformSettingsResult.error);
      return new Response(
        JSON.stringify({
          success: false,
          message: "Configuración de plataforma no disponible"
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const emailSettings = emailSettingsResult.data;
    const platformSettings = platformSettingsResult.data;

    const promoDiscountAmount = Number(booking.promo_discount_amount) || 0;
    const totalPrice = booking.total_price;
    const depositAmount = booking.deposit_amount;
    const depositPercentage = booking.tour.deposit_percentage;
    const serviceChargePercentage = platformSettings.service_charge_percentage;
    const agencyCommission = Number(booking.commission_amount) || 0;
    const agencyCommissionPercentage =
      (booking.agency?.commission_rate != null ? Number(booking.agency.commission_rate) * 100 : null) ??
      platformSettings?.agency_commission_percentage ??
      (totalPrice > 0 ? Math.round((agencyCommission / totalPrice) * 1000) / 10 : 0);
    const serviceCharge = booking.service_charge || 0;
    const serviceChargeDiscount = Number(booking.service_charge_discount) || 0;
    const discountAmount = Number(booking.discount_amount) || 0;
    const toursRedCashUsed = booking.toursred_cash_used || 0;
    const userPayment = booking.user_payment || (depositAmount + serviceCharge);
    const pointsValueUsed = pointsUsed / 100;
    // stripePayment = lo que se cobró por Stripe: total pagado menos puntos y cash
    const stripePayment = Math.max(0, Math.round((userPayment - toursRedCashUsed - pointsValueUsed) * 100) / 100);
    const remainingAmount = totalPrice - depositAmount;

    const agencyReceives = depositAmount - agencyCommission;

    const pickupExtraCost = Number(booking.pickup_zone_extra_cost) || 0;
    const languageExtraCost = Number(booking.language_extra_cost) || 0;
    const travelInsuranceCost = booking.travel_insurance_included ? (Number(booking.travel_insurance_cost) || 0) : 0;
    const insuranceDiscountAmount = Number(booking.insurance_discount_amount) || 0;
    const membershipPurchased = booking.membership_purchased || false;
    const membershipPlan = booking.membership_plan || null;
    const membershipCost = Number(booking.membership_cost) || 0;

    const { data: paidOptionalsData } = await supabase
      .from("booking_optional_services")
      .select(`
        total_paid,
        service_charge,
        agency_commission,
        tour_optional_services!inner(name)
      `)
      .eq("booking_id", booking_id)
      .not("paid_at", "is", null)
      .eq("is_cancelled", false);

    const paidOptionals = (paidOptionalsData || []).map((row: any) => ({
      name: row.tour_optional_services?.name || "Servicio opcional",
      total_paid: Number(row.total_paid) || 0,
      service_charge: Number(row.service_charge) || 0,
      agency_commission: Number(row.agency_commission) || 0,
    }));
    const optionalsTotal = paidOptionals.reduce((sum, o) => sum + o.total_paid, 0);
    const optionalsCommissionTotal = paidOptionals.reduce((sum, o) => sum + o.agency_commission, 0);
    const optionalsServiceChargeTotal = paidOptionals.reduce((sum, o) => sum + o.service_charge, 0);

    const { data: companionsData } = await supabase
      .from("booking_travelers")
      .select("nombre, apellido, categoria_viajero")
      .eq("booking_id", booking_id)
      .order("created_at", { ascending: true });

    const companions = (companionsData || []).map((c: any) => ({
      nombre: c.nombre,
      apellido: c.apellido || '',
      categoria: c.categoria_viajero,
    }));

    const insuranceDays = Number(booking.insurance_days) || 0;
    const insuranceTravelers = booking.travelers_count || 0;

    // Monto real cobrado al viajero hoy: depósito + seguro + membresía + opcionales (calculado, no el campo stale de BD)
    const adminTotalCobrado = depositAmount + travelInsuranceCost + membershipCost + optionalsTotal;

    const formatDate = (dateString: string | null | undefined) => {
      if (!dateString) return 'No disponible';
      const date = new Date(dateString);
      return date.toLocaleDateString('es-MX', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    };

    const isReceptivo = !booking.tour.start_date && !booking.tour.end_date;
    const fechaReservaDisplay = isReceptivo
      ? (booking.selected_date
          ? `${formatDate(booking.selected_date)}${booking.selected_time ? ' - ' + booking.selected_time : ''}`
          : formatDate(booking.booking_date))
      : null;

    const formatCurrency = (amount: number) => {
      return `${amount.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const optionalsHtml = paidOptionals.length > 0
      ? `        <div class="info-row" style="margin-top: 10px;">
          <span class="info-label" style="font-weight: 700; color: #1e40af;">🎟️ Servicios Adicionales:</span>
          <span class="info-value"></span>
        </div>
` + paidOptionals.map(o => `        <div class="info-row">
          <span class="info-label">${o.name}:</span>
          <span class="info-value">${formatCurrency(o.total_paid)}</span>
        </div>`).join('\n') + (optionalsServiceChargeTotal > 0 ? `
        <div class="info-row">
          <span class="info-label">Cargo por Servicio extras (${serviceChargePercentage}%):</span>
          <span class="info-value">${formatCurrency(optionalsServiceChargeTotal)}</span>
        </div>` : '')
      : '';

    const companionsHtml = companions.length > 0
      ? companions.map(c => `        <div class="info-row">
          <span class="info-label">${c.categoria === 'adulto' ? 'Adulto' : c.categoria === 'nino' ? 'Niño' : c.categoria === 'infante' ? 'Infante' : c.categoria === 'adulto_mayor' ? 'Adulto Mayor' : c.categoria}:</span>
          <span class="info-value">${c.nombre}${c.apellido ? ' ' + c.apellido : ''}</span>
        </div>`).join('\n')
      : '';

    console.log("Sending booking confirmation emails for booking:", booking_id);

    let qrImageUrl = "";
    let checkinPageUrl = "";
    try {
      const qrResponse = await fetch(`${supabaseUrl}/functions/v1/generate-booking-qr-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ booking_id }),
      });
      const qrData = await qrResponse.json();
      if (qrData?.qr_url) {
        checkinPageUrl = qrData.qr_url;
        qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrData.qr_url)}&size=200x200&margin=10`;
      }
    } catch (qrErr) {
      console.error("Error generating QR token:", qrErr);
    }

    const qrSection = qrImageUrl ? `
      <div class="section" style="text-align: center;">
        <div class="section-title" style="text-align: left;">Código QR de Check-in</div>
        <p style="color: #6b7280; font-size: 14px; margin-bottom: 16px;">
          Presenta este código a la agencia el día del tour para confirmar tu asistencia.
        </p>
        <div style="background-color: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 12px; padding: 24px; display: inline-block;">
          <img src="${qrImageUrl}" alt="Código QR de Check-in" style="width: 200px; height: 200px; display: block; margin: 0 auto;" />
          <div style="font-size: 11px; color: #94a3b8; margin-top: 10px;">Válido hasta 24h después del inicio del tour</div>
        </div>
      </div>
    ` : '';

    const travelerEmailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #b8dfe6; padding: 30px 20px; text-align: center; }
    .logo { max-width: 200px; height: auto; margin-bottom: 10px; }
    .content { background-color: #ffffff; padding: 30px 20px; border: 1px solid #e5e7eb; }
    .title { font-size: 24px; font-weight: bold; color: #1e40af; margin-bottom: 20px; }
    .section { margin-bottom: 25px; }
    .section-title { font-weight: bold; color: #1e40af; margin-bottom: 10px; font-size: 16px; }
    .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
    .info-label { color: #6b7280; }
    .info-value { font-weight: 600; }
    .highlight { background-color: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0; }
    .total-box { background-color: #dbeafe; padding: 15px; border-radius: 8px; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" class="logo" />
      <h1 style="margin: 0; color: #1e40af;">¡Reserva Confirmada!</h1>
    </div>
    <div class="content">
      <div class="title">¡Tu reserva ha sido confirmada!</div>

      <p>Estimado/a ${booking.traveler.first_name} ${booking.traveler.last_name},</p>

      <p>Tu pago ha sido procesado exitosamente. A continuación encontrarás los detalles de tu reserva:</p>

      <div class="section">
        <div class="section-title">🎫 Código de Reserva</div>
        <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; text-align: center; margin-bottom: 20px;">
          <div style="font-size: 12px; color: #92400e; margin-bottom: 5px;">Tu código de referencia</div>
          <div style="font-size: 28px; font-weight: bold; color: #92400e; letter-spacing: 2px;">${booking.booking_code}</div>
          <div style="font-size: 12px; color: #92400e; margin-top: 5px;">Usa este código para cualquier consulta sobre tu reserva</div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">📍 Detalles del Tour</div>
        <div class="info-row">
          <span class="info-label">Tour:</span>
          <span class="info-value">${booking.tour.name}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Destino:</span>
          <span class="info-value">${booking.tour.destination}</span>
        </div>
        ${isReceptivo ? `
        <div class="info-row">
          <span class="info-label">Fecha y horario reservado:</span>
          <span class="info-value">${fechaReservaDisplay}</span>
        </div>
        ` : `
        <div class="info-row">
          <span class="info-label">Fecha de inicio:</span>
          <span class="info-value">${formatDate(booking.tour.start_date)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Fecha de finalización:</span>
          <span class="info-value">${formatDate(booking.tour.end_date)}</span>
        </div>
        `}
        <div class="info-row">
          <span class="info-label">Número de viajeros:</span>
          <span class="info-value">${booking.travelers_count}</span>
        </div>
        ${booking.pickup_type ? `
        <div class="info-row">
          <span class="info-label">Traslado:</span>
          <span class="info-value">${booking.pickup_type === 'meeting_point' ? 'Me presento en el punto de encuentro' : `Recogida en hotel — ${booking.pickup_zone_name || ''}`}</span>
        </div>
        ` : ''}
        ${booking.selected_language ? `
        <div class="info-row">
          <span class="info-label">Idioma del tour:</span>
          <span class="info-value">${booking.selected_language}</span>
        </div>
        ` : ''}
        ${booking.selected_seats && Array.isArray(booking.selected_seats) && booking.selected_seats.length > 0 ? `
        <div class="info-row" style="align-items: flex-start;">
          <span class="info-label">Asientos asignados:</span>
          <span class="info-value" style="display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end;">
            ${[...booking.selected_seats].sort((a: number, b: number) => a - b).map((seat: number) => `
              <span style="display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; background-color: #2563eb; color: white; font-size: 13px; font-weight: 700; border-radius: 8px;">${seat}</span>
            `).join('')}
          </span>
        </div>
        ` : ''}
      </div>

      <div class="section">
        <div class="section-title">💰 Desglose de Costos</div>
        ${booking.adults_count > 0 ? `
        <div class="info-row">
          <span class="info-label">${booking.adults_count} ${booking.adults_count === 1 ? 'Adulto' : 'Adultos'} × ${formatCurrency(booking.adult_price || 0)}:</span>
          <span class="info-value">${formatCurrency((booking.adult_price || 0) * (booking.adults_count || 0))}</span>
        </div>
        ` : ''}
        ${booking.children_count > 0 ? `
        <div class="info-row">
          <span class="info-label">${booking.children_count} ${booking.children_count === 1 ? 'Niño' : 'Niños'} × ${formatCurrency(booking.child_price || 0)}:</span>
          <span class="info-value">${formatCurrency((booking.child_price || 0) * (booking.children_count || 0))}</span>
        </div>
        ` : ''}
        ${booking.infants_count > 0 ? `
        <div class="info-row">
          <span class="info-label">${booking.infants_count} ${booking.infants_count === 1 ? 'Infante' : 'Infantes'} × ${formatCurrency(booking.infant_price || 0)}:</span>
          <span class="info-value">${formatCurrency((booking.infant_price || 0) * (booking.infants_count || 0))}</span>
        </div>
        ` : ''}
        ${booking.seniors_count > 0 ? `
        <div class="info-row">
          <span class="info-label">${booking.seniors_count} ${booking.seniors_count === 1 ? 'Adulto Mayor' : 'Adultos Mayores'} × ${formatCurrency(booking.senior_price || 0)}:</span>
          <span class="info-value">${formatCurrency((booking.senior_price || 0) * (booking.seniors_count || 0))}</span>
        </div>
        ` : ''}
        ${booking.pets_count > 0 ? `
        <div class="info-row">
          <span class="info-label">${booking.pets_count} ${booking.pets_count === 1 ? 'Mascota' : 'Mascotas'} × ${formatCurrency(booking.pet_price || 0)}:</span>
          <span class="info-value">${formatCurrency((booking.pet_price || 0) * (booking.pets_count || 0))}</span>
        </div>
        ` : ''}
        ${promoDiscountAmount > 0 ? `
        <div class="info-row" style="background-color: #dcfce7; margin: 5px -5px; padding: 8px 5px;">
          <span class="info-label" style="font-weight: 600;">🏷️ Descuento Grupal:</span>
          <span class="info-value" style="color: #059669;">-${formatCurrency(promoDiscountAmount)}</span>
        </div>
        ` : ''}
        ${pickupExtraCost > 0 ? `
        <div class="info-row">
          <span class="info-label">🚗 Pick Up — ${booking.pickup_zone_name} (${booking.pickup_cost_type === 'por_persona' ? 'por persona' : 'por reserva'}):</span>
          <span class="info-value">${formatCurrency(pickupExtraCost)}</span>
        </div>
        ` : ''}
        ${languageExtraCost > 0 ? `
        <div class="info-row">
          <span class="info-label">🌐 Idioma — ${booking.selected_language} (${booking.language_cost_type === 'por_persona' ? 'por persona' : 'fijo'}):</span>
          <span class="info-value">${formatCurrency(languageExtraCost)}</span>
        </div>
        ` : ''}
        <div class="info-row" style="border-top: 2px solid #e5e7eb; padding-top: 10px; margin-top: 10px;">
          <span class="info-label" style="font-weight: 700;">Precio Total del Tour:</span>
          <span class="info-value" style="font-weight: 700;">${formatCurrency(totalPrice)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Anticipo (${depositPercentage}%):</span>
          <span class="info-value">${formatCurrency(depositAmount)}</span>
        </div>
        ${membershipPurchased && membershipCost > 0 ? `
        <div class="info-row" style="background-color:#eef2ff;padding:8px 5px;margin:5px -5px;">
          <span class="info-label" style="color:#4338ca;font-weight:600;">⭐ Membresía ToursRed Plus (${membershipPlan === 'monthly' ? 'Mensual' : 'Anual'}):</span>
          <span class="info-value" style="color:#4338ca;font-weight:600;">${formatCurrency(membershipCost)}</span>
        </div>` : ''}
        ${optionalsHtml}
        <div class="info-row" style="${travelInsuranceCost > 0 || membershipPurchased || optionalsTotal > 0 ? 'background-color: #f0fdf4; padding: 8px 5px; margin: 5px -5px;' : ''}">
          <span class="info-label" style="font-weight: ${travelInsuranceCost > 0 || membershipPurchased || optionalsTotal > 0 ? '700' : '400'};">Total cobrado hoy${travelInsuranceCost > 0 && membershipPurchased && optionalsTotal > 0 ? ' (anticipo + seguro + membresía + opcionales)' : travelInsuranceCost > 0 && membershipPurchased ? ' (anticipo + seguro + membresía)' : travelInsuranceCost > 0 && optionalsTotal > 0 ? ' (anticipo + seguro + opcionales)' : travelInsuranceCost > 0 ? ' (anticipo + seguro)' : membershipPurchased && optionalsTotal > 0 ? ' (anticipo + membresía + opcionales)' : membershipPurchased ? ' (anticipo + membresía)' : optionalsTotal > 0 ? ' (anticipo + opcionales)' : ''}:</span>
          <span class="info-value" style="${travelInsuranceCost > 0 || membershipPurchased ? 'font-weight: 700;' : ''}">${formatCurrency(userPayment)}</span>
        </div>
        ${serviceChargeDiscount > 0 ? `
        <div class="info-row">
          <span class="info-label">Cargo por Servicio (${serviceChargePercentage}%):</span>
          <span class="info-value" style="text-decoration: line-through; color: #9ca3af;">${formatCurrency(serviceCharge + serviceChargeDiscount)}</span>
        </div>
        <div class="info-row" style="background-color: #dcfce7; margin: 5px -5px; padding: 8px 5px;">
          <span class="info-label" style="font-weight: 600;">🏷️ Desc. Cargo por Servicio:</span>
          <span class="info-value" style="color: #059669;">-${formatCurrency(serviceChargeDiscount)}</span>
        </div>
        ${serviceCharge > 0 ? `
        <div class="info-row">
          <span class="info-label">Cargo por Servicio (a pagar):</span>
          <span class="info-value">${formatCurrency(serviceCharge)}</span>
        </div>
        ` : ''}
        ` : serviceCharge > 0 ? `
        <div class="info-row">
          <span class="info-label">Cargo por Servicio (${serviceChargePercentage}%):</span>
          <span class="info-value">${formatCurrency(serviceCharge)}</span>
        </div>
        ` : `
        <div class="info-row">
          <span class="info-label">Cargo por Servicio:</span>
          <span class="info-value" style="color: #059669;">$0.00 (ToursRed Plus)</span>
        </div>
        `}
        ${discountAmount > 0 ? `
        <div class="info-row" style="background-color: #dcfce7; margin: 5px -5px; padding: 8px 5px;">
          <span class="info-label" style="font-weight: 600;">🏷️ Código de Descuento:</span>
          <span class="info-value" style="color: #059669;">-${formatCurrency(discountAmount)}</span>
        </div>
        ` : ''}
        ${pointsUsed > 0 ? `
        <div class="info-row" style="background-color: #fef3c7; margin: 5px -5px; padding: 8px 5px;">
          <span class="info-label" style="font-weight: 600;">⭐ Puntos ToursRed Usados:</span>
          <span class="info-value" style="color: #d97706;">-${pointsUsed.toLocaleString('es-MX')} puntos (${formatCurrency(pointsValueUsed)})</span>
        </div>
        ` : ''}
        ${toursRedCashUsed > 0 ? `
        <div class="info-row" style="background-color: #fef3c7; margin: 5px -5px; padding: 8px 5px;">
          <span class="info-label" style="font-weight: 600;">💰 ToursRed Cash Aplicado:</span>
          <span class="info-value" style="color: #d97706;">-${formatCurrency(toursRedCashUsed)}</span>
        </div>
        ` : ''}
        ${travelInsuranceCost > 0 || (travelInsuranceCost === 0 && insuranceDiscountAmount > 0) ? `
        <div class="info-row">
          <span class="info-label">🛡️ Seguro de viaje (${insuranceDays} ${insuranceDays === 1 ? 'día' : 'días'} × ${insuranceTravelers} ${insuranceTravelers === 1 ? 'viajero' : 'viajeros'})${insuranceDiscountAmount > 0 ? ` <span style="text-decoration:line-through;color:#9ca3af;font-size:12px;">${formatCurrency(travelInsuranceCost + insuranceDiscountAmount)}</span>` : ''}:</span>
          <span class="info-value">${travelInsuranceCost === 0 ? 'GRATIS' : formatCurrency(travelInsuranceCost)}</span>
        </div>
        ${insuranceDiscountAmount > 0 ? `
        <div class="info-row">
          <span class="info-label" style="color:#059669;">Descuento en seguro:</span>
          <span class="info-value" style="color:#059669;">-${formatCurrency(insuranceDiscountAmount)}</span>
        </div>` : ''}
        ` : ''}
        <div class="total-box" style="margin-top: 15px;">
          <div style="display: flex; justify-content: space-between; font-size: 18px; font-weight: bold;">
            <span>Total Pagado:</span>
            <span style="color: #059669;">${formatCurrency(userPayment)}</span>
          </div>
          ${(pointsUsed > 0 || toursRedCashUsed > 0) ? `
          <div style="font-size: 12px; color: #6b7280; text-align: right; margin-top: 5px;">
            ${pointsUsed > 0 && toursRedCashUsed > 0 && stripePayment > 0
              ? `(${pointsUsed.toLocaleString('es-MX')} puntos + ${formatCurrency(toursRedCashUsed)} ToursRed Cash + ${formatCurrency(stripePayment)} Stripe)`
              : pointsUsed > 0 && stripePayment > 0
                ? `(${pointsUsed.toLocaleString('es-MX')} puntos + ${formatCurrency(stripePayment)} Stripe)`
                : pointsUsed > 0 && toursRedCashUsed > 0
                  ? `(${pointsUsed.toLocaleString('es-MX')} puntos + ${formatCurrency(toursRedCashUsed)} ToursRed Cash)`
                  : toursRedCashUsed > 0 && stripePayment > 0
                    ? `(${formatCurrency(toursRedCashUsed)} ToursRed Cash + ${formatCurrency(stripePayment)} Stripe)`
                    : toursRedCashUsed > 0
                      ? `(${formatCurrency(toursRedCashUsed)} ToursRed Cash)`
                      : pointsUsed > 0
                        ? `(${pointsUsed.toLocaleString('es-MX')} puntos)`
                        : ''
            }
          </div>
          ` : ''}
        </div>
        ${pointsEarned > 0 ? `
        <div class="info-row" style="background-color: #dcfce7; margin: 5px -5px; padding: 8px 5px;">
          <span class="info-label" style="font-weight: 600;">🎁 Puntos ToursRed Ganados:</span>
          <span class="info-value" style="color: #059669;">+${pointsEarned.toLocaleString('es-MX')} puntos</span>
        </div>
        ` : ''}
        <div class="info-row" style="border-top: 2px solid #e5e7eb; padding-top: 10px; margin-top: 10px;">
          <span class="info-label">Saldo Restante (a pagar a la agencia):</span>
          <span class="info-value" style="color: #dc2626;">${formatCurrency(remainingAmount)}</span>
        </div>
      </div>

      ${qrSection}

      <div class="section">
        <div class="section-title">🏢 Prestador del Servicio Turístico</div>
        <div class="info-row">
          <span class="info-label">Agencia:</span>
          <span class="info-value">${booking.agency.name}</span>
        </div>
        ${booking.agency.razon_social ? `
        <div class="info-row">
          <span class="info-label">Razón social:</span>
          <span class="info-value">${booking.agency.razon_social}</span>
        </div>
        ` : ''}
        ${booking.agency.rfc ? `
        <div class="info-row">
          <span class="info-label">RFC:</span>
          <span class="info-value">${booking.agency.rfc}</span>
        </div>
        ` : ''}
        ${booking.agency.domicilio_fiscal ? `
        <div class="info-row">
          <span class="info-label">Domicilio fiscal:</span>
          <span class="info-value">${booking.agency.domicilio_fiscal}</span>
        </div>
        ` : ''}
        <div class="info-row">
          <span class="info-label">Email:</span>
          <span class="info-value">${booking.agency.contact_email}</span>
        </div>
        ${booking.agency.contact_phone ? `
        <div class="info-row">
          <span class="info-label">Teléfono:</span>
          <span class="info-value">${booking.agency.contact_phone}</span>
        </div>
        ` : ''}
        <p style="color: #6b7280; font-size: 12px; margin-top: 10px; margin-bottom: 0;">
          ToursRed actúa exclusivamente como intermediario digital y comisionista
          mercantil para la publicación, promoción y procesamiento de pago de este
          servicio turístico. La agencia arriba identificada es la única responsable
          de la operación, ejecución y prestación efectiva del servicio.
        </p>
      </div>

      ${(() => {
        const termsUrl = `${platformSettings.platform_url}/terminos-servicio`;
        const lfpcClause = 'Si la reserva se realizó con más de 10 días hábiles de anticipación, aplica el derecho de revocación de 5 días hábiles conforme al Artículo 56 de la LFPC y la NOM-010-TUR.';
        let cancellationText: string;
        if (booking.tour.cancellation_not_allowed) {
          cancellationText = `Este tour es de tipo No Cancelable. No aplica reembolso una vez confirmada la reserva, salvo causas imputables a la agencia o a ToursRed, o por disposición legal aplicable. ${lfpcClause}`;
        } else if (booking.tour.tour_type === 'receptivo') {
          const fh = booking.tour.flexible_hours ?? 48;
          const fp = booking.tour.flexible_refund_percentage ?? 100;
          const mh = booking.tour.moderate_hours ?? 24;
          const mp = booking.tour.moderate_refund_percentage ?? 50;
          cancellationText = `Cancelación con más de ${fh}h de anticipación: reembolso del ${fp}%. Entre ${mh}h y ${fh}h: reembolso del ${mp}%. Con menos de ${mh}h: sin derecho a reembolso. ${lfpcClause}`;
        } else {
          cancellationText = `Cancelaciones con 15 días naturales o más de anticipación: reembolso del 100% en ToursRed Cash. Entre 7 y 14 días: reembolso del 50%. Con menos de 7 días: sin derecho a reembolso. ${lfpcClause}`;
        }
        return `
      <div class="section">
        <div class="section-title">📌 Política de Cancelación</div>
        <p style="color: #374151; font-size: 14px; margin: 0;">${cancellationText}</p>
        <p style="color: #6b7280; font-size: 12px; margin-top: 8px; margin-bottom: 0;">
          Consulta los Términos y Condiciones completos en <a href="${termsUrl}" style="color: #6b7280;">${termsUrl}</a>
        </p>
      </div>`;
      })()}

      <div class="highlight">
        <strong>Importante:</strong> El saldo restante de ${formatCurrency(remainingAmount)} debe ser pagado directamente a la agencia según las condiciones acordadas. Por favor, contacta a la agencia para coordinar los detalles del pago y el viaje.
      </div>

      <p style="margin-top: 30px;">¡Esperamos que tengas un viaje inolvidable!</p>
      <p><strong>El equipo de ToursRed</strong></p>
    </div>
    <div class="footer">
      <p>Si tienes alguna pregunta, no dudes en contactarnos.</p>
    </div>
  </div>
</body>
</html>
    `;

    const agencyEmailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #b8dfe6; padding: 30px 20px; text-align: center; }
    .logo { max-width: 200px; height: auto; margin-bottom: 10px; }
    .content { background-color: #ffffff; padding: 30px 20px; border: 1px solid #e5e7eb; }
    .title { font-size: 24px; font-weight: bold; color: #1e40af; margin-bottom: 20px; }
    .section { margin-bottom: 25px; }
    .section-title { font-weight: bold; color: #1e40af; margin-bottom: 10px; font-size: 16px; }
    .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
    .info-label { color: #6b7280; }
    .info-value { font-weight: 600; }
    .highlight { background-color: #dcfce7; padding: 15px; border-left: 4px solid #16a34a; margin: 20px 0; }
    .total-box { background-color: #dbeafe; padding: 15px; border-radius: 8px; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" class="logo" />
      <h1 style="margin: 0; color: #1e40af;">Nueva Reserva Confirmada</h1>
    </div>
    <div class="content">
      <div class="title">¡Has recibido una nueva reserva!</div>

      <p>Estimado/a ${booking.agency.name},</p>

      <p>Te informamos que se ha confirmado una nueva reserva para uno de tus tours:</p>

      <div class="section">
        <div class="section-title">🎫 Código de Reserva</div>
        <div style="background-color: #dcfce7; padding: 15px; border-radius: 8px; text-align: center; margin-bottom: 20px;">
          <div style="font-size: 12px; color: #166534; margin-bottom: 5px;">Código de referencia</div>
          <div style="font-size: 28px; font-weight: bold; color: #166534; letter-spacing: 2px;">${booking.booking_code}</div>
          <div style="font-size: 12px; color: #166534; margin-top: 5px;">Usa este código para identificar esta reserva</div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">📍 Detalles del Tour</div>
        <div class="info-row">
          <span class="info-label">Tour:</span>
          <span class="info-value">${booking.tour.name}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Destino:</span>
          <span class="info-value">${booking.tour.destination}</span>
        </div>
        ${isReceptivo ? `
        <div class="info-row">
          <span class="info-label">Fecha y horario reservado:</span>
          <span class="info-value">${fechaReservaDisplay}</span>
        </div>
        ` : `
        <div class="info-row">
          <span class="info-label">Fecha de inicio:</span>
          <span class="info-value">${formatDate(booking.tour.start_date)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Fecha de finalización:</span>
          <span class="info-value">${formatDate(booking.tour.end_date)}</span>
        </div>
        `}
        <div class="info-row">
          <span class="info-label">Número de viajeros:</span>
          <span class="info-value">${booking.travelers_count}</span>
        </div>
        ${booking.pickup_type ? `
        <div class="info-row">
          <span class="info-label">Traslado:</span>
          <span class="info-value">${booking.pickup_type === 'meeting_point' ? 'Me presento en el punto de encuentro' : `Recogida en hotel — ${booking.pickup_zone_name || ''}`}</span>
        </div>
        ` : ''}
        ${booking.selected_language ? `
        <div class="info-row">
          <span class="info-label">Idioma del tour:</span>
          <span class="info-value">${booking.selected_language}</span>
        </div>
        ` : ''}
        ${booking.selected_seats && Array.isArray(booking.selected_seats) && booking.selected_seats.length > 0 ? `
        <div class="info-row" style="align-items: flex-start;">
          <span class="info-label">Asientos asignados:</span>
          <span class="info-value" style="display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end;">
            ${[...booking.selected_seats].sort((a: number, b: number) => a - b).map((seat: number) => `
              <span style="display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; background-color: #2563eb; color: white; font-size: 13px; font-weight: 700; border-radius: 8px;">${seat}</span>
            `).join('')}
          </span>
        </div>
        ` : ''}
      </div>

      <div class="section">
        <div class="section-title">💰 Desglose de Costos</div>
        ${booking.adults_count > 0 ? `
        <div class="info-row">
          <span class="info-label">${booking.adults_count} ${booking.adults_count === 1 ? 'Adulto' : 'Adultos'} × ${formatCurrency(booking.adult_price || 0)}:</span>
          <span class="info-value">${formatCurrency((booking.adult_price || 0) * (booking.adults_count || 0))}</span>
        </div>
        ` : ''}
        ${booking.children_count > 0 ? `
        <div class="info-row">
          <span class="info-label">${booking.children_count} ${booking.children_count === 1 ? 'Niño' : 'Niños'} × ${formatCurrency(booking.child_price || 0)}:</span>
          <span class="info-value">${formatCurrency((booking.child_price || 0) * (booking.children_count || 0))}</span>
        </div>
        ` : ''}
        ${booking.infants_count > 0 ? `
        <div class="info-row">
          <span class="info-label">${booking.infants_count} ${booking.infants_count === 1 ? 'Infante' : 'Infantes'} × ${formatCurrency(booking.infant_price || 0)}:</span>
          <span class="info-value">${formatCurrency((booking.infant_price || 0) * (booking.infants_count || 0))}</span>
        </div>
        ` : ''}
        ${booking.seniors_count > 0 ? `
        <div class="info-row">
          <span class="info-label">${booking.seniors_count} ${booking.seniors_count === 1 ? 'Adulto Mayor' : 'Adultos Mayores'} × ${formatCurrency(booking.senior_price || 0)}:</span>
          <span class="info-value">${formatCurrency((booking.senior_price || 0) * (booking.seniors_count || 0))}</span>
        </div>
        ` : ''}
        ${booking.pets_count > 0 ? `
        <div class="info-row">
          <span class="info-label">${booking.pets_count} ${booking.pets_count === 1 ? 'Mascota' : 'Mascotas'} × ${formatCurrency(booking.pet_price || 0)}:</span>
          <span class="info-value">${formatCurrency((booking.pet_price || 0) * (booking.pets_count || 0))}</span>
        </div>
        ` : ''}
        ${pickupExtraCost > 0 ? `
        <div class="info-row">
          <span class="info-label">🚗 Pick Up — ${booking.pickup_zone_name} (${booking.pickup_cost_type === 'por_persona' ? 'por persona' : 'por reserva'}):</span>
          <span class="info-value">${formatCurrency(pickupExtraCost)}</span>
        </div>
        ` : ''}
        ${languageExtraCost > 0 ? `
        <div class="info-row">
          <span class="info-label">🌐 Idioma — ${booking.selected_language} (${booking.language_cost_type === 'por_persona' ? 'por persona' : 'fijo'}):</span>
          <span class="info-value">${formatCurrency(languageExtraCost)}</span>
        </div>
        ` : ''}
        ${promoDiscountAmount > 0 ? `
        <div class="info-row" style="background-color: #dcfce7; margin: 5px -5px; padding: 8px 5px;">
          <span class="info-label" style="font-weight: 600;">🏷️ Descuento Grupal:</span>
          <span class="info-value" style="color: #059669;">-${formatCurrency(promoDiscountAmount)}</span>
        </div>
        ` : ''}
        <div class="info-row" style="border-top: 2px solid #e5e7eb; padding-top: 10px; margin-top: 10px;">
          <span class="info-label" style="font-weight: 700;">Precio Total del Tour:</span>
          <span class="info-value" style="font-weight: 700;">${formatCurrency(totalPrice)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Anticipo pagado por el viajero (${depositPercentage}%):</span>
          <span class="info-value">${formatCurrency(depositAmount)}</span>
        </div>
        ${optionalsHtml}
        ${optionalsTotal > 0 ? `
        <div class="info-row" style="background-color: #f0fdf4; padding: 8px 5px; margin: 5px -5px;">
          <span class="info-label" style="font-weight: 700;">Total cobrado al viajero hoy (anticipo${optionalsTotal > 0 ? ' + opcionales' : ''}):</span>
          <span class="info-value" style="font-weight: 700;">${formatCurrency(userPayment)}</span>
        </div>
        ` : ''}
        ${discountAmount > 0 ? `
        <div class="info-row">
          <span class="info-label">Descuento aplicado al viajero:</span>
          <span class="info-value" style="color: #059669;">-${formatCurrency(discountAmount)}</span>
        </div>
        ` : ''}
        <div class="info-row">
          <span class="info-label">Método de pago utilizado:</span>
          <span class="info-value">${paymentMethod}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Comisión de plataforma (${agencyCommissionPercentage}% del total):</span>
          <span class="info-value" style="color: #dc2626;">-${formatCurrency(agencyCommission)}</span>
        </div>
        <div class="total-box">
          <div style="display: flex; justify-content: space-between; font-size: 18px; font-weight: bold;">
            <span>Monto a depositar a tu cuenta:</span>
            <span style="color: #059669;">${formatCurrency(agencyReceives)}</span>
          </div>
        </div>
        <div class="info-row">
          <span class="info-label">Monto restante que el viajero pagará directamente:</span>
          <span class="info-value">${formatCurrency(remainingAmount)}</span>
        </div>
      </div>

      <div class="section">
        <div class="section-title">👤 Información de Contacto del Viajero</div>
        <div class="info-row">
          <span class="info-label">Nombre:</span>
          <span class="info-value">${booking.traveler.first_name} ${booking.traveler.last_name}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Email:</span>
          <span class="info-value">${booking.traveler.email}</span>
        </div>
        ${booking.traveler.phone_number ? `
        <div class="info-row">
          <span class="info-label">Teléfono:</span>
          <span class="info-value">${booking.traveler.phone_number}</span>
        </div>
        ` : ''}
      </div>

      ${companions.length > 0 ? `
      <div class="section">
        <div class="section-title">👥 Acompañantes</div>
        ${companionsHtml}
      </div>
      ` : ''}

      <div class="highlight">
        <strong>Próximos pasos:</strong><br>
        • El monto de ${formatCurrency(agencyReceives)} será depositado en tu cuenta al completar el tour.<br>
        • El viajero debe pagar el saldo restante de ${formatCurrency(remainingAmount)} directamente a ti según tus políticas.<br>
        • Por favor, contacta al viajero para coordinar los detalles finales del tour.
      </div>

      <p style="margin-top: 30px;"><strong>El equipo de ToursRed</strong></p>
    </div>
    <div class="footer">
      <p>Si tienes alguna pregunta, no dudes en contactarnos.</p>
    </div>
  </div>
</body>
</html>
    `;

    const adminEmailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #b8dfe6; padding: 30px 20px; text-align: center; }
    .logo { max-width: 200px; height: auto; margin-bottom: 10px; }
    .content { background-color: #ffffff; padding: 30px 20px; border: 1px solid #e5e7eb; }
    .title { font-size: 24px; font-weight: bold; color: #1e40af; margin-bottom: 20px; }
    .section { margin-bottom: 25px; }
    .section-title { font-weight: bold; color: #1e40af; margin-bottom: 10px; font-size: 16px; }
    .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
    .info-label { color: #6b7280; }
    .info-value { font-weight: 600; }
    .highlight { background-color: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://huzsedewwzjywcpbkjkm.supabase.co/storage/v1/object/public/images/email-logo.png" alt="ToursRed Logo" class="logo" />
      <h1 style="margin: 0; color: #1e40af;">Resumen de Nueva Reserva</h1>
    </div>
    <div class="content">
      <div class="title">Resumen de Reserva Confirmada</div>

      <p>Se ha procesado una nueva reserva en la plataforma:</p>

      <div class="section">
        <div class="section-title">🎫 Código de Reserva</div>
        <div style="background-color: #dbeafe; padding: 15px; border-radius: 8px; text-align: center; margin-bottom: 20px;">
          <div style="font-size: 12px; color: #1e3a8a; margin-bottom: 5px;">Código de referencia</div>
          <div style="font-size: 28px; font-weight: bold; color: #1e3a8a; letter-spacing: 2px;">${booking.booking_code}</div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">📍 Detalles del Tour</div>
        <div class="info-row">
          <span class="info-label">Tour:</span>
          <span class="info-value">${booking.tour.name}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Destino:</span>
          <span class="info-value">${booking.tour.destination}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Costo del tour:</span>
          <span class="info-value">${formatCurrency(totalPrice)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Porcentaje de anticipo:</span>
          <span class="info-value">${depositPercentage}%</span>
        </div>
        <div class="info-row">
          <span class="info-label">Número de viajeros:</span>
          <span class="info-value">${booking.travelers_count}</span>
        </div>
        ${booking.pickup_type ? `
        <div class="info-row">
          <span class="info-label">Traslado solicitado:</span>
          <span class="info-value">${booking.pickup_type === 'meeting_point' ? 'Se presenta en el punto de encuentro' : `Recogida en hotel — ${booking.pickup_zone_name || ''}`}</span>
        </div>
        ` : ''}
        ${booking.selected_language ? `
        <div class="info-row">
          <span class="info-label">Idioma solicitado:</span>
          <span class="info-value">${booking.selected_language}</span>
        </div>
        ` : ''}
      </div>

      <div class="section">
        <div class="section-title">💰 Desglose Financiero Completo</div>
        ${booking.adults_count > 0 ? `
        <div class="info-row">
          <span class="info-label">${booking.adults_count} ${booking.adults_count === 1 ? 'Adulto' : 'Adultos'} × ${formatCurrency(booking.adult_price || 0)}:</span>
          <span class="info-value">${formatCurrency((booking.adult_price || 0) * (booking.adults_count || 0))}</span>
        </div>
        ` : ''}
        ${booking.children_count > 0 ? `
        <div class="info-row">
          <span class="info-label">${booking.children_count} ${booking.children_count === 1 ? 'Niño' : 'Niños'} × ${formatCurrency(booking.child_price || 0)}:</span>
          <span class="info-value">${formatCurrency((booking.child_price || 0) * (booking.children_count || 0))}</span>
        </div>
        ` : ''}
        ${booking.infants_count > 0 ? `
        <div class="info-row">
          <span class="info-label">${booking.infants_count} ${booking.infants_count === 1 ? 'Infante' : 'Infantes'} × ${formatCurrency(booking.infant_price || 0)}:</span>
          <span class="info-value">${formatCurrency((booking.infant_price || 0) * (booking.infants_count || 0))}</span>
        </div>
        ` : ''}
        ${booking.seniors_count > 0 ? `
        <div class="info-row">
          <span class="info-label">${booking.seniors_count} ${booking.seniors_count === 1 ? 'Adulto Mayor' : 'Adultos Mayores'} × ${formatCurrency(booking.senior_price || 0)}:</span>
          <span class="info-value">${formatCurrency((booking.senior_price || 0) * (booking.seniors_count || 0))}</span>
        </div>
        ` : ''}
        ${booking.pets_count > 0 ? `
        <div class="info-row">
          <span class="info-label">${booking.pets_count} ${booking.pets_count === 1 ? 'Mascota' : 'Mascotas'} × ${formatCurrency(booking.pet_price || 0)}:</span>
          <span class="info-value">${formatCurrency((booking.pet_price || 0) * (booking.pets_count || 0))}</span>
        </div>
        ` : ''}
        ${pickupExtraCost > 0 ? `
        <div class="info-row">
          <span class="info-label">🚗 Pick Up — ${booking.pickup_zone_name} (${booking.pickup_cost_type === 'por_persona' ? 'por persona' : 'por reserva'}):</span>
          <span class="info-value">${formatCurrency(pickupExtraCost)}</span>
        </div>
        ` : ''}
        ${languageExtraCost > 0 ? `
        <div class="info-row">
          <span class="info-label">🌐 Idioma — ${booking.selected_language} (${booking.language_cost_type === 'por_persona' ? 'por persona' : 'fijo'}):</span>
          <span class="info-value">${formatCurrency(languageExtraCost)}</span>
        </div>
        ` : ''}
        ${promoDiscountAmount > 0 ? `
        <div class="info-row" style="background-color: #dcfce7; margin: 5px -5px; padding: 8px 5px;">
          <span class="info-label" style="font-weight: 600;">🏷️ Descuento Grupal:</span>
          <span class="info-value" style="color: #059669;">-${formatCurrency(promoDiscountAmount)}</span>
        </div>
        ` : ''}
        <div class="info-row" style="border-top: 2px solid #e5e7eb; padding-top: 10px; margin-top: 10px;">
          <span class="info-label" style="font-weight: 700;">Precio Total del Tour:</span>
          <span class="info-value" style="font-weight: 700;">${formatCurrency(totalPrice)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Anticipo (${depositPercentage}%):</span>
          <span class="info-value">${formatCurrency(depositAmount)}</span>
        </div>
        ${travelInsuranceCost > 0 || insuranceDiscountAmount > 0 ? `
        <div class="info-row">
          <span class="info-label">🛡️ Seguro de viaje (${insuranceDays} ${insuranceDays === 1 ? 'día' : 'días'} × ${insuranceTravelers} ${insuranceTravelers === 1 ? 'viajero' : 'viajeros'}) (va a aseguradora)${insuranceDiscountAmount > 0 ? ` <span style="text-decoration:line-through;color:#9ca3af;font-size:12px;">${formatCurrency(travelInsuranceCost + insuranceDiscountAmount)}</span>` : ''}:</span>
          <span class="info-value">${travelInsuranceCost === 0 ? 'GRATIS' : formatCurrency(travelInsuranceCost)}</span>
        </div>
        ${insuranceDiscountAmount > 0 ? `<div class="info-row"><span class="info-label" style="color:#059669;">Descuento en seguro (plataforma absorbe):</span><span class="info-value" style="color:#059669;">-${formatCurrency(insuranceDiscountAmount)}</span></div>` : ''}
        ` : ''}
        ${optionalsHtml}
        ${travelInsuranceCost > 0 || insuranceDiscountAmount > 0 || optionalsTotal > 0 ? `
        <div class="info-row" style="background-color: #f0fdf4; padding: 8px 5px; margin: 5px -5px;">
          <span class="info-label" style="font-weight: 700;">Total cobrado al viajero hoy${optionalsTotal > 0 ? ' (anticipo + seguro + opcionales)' : ''}:</span>
          <span class="info-value" style="font-weight: 700;">${formatCurrency(adminTotalCobrado)}</span>
        </div>
        ` : ''}
        ${serviceChargeDiscount > 0 ? `
        <div class="info-row">
          <span class="info-label">Cargo por plataforma (${serviceChargePercentage}%):</span>
          <span class="info-value" style="text-decoration: line-through; color: #9ca3af;">${formatCurrency(serviceCharge + serviceChargeDiscount)}</span>
        </div>
        <div class="info-row" style="background-color: #dcfce7; margin: 5px -5px; padding: 8px 5px;">
          <span class="info-label" style="font-weight: 600;">🏷️ Desc. Cargo por Servicio (código):</span>
          <span class="info-value" style="color: #059669;">-${formatCurrency(serviceChargeDiscount)}</span>
        </div>
        ${serviceCharge > 0 ? `
        <div class="info-row">
          <span class="info-label">Cargo por plataforma (a cobrar):</span>
          <span class="info-value">${formatCurrency(serviceCharge)}</span>
        </div>
        ` : ''}
        ` : serviceCharge > 0 ? `
        <div class="info-row">
          <span class="info-label">Cargo por plataforma (${serviceChargePercentage}%):</span>
          <span class="info-value">${formatCurrency(serviceCharge)}</span>
        </div>
        ` : `
        <div class="info-row">
          <span class="info-label">Cargo por plataforma:</span>
          <span class="info-value" style="color: #059669;">$0.00 (ToursRed Plus)</span>
        </div>
        `}
        ${discountAmount > 0 ? `
        <div class="info-row" style="background-color: #dcfce7; margin: 5px -5px; padding: 8px 5px;">
          <span class="info-label" style="font-weight: 600;">🏷️ Descuento aplicado al viajero:</span>
          <span class="info-value" style="color: #059669;">-${formatCurrency(discountAmount)}</span>
        </div>
        ` : ''}
        ${pointsUsed > 0 ? `
        <div class="info-row" style="background-color: #fef3c7; margin: 5px -5px; padding: 8px 5px;">
          <span class="info-label" style="font-weight: 600;">⭐ Puntos ToursRed Usados:</span>
          <span class="info-value" style="color: #d97706;">-${pointsUsed.toLocaleString('es-MX')} puntos (${formatCurrency(pointsValueUsed)})</span>
        </div>
        ` : ''}
        ${toursRedCashUsed > 0 ? `
        <div class="info-row" style="background-color: #fef3c7; margin: 5px -5px; padding: 8px 5px;">
          <span class="info-label" style="font-weight: 600;">💰 ToursRed Cash Usado:</span>
          <span class="info-value" style="color: #d97706;">-${formatCurrency(toursRedCashUsed)}</span>
        </div>
        ` : ''}
        <div class="info-row" style="border-top: 2px solid #e5e7eb; padding-top: 10px; margin-top: 10px;">
          <span class="info-label" style="font-weight: 700;">Total Cobrado al Viajero:</span>
          <span class="info-value" style="font-weight: 700;">${formatCurrency(userPayment)}</span>
        </div>
        ${(pointsUsed > 0 || toursRedCashUsed > 0) ? `
        <div class="info-row">
          <span class="info-label" style="font-size: 12px;">Desglose de métodos de pago:</span>
          <span class="info-value" style="font-size: 12px; color: #6b7280;">
            ${pointsUsed > 0 && toursRedCashUsed > 0 && stripePayment > 0
              ? `${pointsUsed.toLocaleString('es-MX')} pts + ${formatCurrency(toursRedCashUsed)} Cash + ${formatCurrency(stripePayment)} Stripe`
              : pointsUsed > 0 && stripePayment > 0
                ? `${pointsUsed.toLocaleString('es-MX')} pts + ${formatCurrency(stripePayment)} Stripe`
                : pointsUsed > 0 && toursRedCashUsed > 0
                  ? `${pointsUsed.toLocaleString('es-MX')} pts + ${formatCurrency(toursRedCashUsed)} Cash`
                  : toursRedCashUsed > 0 && stripePayment > 0
                    ? `${formatCurrency(toursRedCashUsed)} Cash + ${formatCurrency(stripePayment)} Stripe`
                    : toursRedCashUsed > 0
                      ? `${formatCurrency(toursRedCashUsed)} Cash`
                      : pointsUsed > 0
                        ? `${pointsUsed.toLocaleString('es-MX')} puntos`
                        : ''
            }
          </span>
        </div>
        ` : ''}
        ${membershipPurchased && membershipCost > 0 ? `
        <div class="info-row" style="background-color: #eff6ff; padding: 8px 5px; margin: 5px -5px;">
          <span class="info-label" style="font-weight: 600;">💎 Membresía ToursRed Plus (${membershipPlan === 'annual' ? 'anual' : 'mensual'}):</span>
          <span class="info-value" style="color: #1e40af;">${formatCurrency(membershipCost)}</span>
        </div>
        ` : ''}
        <div class="info-row">
          <span class="info-label">Comisión de agencia (${agencyCommissionPercentage}%):</span>
          <span class="info-value" style="color: #16a34a;">${formatCurrency(agencyCommission)}</span>
        </div>
        <div class="highlight">
          <div style="display: flex; justify-content: space-between; font-size: 16px; font-weight: bold;">
            <span>Ingresos netos de la plataforma:</span>
            <span style="color: #059669;">${formatCurrency(agencyCommission + serviceCharge + membershipCost + optionalsCommissionTotal + optionalsServiceChargeTotal)}</span>
          </div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 5px;">
            Comisión ${formatCurrency(agencyCommission)} + Cargo ${formatCurrency(serviceCharge)}${membershipCost > 0 ? ` + Membresía ${formatCurrency(membershipCost)}` : ''}${optionalsTotal > 0 ? ` + Opcionales (comisión ${formatCurrency(optionalsCommissionTotal)} + cargo por servicio extras ${formatCurrency(optionalsServiceChargeTotal)})` : ''}
          </div>
        </div>
        <div class="info-row">
          <span class="info-label">Monto a depositar a la agencia:</span>
          <span class="info-value" style="color: #1e40af; font-weight: 700;">${formatCurrency(agencyReceives)}</span>
        </div>
      </div>

      <div class="section">
        <div class="section-title">👤 Información del Viajero</div>
        <div class="info-row">
          <span class="info-label">Nombre:</span>
          <span class="info-value">${booking.traveler.first_name} ${booking.traveler.last_name}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Email:</span>
          <span class="info-value">${booking.traveler.email}</span>
        </div>
        ${booking.traveler.phone_number ? `
        <div class="info-row">
          <span class="info-label">Teléfono:</span>
          <span class="info-value">${booking.traveler.phone_number}</span>
        </div>
        ` : ''}
      </div>

      <div class="section">
        <div class="section-title">🏢 Información de la Agencia</div>
        <div class="info-row">
          <span class="info-label">Agencia:</span>
          <span class="info-value">${booking.agency.name}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Email:</span>
          <span class="info-value">${booking.agency.contact_email}</span>
        </div>
        ${booking.agency.contact_phone ? `
        <div class="info-row">
          <span class="info-label">Teléfono:</span>
          <span class="info-value">${booking.agency.contact_phone}</span>
        </div>
        ` : ''}
        ${booking.agency.cuenta_clabe ? `
        <div class="info-row">
          <span class="info-label">Cuenta CLABE:</span>
          <span class="info-value">${booking.agency.cuenta_clabe}</span>
        </div>
        ` : ''}
        ${booking.agency.banco ? `
        <div class="info-row">
          <span class="info-label">Banco:</span>
          <span class="info-value">${booking.agency.banco}</span>
        </div>
        ` : ''}
        ${booking.agency.titular_cuenta ? `
        <div class="info-row">
          <span class="info-label">Titular:</span>
          <span class="info-value">${booking.agency.titular_cuenta}</span>
        </div>
        ` : ''}
      </div>

      <p style="margin-top: 30px;"><strong>Sistema de ToursRed</strong></p>
    </div>
    <div class="footer">
      <p>Este es un mensaje automático del sistema.</p>
    </div>
  </div>
</body>
</html>
    `;

    const emails = [
      {
        to: booking.traveler.email,
        subject: `¡Reserva Confirmada! - ${booking.tour.name}`,
        html: travelerEmailHtml,
        recipient: "viajero"
      },
      {
        to: booking.agency.contact_email,
        subject: `Nueva Reserva Confirmada - ${booking.tour.name}`,
        html: agencyEmailHtml,
        recipient: "agencia"
      },
      {
        to: "contacto@toursred.com",
        subject: `Resumen de Reserva - ${booking.tour.name}`,
        html: adminEmailHtml,
        recipient: "admin"
      }
    ];

    const emailResults = [];

    for (const email of emails) {
      const emailPayload = {
        api_key: emailSettings.smtp_api_key,
        to: [email.to],
        sender: emailSettings.contact_email,
        subject: email.subject,
        html_body: email.html,
      };

      console.log(`Sending email to ${email.recipient}:`, email.to);

      const response = await fetch("https://api.smtp2go.com/v3/email/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(emailPayload),
      });

      const result = await response.json();

      if (!response.ok || result.data?.error) {
        console.error(`Error sending email to ${email.recipient}:`, result);
        emailResults.push({ recipient: email.recipient, success: false, error: result });
      } else {
        console.log(`Email sent successfully to ${email.recipient}`);
        emailResults.push({ recipient: email.recipient, success: true });
      }
    }

    const allSuccess = emailResults.every(r => r.success);

    if (!allSuccess) {
      await supabase
        .from("bookings")
        .update({ confirmation_email_sent: false })
        .eq("id", booking_id);

      console.log("Reset confirmation_email_sent to false due to email failures for booking:", booking_id);
    }

    // Check and send referral bonus emails
    try {
      const { data: travelerUser } = await supabase
        .from("users")
        .select("referred_by_user_id")
        .eq("id", booking.traveler.id)
        .maybeSingle();

      if (travelerUser?.referred_by_user_id) {
        const { data: relationship } = await supabase
          .from("referral_relationships")
          .select("id, referrer_user_id, referred_user_id, status")
          .eq("referred_user_id", booking.traveler.id)
          .eq("status", "completed")
          .eq("first_booking_id", booking_id)
          .maybeSingle();

        if (relationship) {
          const { data: referrer } = await supabase
            .from("users")
            .select("email, first_name, last_name")
            .eq("id", relationship.referrer_user_id)
            .maybeSingle();

          const { data: referred } = await supabase
            .from("users")
            .select("email, first_name, last_name")
            .eq("id", relationship.referred_user_id)
            .maybeSingle();

          const { data: platformSettingsForBonus } = await supabase
            .from("platform_settings")
            .select("referral_bonus_points")
            .maybeSingle();

          const bonusPoints = platformSettingsForBonus?.referral_bonus_points || 5000;

          if (referrer && referred) {
            const referrerName = [referrer.first_name, referrer.last_name].filter(Boolean).join(" ") || referrer.email;
            const referredName = [referred.first_name, referred.last_name].filter(Boolean).join(" ") || referred.email;

            await Promise.allSettled([
              fetch(`${supabaseUrl}/functions/v1/send-referral-completed-notification`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${supabaseServiceKey}`,
                },
                body: JSON.stringify({
                  referrerEmail: referrer.email,
                  referrerName,
                  referredName,
                  pointsAwarded: bonusPoints,
                  bookingCode: booking.booking_code,
                }),
              }),
              fetch(`${supabaseUrl}/functions/v1/send-referral-completed-notification`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${supabaseServiceKey}`,
                },
                body: JSON.stringify({
                  referrerEmail: referred.email,
                  referrerName: referredName,
                  referredName,
                  pointsAwarded: bonusPoints,
                  bookingCode: booking.booking_code,
                  isReferredUser: true,
                }),
              }),
            ]);
            console.log("Referral bonus emails sent for booking:", booking_id);
          }
        }
      }
    } catch (referralEmailErr) {
      console.error("Error sending referral bonus emails:", referralEmailErr);
    }

    // Send insurance notification to seguros@toursred.com.mx if applicable (only once)
    if (booking.travel_insurance_included && travelInsuranceCost > 0 && !booking.insurance_email_sent) {
      try {
        const isReceptivoTour = !booking.tour.start_date && !booking.tour.end_date;
        const tourStartDate = isReceptivoTour
          ? (booking.selected_date || booking.booking_date)
          : booking.tour.start_date;
        const tourEndDate = isReceptivoTour
          ? (booking.selected_date || booking.booking_date)
          : booking.tour.end_date;

        const startDate = new Date(tourStartDate);
        const endDate = new Date(tourEndDate || tourStartDate);
        const tourDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        const totalTravelers = booking.travelers_count || 1;
        const travelerName = `${booking.traveler.first_name || ''} ${booking.traveler.last_name || ''}`.trim() || booking.traveler.email;

        await fetch(`${supabaseUrl}/functions/v1/send-travel-insurance-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            booking_id,
            booking_code: booking.booking_code,
            tour_name: booking.tour.name,
            tour_start_date: tourStartDate,
            tour_end_date: tourEndDate,
            agency_name: booking.agency.name,
            traveler_name: travelerName,
            traveler_email: booking.traveler.email,
            count_adultos: booking.count_adultos || 0,
            count_ninos: booking.count_ninos || 0,
            count_infantes: booking.count_infantes || 0,
            count_adultos_mayores: booking.count_adultos_mayores || 0,
            total_travelers: totalTravelers,
            tour_days: tourDays,
            insurance_cost: travelInsuranceCost,
            insurance_discount_amount: insuranceDiscountAmount,
            insurance_effective_cost: travelInsuranceCost - insuranceDiscountAmount,
          }),
        });
        console.log("✅ Insurance notification sent to seguros@toursred.com.mx for booking:", booking_id);
      } catch (insuranceErr) {
        console.error("Error sending insurance notification:", insuranceErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: allSuccess,
        message: allSuccess
          ? "Todos los emails de confirmación fueron enviados exitosamente"
          : "Algunos emails no pudieron ser enviados",
        results: emailResults
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in booking confirmation:", error);
    return new Response(
      JSON.stringify({
        error: "Error al procesar la confirmación de reserva",
        details: error.message
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});