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

    const { booking_supplement_id } = await req.json();
    if (!booking_supplement_id) {
      return new Response(JSON.stringify({ error: "booking_supplement_id es requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get the supplement request with joins
    const { data: supplementRequest } = await supabase
      .from("booking_supplements")
      .select(`
        id, booking_id, status, quantity, unit_price,
        tour_supplements!inner(id, name, tour_id),
        bookings!inner(id, user_id, status)
      `)
      .eq("id", booking_supplement_id)
      .maybeSingle();

    if (!supplementRequest) {
      return new Response(JSON.stringify({ error: "Solicitud de suplemento no encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if ((supplementRequest.bookings as any)?.status === "cancellation_processing") {
      return new Response(JSON.stringify({ error: "La reserva está en proceso de cancelación" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (supplementRequest.status !== "pending_approval") {
      return new Response(JSON.stringify({ error: `No se puede aprobar. Estado actual: ${supplementRequest.status}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate agency ownership
    const tourId = (supplementRequest.tour_supplements as any)?.tour_id;
    const { data: tour } = await supabase
      .from("tours")
      .select("id, agency_id, agencies!inner(user_id)")
      .eq("id", tourId)
      .maybeSingle();

    const { data: currentUser } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    const isAdmin = ["admin", "super_admin"].includes(currentUser?.role || "");
    const isAgencyOwner = (tour?.agencies as any)?.user_id === user.id;

    let isStaff = false;
    if (!isAdmin && !isAgencyOwner && tour?.agency_id) {
      const { data: staffRecord } = await supabase
        .from("agency_staff")
        .select("id")
        .eq("user_id", user.id)
        .eq("agency_id", tour.agency_id)
        .eq("is_active", true)
        .maybeSingle();
      isStaff = !!staffRecord;
    }

    if (!isAdmin && !isAgencyOwner && !isStaff) {
      return new Response(JSON.stringify({ error: "No tienes permiso para aprobar este suplemento" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const { error: updateError } = await supabase
      .from("booking_supplements")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: user.id,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", booking_supplement_id);

    if (updateError) {
      throw new Error(`Error aprobando suplemento: ${updateError.message}`);
    }

    // Notify traveler
    const travelerId = (supplementRequest.bookings as any)?.user_id;
    const supplementName = (supplementRequest.tour_supplements as any)?.name;
    if (travelerId) {
      await supabase.from("notifications").insert({
        user_id: travelerId,
        type: "supplement_approved",
        title: "Suplemento aprobado",
        message: `Tu solicitud de "${supplementName}" fue aprobada. Tienes 48 horas para completar el pago.`,
        data: { booking_supplement_id, booking_id: supplementRequest.booking_id },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      message: "Suplemento aprobado. El viajero tiene 48 horas para completar el pago.",
      expires_at: expiresAt,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
