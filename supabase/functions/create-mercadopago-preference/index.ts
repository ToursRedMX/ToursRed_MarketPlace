import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as Sentry from "npm:@sentry/deno@9";

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    tracesSampleRate: 0.1,
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ---------------------------------------------------------------------------
// Checklist de calidad de MercadoPago: telefono, direccion e identificacion del
// comprador alimentan su motor antifraude y suben la tasa de aprobacion. Los
// tres son opcionales en el perfil, asi que cada helper devuelve null cuando no
// hay dato util: omitir el campo es mejor que mandarlo vacio o a medias.
// ---------------------------------------------------------------------------

type PerfilPayer = {
  first_name?: string | null;
  last_name?: string | null;
  phone_number?: string | null;
  street?: string | null;
  postal_code?: string | null;
  curp?: string | null;
  rfc?: string | null;
};

/**
 * Parte un telefono mexicano en area_code + number, que es como los pide la API
 * de Preferencias. En la base conviven dos formatos (verificado el 04-sep-2026):
 * 10 digitos y 12 con lada de pais. Tambien se contempla el formato viejo de
 * celular "+52 1 ..." (13 digitos), retirado en 2019 pero que sigue vivo en
 * datos cargados hace tiempo. Las ladas de CDMX (55 y 56), Guadalajara (33) y
 * Monterrey (81) son de dos digitos; el resto del pais usa tres.
 */
function partirTelefonoMx(raw: string | null): { area_code: string; number: string } | null {
  if (!raw) return null;
  let digitos = raw.replace(/\D/g, "");
  if (digitos.length === 13 && digitos.startsWith("521")) digitos = digitos.slice(3);
  if (digitos.length === 12 && digitos.startsWith("52")) digitos = digitos.slice(2);
  if (digitos.length === 11 && digitos.startsWith("1")) digitos = digitos.slice(1);
  if (digitos.length !== 10) return null;
  const corte = ["55", "56", "33", "81"].includes(digitos.slice(0, 2)) ? 2 : 3;
  return { area_code: digitos.slice(0, corte), number: digitos.slice(corte) };
}

/**
 * MercadoPago Mexico acepta CURP y RFC como tipos de identificacion. Se prefiere
 * CURP: es la identificacion de persona fisica, que es quien paga, y es la que
 * mas usuarios tienen cargada (6 de 11 contra 1 con RFC, al 04-sep-2026).
 */
function identificacionPayer(perfil: PerfilPayer | null): { type: string; number: string } | null {
  const curp = perfil?.curp?.trim();
  if (curp) return { type: "CURP", number: curp.toUpperCase() };
  const rfc = perfil?.rfc?.trim();
  if (rfc) return { type: "RFC", number: rfc.toUpperCase() };
  return null;
}

/**
 * El perfil guarda la calle en un solo campo de texto y MercadoPago la quiere
 * partida, asi que se separa el numero final cuando lo hay ("Av. Reforma 123"
 * -> "Av. Reforma" + "123"). Sin codigo postal no se manda nada: es el dato que
 * su antifraude realmente cruza, y una direccion sin CP no le sirve.
 */
