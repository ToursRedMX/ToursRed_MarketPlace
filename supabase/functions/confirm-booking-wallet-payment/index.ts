import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { enforceStepUp } from "../_shared/stepUpCheck.ts";

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

    const { p_booking_id, p_points_to_use, p_cash_to_use, p_idempotency_key } = await req.json();

    if (!p_booking_id) {
      return new Response(JSON.stringify({ error: "p_booking_id es requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ownership check: esta funcion ahora es la UNICA linea de defensa para esto,
    // ya que confirm_booking_paid_with_wallet solo la puede llamar service_role
    // (su chequeo interno de auth.uid() ya no aplica en ese contexto).
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, user_id, status")
      .eq("id", p_booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      return new Response(JSON.stringify({ error: "Reserva no encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (booking.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Solo exigir step-up si de verdad se esta gastando wallet o puntos
    if ((p_points_to_use && p_points_to_use > 0) || (p_cash_to_use && p_cash_to_use > 0)) {
      const stepUpBlock = await enforceStepUp(userClient, supabaseServiceKey, supabaseUrl, user.id);
      if (stepUpBlock) return stepUpBlock;
    }

    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "confirm_booking_paid_with_wallet",
      { p_booking_id, p_points_to_use: p_points_to_use || 0, p_cash_to_use: p_cash_to_use || 0, p_idempotency_key }
    );

    if (rpcError) {
      return new Response(JSON.stringify({ success: false, error: rpcError.message }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // El pago 100% con saldo nunca disparaba CFDI ni contabilidad: esta funcion no
    // tenia una sola referencia a ninguno de los dos, a diferencia de los webhooks de
    // Stripe, Openpay, Conekta, MercadoPago y PayPal. Resultado: reservas confirmadas
    // y con asiento, pero sin comprobante fiscal (p.ej. TRG-0DS33SAOP81).
    //
    // Se emite por el monto completo con forma de pago SAT 05 (monedero electronico):
    // el ToursRed Cash es dinero prepagado del viajero, no un descuento.
    //
    // Fire-and-forget con el mismo patron que los otros webhooks: un fallo aqui no debe
    // tumbar la confirmacion del pago, que ya quedo asentada de forma atomica en el RPC.
    if ((rpcResult as { success?: boolean })?.success) {
      try {
        const { data: cfdiSettings } = await supabase
          .from("platform_settings")
          .select("pac_provider")
          .maybeSingle();

        if (cfdiSettings?.pac_provider && cfdiSettings.pac_provider !== "none") {
          EdgeRuntime.waitUntil(
            fetch(`${supabaseUrl}/functions/v1/generate-booking-cfdi`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({ booking_id: p_booking_id, payment_form: "05" }),
            }).catch((e) => console.error("Error triggering booking CFDI (wallet):", e))
          );
        }
      } catch (e) {
        console.error("Error resolving CFDI settings (wallet):", e);
      }

      EdgeRuntime.waitUntil(
        fetch(`${supabaseUrl}/functions/v1/sync-booking-to-accounting`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({ booking_id: p_booking_id }),
        }).catch((e) => console.error("Error syncing booking to accounting (wallet):", e))
      );
    }

    return new Response(JSON.stringify(rpcResult), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
