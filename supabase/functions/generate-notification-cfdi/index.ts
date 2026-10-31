import "jsr:@supabase/functions-js@2.112.4/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import * as Sentry from "npm:@sentry/deno@9.47.1";
import { authorizeCfdiRequest } from "../_shared/cfdiAuth.ts";
import { registrarFallo, vigilarResultado } from "../_shared/falloSilencioso.ts";

// CFDI de la suscripcion mensual de notificaciones. Se detona con el pago CONFIRMADO (stripe-webhook -> registrarCobro): un
// cobro fallido no factura, y como no hay reembolso tampoco hay nota de credito.
//
// Reglas de Axel (23-oct-2026): ToursRed factura SIEMPRE, a viajeros y a agencias. Sin datos fiscales se emite con el nombre de la
// persona y RFC generico (XAXX010101000, regimen 616, uso S01), como en todos los demas casos. Misma clave de producto/servicio que la
// membresia ToursRed Plus (81161500, unidad E48). El precio de Stripe ya incluye IVA.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    release: Deno.env.get("SENTRY_RELEASE"),
    tracesSampleRate: 0.1,
  });
}

const RFC_GENERICO = "XAXX010101000";

interface CfdiReceptor {
  rfc: string;
  nombre: string;
  domicilio_fiscal_receptor: string;
  regimen_fiscal_receptor: string;
  uso_cfdi: string;
  num_reg_id_trib?: string;
  residencia_fiscal?: string;
}

interface CfdiConcepto {
  clave_prod_serv: string;
  cantidad: number;
  clave_unidad: string;
  descripcion: string;
  valor_unitario: number;
}

interface CfdiRequest {
  tipo_de_comprobante: string;
  serie: string;
  receptor: CfdiReceptor;
  conceptos: CfdiConcepto[];
  payment_form: string;
  idempotency_key?: string;
}

interface CfdiResult {
  pac_invoice_id: string;
  uuid_fiscal: string;
  folio: string;
  serie: string;
  stamped_at: string;
}

