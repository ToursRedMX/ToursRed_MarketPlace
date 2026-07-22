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

    const { booking_id } = await req.json();
    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id is required" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: settings } = await supabase
      .from("platform_settings")
      .select("accounting_provider, accounting_sync_enabled")
      .maybeSingle();

    if (!settings?.accounting_sync_enabled || settings.accounting_provider === "none") {
      return new Response(JSON.stringify({ skipped: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Internal ERP: call DB function directly — no external adapter needed
    if (settings.accounting_provider === "internal") {
      // Idempotency: check if entry already exists for this booking
      const { data: existingEntry } = await supabase
        .from("accounting_entries")
        .select("id")
        .eq("booking_id", booking_id)
        .maybeSingle();

      if (existingEntry?.id) {
        return new Response(JSON.stringify({ success: true, skipped: true, entry_id: existingEntry.id }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: entryId, error: rpcError } = await supabase
        .rpc("create_accounting_entry_for_booking", { p_booking_id: booking_id });

      if (rpcError) {
        console.error("Internal accounting RPC failed:", rpcError);
        return new Response(JSON.stringify({ error: `Internal accounting RPC failed: ${rpcError.message}` }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true, entry_id: entryId, provider: "internal" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Query separada para evitar ambiguedad de multiples FK a users
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, total_price, service_charge, booking_code, created_at, payment_provider, user_id, tour_id")
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      return new Response(JSON.stringify({ error: `Booking not found: ${bookingError?.message || booking_id}` }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Obtener datos del viajero por separado
    const { data: traveler, error: travelerError } = await supabase
      .from("users")
      .select("id, first_name, last_name, email, rfc, razon_social, regimen_fiscal, uso_cfdi, codigo_postal_fiscal")
      .eq("id", booking.user_id)
      .maybeSingle();

    if (travelerError || !traveler) {
      return new Response(JSON.stringify({ error: `Traveler not found: ${travelerError?.message || booking.user_id}` }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const travelerFullName = `${traveler.first_name || ""} ${traveler.last_name || ""}`.trim() || "Sin nombre";

    // Obtener datos del tour y agencia por separado
    const { data: tour, error: tourError } = await supabase
      .from("tours")
      .select("name, agency_id")
      .eq("id", booking.tour_id)
      .maybeSingle();

    if (tourError || !tour) {
      return new Response(JSON.stringify({ error: `Tour not found: ${tourError?.message || booking.tour_id}` }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: agency } = await supabase
      .from("agencies")
      .select("id, rfc, razon_social, regimen_fiscal, postal_code")
      .eq("id", tour.agency_id)
      .maybeSingle();

    // En edición México, Zoho requiere RFC para emitir facturas (CFDI).
    // Reservas de viajeros sin RFC se registran como contacto genérico "PUBLICO EN GENERAL".
    const travelerName = traveler.rfc
      ? (traveler.razon_social || travelerFullName)
      : "PUBLICO EN GENERAL";
    const travelerRfc = traveler.rfc || "XAXX010101000";

    // Verificar si esta reserva ya fue sincronizada como journal — no duplicar transacciones
    const { data: existingBookingLog } = await supabase
      .from("accounting_sync_log")
      .select("external_entity_id, external_entity_type")
      .eq("provider", settings.accounting_provider)
      .eq("record_type", "booking")
      .eq("record_id", booking_id)
      .eq("status", "synced")
      .maybeSingle();

    if (existingBookingLog?.external_entity_id) {
      return new Response(JSON.stringify({
        success: true,
        skipped: true,
        journal_external_id: existingBookingLog.external_entity_id,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existingTravelerLog } = await supabase
      .from("accounting_sync_log")
      .select("external_entity_id")
      .eq("provider", settings.accounting_provider)
      .eq("record_type", "contact_traveler")
      .eq("record_id", traveler.id)
      .eq("status", "synced")
      .maybeSingle();

    let travelerExternalId = existingTravelerLog?.external_entity_id;

    if (!travelerExternalId) {
      const contactRes = await supabase.functions.invoke("sync-to-accounting", {
        body: {
          action: "sync_contact",
          record_type: "contact_traveler",
          record_id: traveler.id,
          data: {
            id: traveler.id,
            type: "traveler",
            name: travelerName,
            email: traveler.email,
            rfc: travelerRfc,
            razon_social: travelerName,
            regimen_fiscal: traveler.regimen_fiscal,
            codigo_postal: traveler.codigo_postal_fiscal,
          },
        },
      });

      if (contactRes.error) throw new Error(`Failed to sync traveler contact: ${contactRes.error.message}`);
      if (contactRes.data?.error) throw new Error(`Failed to sync traveler contact: ${contactRes.data.error}`);
      travelerExternalId = contactRes.data?.external_entity_id;
    }

    if (!travelerExternalId) {
      throw new Error("Could not obtain external contact ID for traveler");
    }

    const total = Number(booking.total_price);
    const serviceCharge = Number(booking.service_charge ?? 0);
    const subtotal = Math.round((total / 1.16) * 100) / 100;
    const iva = Math.round((total - subtotal) * 100) / 100;
    const tourSubtotal = Math.round(((total - serviceCharge) / 1.16) * 100) / 100;
    const svcSubtotal = serviceCharge > 0
      ? Math.round((serviceCharge / 1.16) * 100) / 100
      : 0;

    const journalRes = await supabase.functions.invoke("sync-to-accounting", {
      body: {
        action: "sync_journal",
        record_id: booking_id,
        data: {
          id: booking_id,
          customer_id: travelerExternalId,
          date: new Date(booking.created_at).toISOString().split("T")[0],
          currency: "MXN",
          reference: booking.booking_code || booking_id,
          notes: `Reserva: ${tour.name}. Agencia: ${agency?.razon_social || ""}`,
          tour_subtotal: tourSubtotal,
          service_subtotal: svcSubtotal,
          iva_total: iva,
          total,
        },
      },
    });

    if (journalRes.error) throw new Error(`Failed to sync journal: ${journalRes.error.message}`);
    if (journalRes.data?.error) throw new Error(`Failed to sync journal: ${journalRes.data.error}`);

    return new Response(
      JSON.stringify({ success: true, journal_external_id: journalRes.data?.external_entity_id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("sync-booking-to-accounting error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
