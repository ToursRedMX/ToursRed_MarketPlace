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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "No autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { booking_id, tour_supplement_id, quantity } = await req.json();
    if (!booking_id || !tour_supplement_id || !quantity || quantity < 1) {
      return new Response(JSON.stringify({ error: "booking_id, tour_supplement_id y quantity son requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate booking belongs to traveler
    const { data: booking } = await supabase
      .from("bookings")
      .select("id, user_id, tour_id, status")
      .eq("id", booking_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!booking) {
      return new Response(JSON.stringify({ error: "Reserva no encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (booking.status === "cancelled" || booking.status === "cancellation_processing") {
      return new Response(JSON.stringify({ error: "No se pueden agregar suplementos a una reserva cancelada o en proceso de cancelación" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate supplement belongs to the booking's tour and is active
    const { data: supplement } = await supabase
      .from("tour_supplements")
      .select("id, tour_id, name, price, requires_approval, is_active, max_capacity")
      .eq("id", tour_supplement_id)
      .eq("tour_id", booking.tour_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!supplement) {
      return new Response(JSON.stringify({ error: "Suplemento no encontrado o no disponible" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check capacity
    const { data: availableCapacity } = await supabase
      .rpc("get_supplement_available_capacity", { p_supplement_id: tour_supplement_id });

    if (availableCapacity !== null && quantity > availableCapacity) {
      return new Response(JSON.stringify({
        error: `Cupo insuficiente. Solo hay ${availableCapacity} lugar(es) disponible(s)`,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Check for duplicate active (not yet resolved) request
    const { data: existingRequest } = await supabase
      .from("booking_supplements")
      .select("id, status")
      .eq("booking_id", booking_id)
      .eq("tour_supplement_id", tour_supplement_id)
      .in("status", ["pending_approval", "approved", "pending_payment"])
      .maybeSingle();

    if (existingRequest) {
      return new Response(JSON.stringify({
        error: "Ya existe una solicitud activa para este suplemento",
        existing_id: existingRequest.id,
        existing_status: existingRequest.status,
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Determine initial status
    const initialStatus = supplement.requires_approval ? "pending_approval" : "pending_payment";

    // Get platform settings
    const { data: platformSettings } = await supabase
      .from("platform_settings")
      .select("service_charge_percentage, supplement_commission_percentage")
      .maybeSingle();

    const serviceChargePct = platformSettings?.service_charge_percentage ?? 5;
    const supplementCommissionPct = platformSettings?.supplement_commission_percentage ?? 10;
    const subtotal = Number(supplement.price) * quantity;
    const serviceChargeGross = parseFloat((subtotal * serviceChargePct / 100).toFixed(2));
    const supplementCommission = parseFloat((subtotal * supplementCommissionPct / 100).toFixed(2));

    // For pending_payment (no approval required), set a 48-hour payment deadline
    const expiresAt = initialStatus === "pending_payment"
      ? new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
      : null;

    // Create booking_supplement record
    const { data: newRecord, error: insertError } = await supabase
      .from("booking_supplements")
      .insert({
        booking_id,
        tour_supplement_id,
        quantity,
        unit_price: supplement.price,
        service_charge: serviceChargeGross,
        supplement_commission: supplementCommission,
        total_paid: 0,
        status: initialStatus,
        requested_at: new Date().toISOString(),
        ...(expiresAt ? { expires_at: expiresAt } : {}),
      })
      .select()
      .single();

    if (insertError || !newRecord) {
      throw new Error(`Error creando solicitud: ${insertError?.message}`);
    }

    // Notify agency if requires approval
    if (supplement.requires_approval) {
      const { data: tourData } = await supabase
        .from("tours")
        .select("agency_id, agencies!inner(user_id)")
        .eq("id", booking.tour_id)
        .maybeSingle();

      const agencyUserId = (tourData?.agencies as any)?.user_id;
      if (agencyUserId) {
        await supabase.from("notifications").insert({
          user_id: agencyUserId,
          type: "supplement_approval_request",
          title: "Nueva solicitud de suplemento",
          message: `Un viajero ha solicitado ${quantity}x "${supplement.name}". Aprueba o rechaza la solicitud.`,
          data: { booking_supplement_id: newRecord.id, booking_id, supplement_name: supplement.name },
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      booking_supplement_id: newRecord.id,
      status: initialStatus,
      message: supplement.requires_approval
        ? "Solicitud enviada. La agencia revisará y te notificará cuando sea aprobada."
        : "Suplemento listo para pago. Procede a completar el pago.",
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