async function facturapiStamp(apiKey: string, organizationId: string, request: CfdiRequest): Promise<CfdiResult> {
  const isForeignWithTaxId = request.receptor.rfc === "XEXX010101000" && request.receptor.num_reg_id_trib;
  const effectiveTaxId = isForeignWithTaxId ? request.receptor.num_reg_id_trib! : request.receptor.rfc;

  const address: Record<string, unknown> = { zip: request.receptor.domicilio_fiscal_receptor };
  if (request.receptor.residencia_fiscal) address.country = request.receptor.residencia_fiscal;

  const body: Record<string, unknown> = {
    type: request.tipo_de_comprobante,
    payment_form: request.payment_form,
    payment_method: "PUE",
    customer: {
      legal_name: request.receptor.nombre,
      tax_id: effectiveTaxId,
      tax_system: request.receptor.regimen_fiscal_receptor,
      address,
    },
    use: request.receptor.uso_cfdi,
    ...(request.idempotency_key ? { idempotency_key: request.idempotency_key } : {}),
    items: request.conceptos.map((c) => ({
      product: {
        description: c.descripcion,
        product_key: c.clave_prod_serv,
        unit_key: c.clave_unidad,
        price: c.valor_unitario,
        tax_included: false,
        taxes: [{ type: "IVA", rate: 0.16 }],
      },
      quantity: c.cantidad,
    })),
  };

  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  if (organizationId) headers["X-Organization-Id"] = organizationId;

  const res = await fetch("https://www.facturapi.io/v2/invoices", { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`FacturAPI error ${res.status}: ${await res.text()}`);

  const data = await res.json();
  return {
    pac_invoice_id: data.id,
    uuid_fiscal: data.uuid,
    folio: data.folio_number?.toString() ?? "",
    serie: data.series ?? request.serie,
    stamped_at: data.created_at ?? new Date().toISOString(),
  };
}

function responder(cuerpo: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { payment_transaction_id, stripe_invoice_id } = await req.json();
    if (!payment_transaction_id && !stripe_invoice_id) {
      return responder({ error: "payment_transaction_id o stripe_invoice_id es requerido" }, 400);
    }

    // Sin rama de dueno a proposito: el importe sale de la transaccion cobrada, nunca del cuerpo. Llaman stripe-webhook (al
    // confirmar el pago) y retry-failed-cfdi (admin), ambos con service role.
    const auth = await authorizeCfdiRequest(supabase, req, {
      resource: `el CFDI de la suscripcion de notificaciones ${payment_transaction_id ?? stripe_invoice_id}`,
    });
    if (!auth.allowed) return auth.response;

    const consulta = supabase.from("payment_transactions")
      .select("id, amount, status, charge_reference_id, created_at, metadata")
      .eq("charge_context", "notification_subscription");
    const { data: tx } = await (payment_transaction_id
      ? consulta.eq("id", payment_transaction_id)
      : consulta.eq("metadata->>stripe_invoice_id", stripe_invoice_id)).maybeSingle();
    // Solo un pago confirmado se factura.
    if (!tx || tx.status !== "succeeded") return responder({ error: "Cobro no encontrado o no confirmado" }, 404);

    const invoiceId: string | null = tx.metadata?.stripe_invoice_id ?? null;
    if (!invoiceId) return responder({ error: "El cobro no trae su factura de Stripe" }, 422);

    // Idempotencia: un cobro, un CFDI. Un intento en 'error' se REUSA (si no, cada reintento dejaria otro registro y el viejo
    // seguiria apareciendo como pendiente de reintentar para siempre).
    const { data: previo } = await supabase.from("cfdi_invoices")
      .select("id, status, retry_count")
      .eq("invoice_type", "notification_subscription").eq("stripe_invoice_id", invoiceId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (previo && (previo.status === "stamped" || previo.status === "pending")) {
      return responder({ message: "CFDI already exists for this charge", cfdi_id: previo.id }, 200);
    }

    const { data: sub } = await supabase.from("suscripciones_notificaciones")
      .select("id, tipo, user_id, agency_id, current_period_start").eq("id", tx.charge_reference_id).maybeSingle();
    if (!sub) return responder({ error: "Suscripcion no encontrada" }, 404);

    const { data: settings } = await supabase.from("platform_settings")
      .select("pac_provider, pac_organization_id, cfdi_serie_booking, pac_issuer_postal_code").maybeSingle();
    const { data: secrets } = await supabase.from("platform_secrets").select("pac_api_key_encrypted").maybeSingle();
    const pacApiKey = secrets?.pac_api_key_encrypted || null;

    if (!settings || settings.pac_provider === "none" || !pacApiKey) return responder({ error: "PAC provider not configured" }, 422);
    if (settings.pac_provider !== "facturapi") return responder({ error: "Facturapi es el único PAC habilitado" }, 409);

    const issuerPostalCode = settings.pac_issuer_postal_code || "";
    if (!issuerPostalCode) {
      return responder({ error: "Debe configurar el código postal fiscal de la plataforma en Configuración antes de generar CFDIs" }, 422);
    }

    // --- Receptor: con datos fiscales completos se usan; si no, RFC generico con el nombre de la persona (siempre se factura) ---
    let receptor: CfdiReceptor;
    let agencyId: string | null = null;

    if (sub.tipo === "agencia") {
      agencyId = sub.agency_id;
      const { data: agencia } = await supabase.from("agencies")
        .select("name, user_id, rfc, razon_social, regimen_fiscal, postal_code").eq("id", sub.agency_id).maybeSingle();
      const { data: dueno } = agencia?.user_id
        ? await supabase.from("users").select("regimen_fiscal, uso_cfdi").eq("id", agencia.user_id).maybeSingle()
        : { data: null };
      const razon = agencia?.razon_social || agencia?.name || "";
      const codigoPostal = agencia?.postal_code || issuerPostalCode;
      if (agencia?.rfc && agencia.rfc.length >= 12) {
        receptor = {
          rfc: agencia.rfc,
          nombre: razon || agencia.rfc,
          domicilio_fiscal_receptor: codigoPostal,
          regimen_fiscal_receptor: agencia.regimen_fiscal || dueno?.regimen_fiscal || "626",
          uso_cfdi: dueno?.uso_cfdi || "G03",
        };
      } else {
        receptor = { rfc: RFC_GENERICO, nombre: razon || "SIN NOMBRE", domicilio_fiscal_receptor: codigoPostal, regimen_fiscal_receptor: "616", uso_cfdi: "S01" };
      }
    } else {
      const { data: viajero } = await supabase.from("users")
        .select("first_name, last_name, rfc, razon_social, regimen_fiscal, uso_cfdi, codigo_postal_fiscal, is_foreign_traveler, num_reg_id_trib, residencia_fiscal")
        .eq("id", sub.user_id).maybeSingle();
      const nombreCompleto = [viajero?.first_name, viajero?.last_name].filter(Boolean).join(" ").trim();
      if (viajero?.rfc && viajero.rfc.length >= 12) {
        receptor = {
          rfc: viajero.rfc,
          nombre: viajero.razon_social || nombreCompleto || viajero.rfc,
          domicilio_fiscal_receptor: viajero.codigo_postal_fiscal || issuerPostalCode,
          regimen_fiscal_receptor: viajero.regimen_fiscal || "616",
          uso_cfdi: viajero.uso_cfdi || "S01",
        };
      } else if (viajero?.is_foreign_traveler === true && viajero.num_reg_id_trib) {
        receptor = {
          rfc: "XEXX010101000", nombre: nombreCompleto || "EXTRANJERO", domicilio_fiscal_receptor: issuerPostalCode,
          regimen_fiscal_receptor: "616", uso_cfdi: "S01", num_reg_id_trib: viajero.num_reg_id_trib,
          ...(viajero.residencia_fiscal ? { residencia_fiscal: viajero.residencia_fiscal } : {}),
        };
      } else {
        receptor = { rfc: RFC_GENERICO, nombre: nombreCompleto || "SIN NOMBRE", domicilio_fiscal_receptor: issuerPostalCode, regimen_fiscal_receptor: "616", uso_cfdi: "S01" };
      }
    }

    // --- Importes: el precio cobrado ya incluye IVA. Mismo calculo que la membresia: IVA como complemento, subtotal + IVA = total ---
    const total = Math.round(Number(tx.amount) * 100) / 100;
    if (!(total > 0)) return responder({ error: "El cobro no tiene un importe facturable" }, 422);
    const iva = Math.round(total * 16 / 116 * 100) / 100;
    const subtotal = Math.round((total - iva) * 100) / 100;
    // 6 decimales en el valor unitario: FacturAPI calcula el IVA sobre el neto exacto y evita el error de un centavo en el XML.
    const valorUnitario = Math.round((total / 1.16) * 1000000) / 1000000;

    const periodo = new Date(sub.current_period_start ?? tx.created_at)
      .toLocaleDateString("es-MX", { month: "long", year: "numeric", timeZone: "America/Mexico_City" });
    const serie = (settings.cfdi_serie_booking || "A") + "N";

    const cfdiRequest: CfdiRequest = {
      tipo_de_comprobante: "I",
      serie,
      receptor,
      // Pago con tarjeta por Stripe: forma de pago 04 (tarjeta de credito). OJO: la membresia ToursRed Plus usa 03 por omision.
      payment_form: "04",
      conceptos: [{
        clave_prod_serv: "81161500", // misma clave que ToursRed Plus
        cantidad: 1,
        clave_unidad: "E48",
        descripcion: `Suscripcion de notificaciones ToursRed - ${periodo}`,
        valor_unitario: valorUnitario,
      }],
    };

    const campos = {
      invoice_type: "notification_subscription",
      suscripcion_notificacion_id: sub.id,
      agency_id: agencyId,
      stripe_invoice_id: invoiceId,
      pac_provider: settings.pac_provider,
      serie,
      receptor_rfc: receptor.rfc,
      receptor_razon_social: receptor.nombre,
      receptor_regimen_fiscal: receptor.regimen_fiscal_receptor,
      receptor_uso_cfdi: receptor.uso_cfdi,
      receptor_codigo_postal: receptor.domicilio_fiscal_receptor,
      subtotal,
      iva_amount: iva,
      total,
      status: "pending",
      error_message: null,
    };

    let cfdiId: string;
    let reintentos = 0;
    if (previo) {
      const { error } = await supabase.from("cfdi_invoices").update(campos).eq("id", previo.id);
      if (error) throw new Error(`No se pudo reabrir el CFDI en error: ${error.message}`);
      cfdiId = previo.id;
      reintentos = previo.retry_count ?? 0;
    } else {
      const { data: nuevo, error } = await supabase.from("cfdi_invoices").insert(campos).select("id, retry_count").single();
      if (error || !nuevo) throw new Error(`Failed to create CFDI record: ${error?.message}`);
      cfdiId = nuevo.id;
      reintentos = nuevo.retry_count ?? 0;
    }

    cfdiRequest.idempotency_key = cfdiId;
    let resultado: CfdiResult;
    try {
      resultado = await facturapiStamp(pacApiKey, settings.pac_organization_id || "", cfdiRequest);
    } catch (errTimbrado) {
      await supabase.from("cfdi_invoices")
        .update({ status: "error", error_message: String(errTimbrado), retry_count: reintentos + 1 }).eq("id", cfdiId);
      return responder({ error: "PAC stamping failed", detail: String(errTimbrado) }, 502);
    }

    const { error: errGuardado } = await supabase.from("cfdi_invoices").update({
      pac_invoice_id: resultado.pac_invoice_id,
      uuid_fiscal: resultado.uuid_fiscal,
      folio: resultado.folio,
      serie: resultado.serie,
      stamped_at: resultado.stamped_at,
      status: "stamped",
      payment_method_sat: "PUE",
      error_message: null,
    }).eq("id", cfdiId);
    if (errGuardado) throw new Error(`No se pudo persistir el CFDI timbrado: ${errGuardado.message}`);

    // El comprobante viaja por correo al viajero o a la agencia (fire and forget).
    EdgeRuntime.waitUntil(
      supabase.functions.invoke("send-cfdi-email", {
        body: { cfdi_invoice_id: cfdiId, recipient_type: sub.tipo === "agencia" ? "agency" : "traveler" },
      }).then((r: unknown) => vigilarResultado(r, "generate-notification-cfdi -> send-cfdi-email"))
        .catch((e: unknown) => registrarFallo("generate-notification-cfdi -> send-cfdi-email", e)),
    );

    return responder({ success: true, cfdi_id: cfdiId, uuid_fiscal: resultado.uuid_fiscal }, 200);
  } catch (err) {
    if (sentryDsn) {
      Sentry.captureException(err, {
        tags: { execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown", region: Deno.env.get("SB_REGION") || "unknown" },
      });
      await Sentry.flush(2000);
    }
    return responder({ error: String(err) }, 500);
  }
});