function partirDireccion(
  street: string | null,
  postalCode: string | null
): Record<string, string> | null {
  const cp = postalCode?.replace(/\D/g, "");
  if (!cp) return null;
  const direccion: Record<string, string> = { zip_code: cp };
  const calle = street?.trim();
  if (calle) {
    const partes = calle.match(/^(.*?)[\s,]+(\d+[A-Za-z]?)$/);
    if (partes) {
      direccion.street_name = partes[1].trim();
      direccion.street_number = partes[2];
    } else {
      direccion.street_name = calle;
    }
  }
  return direccion;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { bookingId, supplementId, customerEmail, amount, description, context, deviceId } = await req.json();

    let authedUser: { id: string; email?: string } | null = null;

    if (context !== "gift_card") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "No autorizado" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: { user }, error: userError } = await supabase.auth.getUser(
        authHeader.replace("Bearer ", "")
      );
      if (userError || !user) {
        return new Response(JSON.stringify({ error: "No autorizado" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      authedUser = user;
    }

    if (!amount) {
      return new Response(JSON.stringify({ error: "Datos incompletos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (context === "extras") {
      return new Response(JSON.stringify({
        error: "Contexto 'extras' no soportado. Use purchase-post-booking-extras para extras.",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (context !== "supplement" && !bookingId) {
      return new Response(JSON.stringify({ error: "Datos incompletos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");

    const { data: platformSettings } = await supabase
      .from("platform_settings")
      .select("mercadopago_public_key, platform_url")
      .maybeSingle();
    const { data: secrets } = await supabase
      .from("platform_secrets")
      .select("mercadopago_access_token")
      .maybeSingle();

    if (!mpAccessToken && secrets?.mercadopago_access_token) {
      mpAccessToken = secrets.mercadopago_access_token;
    }

    if (!mpAccessToken) {
      return new Response(JSON.stringify({ error: "MercadoPago no configurado" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Always use the configured platform URL for back_urls so MercadoPago receives
    // a valid public HTTPS domain instead of the local dev/webcontainer URL.
    const origin = platformSettings?.platform_url?.replace(/\/$/, "") || "https://toursred.com";

    // Server-side amount validation: calculate the real amount from the database
    // instead of trusting the client-supplied amount
    let serverAmount: number | null = null;

    if (context === "gift_card") {
      const { data: gc, error: gcErr } = await supabase
        .from("gift_cards")
        .select("amount, discount_amount, payment_status")
        .eq("id", bookingId)
        .maybeSingle();

      if (gcErr || !gc) {
        return new Response(JSON.stringify({ error: "Tarjeta de regalo no encontrada" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (gc.payment_status === "paid") {
        return new Response(JSON.stringify({ error: "Esta tarjeta de regalo ya fue pagada" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      serverAmount = Number(gc.amount) - Number(gc.discount_amount || 0);
      if (serverAmount <= 0) {
        return new Response(JSON.stringify({ error: "Monto de gift card inválido" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else if (context === "supplement" && supplementId) {
      const { data: supplement } = await supabase
        .from("booking_supplements")
        .select("total_paid")
        .eq("id", supplementId)
        .maybeSingle();
      if (supplement?.total_paid) {
        serverAmount = Number(supplement.total_paid);
      }
    } else if (bookingId) {
      const { data: booking } = await supabase
        .from("bookings")
        .select("amount_due_now, deposit_amount, payment_status")
        .eq("id", bookingId)
        .maybeSingle();
      if (booking) {
        // Ver nota en create-openpay-checkout: el techo es el exigible, no el anticipo.
        const depositAmount = booking.amount_due_now != null
          ? Number(booking.amount_due_now)
          : Number(booking.deposit_amount || 0);
        if (booking.payment_status === "succeeded") {
          return new Response(JSON.stringify({ error: "La reserva ya esta pagada" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const { data: existingPayments } = await supabase
          .from("payment_transactions")
          .select("amount")
          .eq("booking_id", bookingId)
          .eq("status", "succeeded")
          .eq("payment_processor", "mercadopago");
        const alreadyPaid = (existingPayments || []).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
        const remainingBalanceMp = Math.max(0, depositAmount - alreadyPaid);

        if (remainingBalanceMp <= 0) {
          return new Response(JSON.stringify({ error: "Esta reserva ya está pagada en su totalidad" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const requestedAmountMp = amount != null ? Number(amount) : null;
        if (requestedAmountMp != null && requestedAmountMp > 0) {
          if (requestedAmountMp > remainingBalanceMp + 0.5) {
            return new Response(JSON.stringify({ error: `El monto excede el saldo restante de ${remainingBalanceMp.toFixed(2)} MXN` }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          serverAmount = requestedAmountMp;
        } else {
          serverAmount = remainingBalanceMp;
        }
      }
    }

    if (serverAmount === null) {
      return new Response(JSON.stringify({ error: "No se pudo determinar el monto a cobrar" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validatedAmount = Math.round(serverAmount * 100) / 100;

    let items: any[] = [];
    let successUrl = "";
    let cancelUrl = "";

    if (context === "gift_card") {
      items = [
        {
          id: bookingId,
          title: description || "Tarjeta de Regalo ToursRed",
          description: "Tarjeta de regalo valida por 1 ano",
          category_id: "virtual_goods",
          quantity: 1,
          unit_price: validatedAmount,
          currency_id: "MXN",
        },
      ];
      successUrl = `${origin}/gift-card/success?gift_card_id=${bookingId}&provider=mercadopago`;
      cancelUrl = `${origin}/gift-cards`;
    } else if (context === "supplement") {
      items = [
        {
          id: supplementId,
          title: description || "Suplemento - ToursRed",
          description: "Pago de suplemento para reserva",
          category_id: "travels",
          quantity: 1,
          unit_price: validatedAmount,
          currency_id: "MXN",
        },
      ];
      successUrl = `${origin}/payment-return?provider=mercadopago&booking_supplement_id=${supplementId}&tr_status=success`;
      cancelUrl = `${origin}/traveler/bookings`;
    } else {
      items = [
        {
          id: bookingId,
          title: description || "Deposito de Reserva - ToursRed",
          description: "Deposito para reserva de tour",
          category_id: "travels",
          quantity: 1,
          unit_price: validatedAmount,
          currency_id: "MXN",
        },
      ];
      successUrl = `${origin}/payment-return?provider=mercadopago&booking_id=${bookingId}&tr_status=success`;
      cancelUrl = `${origin}/payment-return?provider=mercadopago&booking_id=${bookingId}&tr_status=cancel`;
    }

    let mpPublicKey = Deno.env.get("MERCADOPAGO_PUBLIC_KEY");
    if (!mpPublicKey && platformSettings?.mercadopago_public_key) {
      mpPublicKey = platformSettings.mercadopago_public_key;
    }

    const externalReference = context === "supplement" ? supplementId : bookingId;
    const pendingUrl = context === "supplement"
      ? `${origin}/payment-return?provider=mercadopago&booking_supplement_id=${supplementId}&tr_status=pending`
      : `${origin}/payment-return?provider=mercadopago&booking_id=${bookingId}&tr_status=pending`;

    // Checklist de calidad de MercadoPago: payer.email, payer.first_name y
    // payer.last_name alimentan su motor antifraude y suben la tasa de
    // aprobacion. Antes solo se mandaba el email, y solo si el front lo incluia.
    let perfilPayer: PerfilPayer | null = null;

    if (authedUser) {
      const { data: payerProfile } = await supabase
        .from("users")
        .select("first_name, last_name, phone_number, street, postal_code, curp, rfc")
        .eq("id", authedUser.id)
        .maybeSingle();
      perfilPayer = payerProfile ?? null;
    }

    const payer: Record<string, unknown> = {};
    const payerEmail = customerEmail || authedUser?.email || null;
    if (payerEmail) payer.email = payerEmail;
    // Ojo con los nombres de campo: la API de Preferencias usa "name" y
    // "surname", no "first_name"/"last_name" como pide el checklist de calidad.
    // Mandar los equivocados no da error: MercadoPago los descarta en silencio y
    // devuelve name y surname vacios (verificado contra la API el 03-sep-2026).
    if (perfilPayer?.first_name) payer.name = perfilPayer.first_name;
    if (perfilPayer?.last_name) payer.surname = perfilPayer.last_name;

    const telefonoPayer = partirTelefonoMx(perfilPayer?.phone_number ?? null);
    if (telefonoPayer) payer.phone = telefonoPayer;

    const identificacion = identificacionPayer(perfilPayer);
    if (identificacion) payer.identification = identificacion;

    const direccionPayer = partirDireccion(
      perfilPayer?.street ?? null,
      perfilPayer?.postal_code ?? null
    );
    if (direccionPayer) payer.address = direccionPayer;

    // La preferencia vive 24 horas. Es holgado de sobra para un checkout que se
    // abre en el momento, y evita que un link viejo reviva el cobro de una
    // reserva que mientras tanto se cancelo o se pago por otro medio.
    const creadaEn = new Date();
    const venceEn = new Date(creadaEn.getTime() + 24 * 60 * 60 * 1000);
    const isoConOffset = (d: Date) => d.toISOString().replace("Z", "+00:00");

    const preferencePayload = {
      items,
      payer: Object.keys(payer).length > 0 ? payer : undefined,
      back_urls: {
        success: successUrl,
        failure: cancelUrl,
        pending: pendingUrl,
      },
      auto_return: "approved",
      external_reference: externalReference,
      notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mercadopago-webhook`,
      statement_descriptor: "TOURSRED",
      binary_mode: false,
      expires: true,
      expiration_date_from: isoConOffset(creadaEn),
      expiration_date_to: isoConOffset(venceEn),
      payment_methods: {
        excluded_payment_types: [{ id: "ticket" }],
        // Tope de cuotas. Sin este campo MercadoPago ofrece el maximo que
        // permita cada tarjeta. Acotarlo no le cuesta nada al vendedor: los
        // intereses de las cuotas los paga el comprador.
        installments: 12,
      },
    };

    const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mpAccessToken}`,
        // Device ID de security.js. MercadoPago lo usa para afinar su evaluacion
        // antifraude y rechazar menos pagos legitimos.
        ...(deviceId ? { "X-meli-session-id": String(deviceId) } : {}),
      },
      body: JSON.stringify(preferencePayload),
    });

    if (!mpResponse.ok) {
      const errorBody = await mpResponse.text();
      console.error("MercadoPago API error:", errorBody);
      return new Response(JSON.stringify({ error: "Error al crear preferencia de MercadoPago" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const preference = await mpResponse.json();

    return new Response(
      JSON.stringify({
        success: true,
        url: preference.init_point,
        preference_id: preference.id,
        public_key: mpPublicKey || null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Error in create-mercadopago-preference:", err);
    if (sentryDsn) {
      Sentry.captureException(err, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return new Response(JSON.stringify({ error: err.message || "Error interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
