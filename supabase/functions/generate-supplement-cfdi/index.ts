import { calculateTaxBreakdown, type TaxTreatment } from "../_shared/taxBreakdown.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as Sentry from "npm:@sentry/deno@9";
import { authorizeCfdiRequest } from "../_shared/cfdiAuth.ts";

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
    tracesSampleRate: 0.1,
  });
}

interface CfdiConcepto {
  clave_prod_serv: string;
  cantidad: number;
  clave_unidad: string;
  descripcion: string;
  valor_unitario: number;
  descuento?: number;
  tercero?: { rfc: string; nombre: string; regimen_fiscal: string; domicilio_fiscal: string };
  /**
   * Concepto exento de IVA (Art. 15 fr. XIII LIVA). Vive en la interfaz
   * PAC-agnostica, no en el adaptador: el codigo que arma conceptos no deberia
   * saber que PAC esta configurado.
   *
   * OJO con valor_unitario: en un concepto GRAVADO es el NETO (bruto/1.16,
   * porque tax_included es false). En uno EXENTO es el importe COMPLETO.
   * Dividir un exento entre 1.16 desaparece dinero del CFDI.
   */
  exento?: boolean;
}

interface CfdiRequest {
  tipo_de_comprobante: string;
  serie: string;
  receptor: {
    rfc: string; nombre: string; domicilio_fiscal_receptor: string;
    regimen_fiscal_receptor: string; uso_cfdi: string;
    num_reg_id_trib?: string; residencia_fiscal?: string;
  };
  conceptos: CfdiConcepto[];
  payment_form?: string;
}

interface CfdiResult {
  pac_invoice_id: string; uuid_fiscal: string; folio: string;
  serie: string; stamped_at: string;
}

const r6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

async function facturapiStamp(apiKey: string, organizationId: string, request: CfdiRequest): Promise<CfdiResult> {
  const baseUrl = "https://www.facturapi.io/v2";
  const isForeign = request.receptor.rfc === "XEXX010101000" && request.receptor.num_reg_id_trib;
  const effectiveTaxId = isForeign ? request.receptor.num_reg_id_trib! : request.receptor.rfc;

  const address: Record<string, unknown> = { zip: request.receptor.domicilio_fiscal_receptor };
  if (request.receptor.residencia_fiscal) address.country = request.receptor.residencia_fiscal;

  const body: Record<string, unknown> = {
    type: request.tipo_de_comprobante,
    series: request.serie,
    payment_form: request.payment_form ?? "03",
    payment_method: "PUE",
    customer: {
      legal_name: request.receptor.nombre,
      tax_id: effectiveTaxId,
      tax_system: request.receptor.regimen_fiscal_receptor,
      address,
    },
    use: request.receptor.uso_cfdi,
    items: request.conceptos.map((c) => ({
      product: {
        description: c.descripcion,
        product_key: c.clave_prod_serv,
        unit_key: c.clave_unidad,
        price: c.valor_unitario,
        tax_included: false,
        taxes: c.exento
          ? [{ type: "IVA", factor: "Exento", rate: 0 }]
          : [{ type: "IVA", rate: 0.16 }],
      },
      quantity: c.cantidad,
      ...(c.descuento != null && c.descuento > 0 ? { discount: c.descuento } : {}),
      ...(c.tercero?.domicilio_fiscal
        ? { third_party: { tax_id: c.tercero.rfc, legal_name: c.tercero.nombre, tax_system: c.tercero.regimen_fiscal, zip: c.tercero.domicilio_fiscal } }
        : {}),
    })),
  };

  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  if (organizationId) headers["X-Organization-Id"] = organizationId;

  const res = await fetch(`${baseUrl}/invoices`, { method: "POST", headers, body: JSON.stringify(body) });
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { booking_supplement_id, payment_form } = await req.json();
    if (!booking_supplement_id) {
      return new Response(JSON.stringify({ error: "booking_supplement_id es requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency: check if CFDI already exists
    const { data: existingCfdi } = await supabase
      .from("cfdi_invoices")
      .select("id, status")
      .eq("booking_supplement_id", booking_supplement_id)
      .eq("invoice_type", "supplement")
      .in("status", ["stamped", "pending"])
      .maybeSingle();

    if (existingCfdi) {
      return new Response(JSON.stringify({ message: "CFDI ya existe", cfdi_id: existingCfdi.id }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load supplement with full context
    const { data: suppReq, error: suppError } = await supabase
      .from("booking_supplements")
      .select(`
        id, booking_id, quantity, unit_price, service_charge, membership_exemption_used,
        total_paid, payment_method, status, tax_treatment, exempt_ratio,
        tour_supplements!inner(id, name, tour_id),
        bookings!inner(id, user_id, tour_id)
      `)
      .eq("id", booking_supplement_id)
      .maybeSingle();

    if (suppError || !suppReq) {
      return new Response(JSON.stringify({ error: "Suplemento no encontrado", detail: suppError?.message }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (suppReq.status !== "paid") {
      return new Response(JSON.stringify({ error: "Solo se puede emitir CFDI para suplementos pagados" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tourId = (suppReq.tour_supplements as any)?.tour_id;
    const userId = (suppReq.bookings as any)?.user_id;

    // --- Autorizacion ---
    // Los importes salen de booking_supplements (ya validado status = paid),
    // no del body, asi que el dueno de la reserva puede pedir su propio CFDI.
    const auth = await authorizeCfdiRequest(supabase, req, {
      ownerUserId: userId ?? null,
      resource: `el suplemento ${booking_supplement_id}`,
    });
    if (!auth.allowed) return auth.response;

    // Load agency data
    const { data: tourData } = await supabase
      .from("tours")
      .select("agency_id")
      .eq("id", tourId)
      .maybeSingle();

    let agencyData: { id: string; rfc?: string; razon_social?: string; regimen_fiscal?: string; postal_code?: string } | null = null;
    if (tourData?.agency_id) {
      const { data: ag } = await supabase
        .from("agencies")
        .select("id, rfc, razon_social, regimen_fiscal, postal_code")
        .eq("id", tourData.agency_id)
        .maybeSingle();
      agencyData = ag;
    }

    // Load traveler fiscal data
    const { data: traveler } = await supabase
      .from("users")
      .select("id, first_name, last_name, rfc, razon_social, regimen_fiscal, uso_cfdi, codigo_postal_fiscal, is_foreign_traveler, num_reg_id_trib, residencia_fiscal")
      .eq("id", userId)
      .maybeSingle();

    // Load PAC settings
    const { data: settings } = await supabase
      .from("platform_settings")
      .select("pac_provider, pac_organization_id, cfdi_serie_booking, pac_sandbox_mode, pac_issuer_rfc, pac_issuer_razon_social, pac_issuer_regimen_fiscal, pac_issuer_postal_code")
      .maybeSingle();

    const { data: secrets } = await supabase
      .from("platform_secrets")
      .select("pac_api_key_encrypted")
      .maybeSingle();
    const pacApiKey = secrets?.pac_api_key_encrypted || null;

    if (!settings || settings.pac_provider === "none" || !pacApiKey) {
      return new Response(JSON.stringify({ error: "PAC no configurado" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Amounts
    const subtotal_supp = Number(suppReq.unit_price) * suppReq.quantity;
    const netServiceCharge = Number(suppReq.service_charge);
    const exactTotal = Number(suppReq.total_paid);

    // Desglose fiscal del SUPLEMENTO segun su propio snapshot, congelado al
    // cobrarse. Independiente del tour y de los servicios opcionales.
    // NULL = cobro anterior a la feature -> 16% implicito.
    // BUG PREEXISTENTE CORREGIDO: el desglose del CONCEPTO se calcula sobre el
    // precio UNITARIO, no sobre subtotal_supp (que ya es unit_price * quantity).
    // Como el concepto lleva `cantidad: quantity`, FacturAPI vuelve a
    // multiplicar: con quantity=2 el CFDI amparaba 400.00 habiendose cobrado
    // 200.00. El desglose para la BD (mas abajo) SI va sobre el total, porque
    // ahi se registra el importe completo del suplemento.
    const suppTaxCfdi = calculateTaxBreakdown({
      grossAmount: Number(suppReq.unit_price),
      taxTreatment: ((suppReq as { tax_treatment?: TaxTreatment }).tax_treatment ?? "taxable_16"),
      exemptRatio: Number((suppReq as { exempt_ratio?: number | string }).exempt_ratio ?? 0),
      decimals: 6,
    });

    const precioSuplemento = suppTaxCfdi.taxableBase;
    const precioServicio = netServiceCharge > 0 ? r6(netServiceCharge / 1.16) : 0;

    // DB amounts: el IVA del suplemento sale de su desglose (puede ser cero si
    // esta exento); el del cargo por servicio SIEMPRE es 16% porque es
    // operacion propia de ToursRed, ajena al tratamiento de lo que se vende.
    const suppTaxDb = calculateTaxBreakdown({
      grossAmount: subtotal_supp,
      taxTreatment: ((suppReq as { tax_treatment?: TaxTreatment }).tax_treatment ?? "taxable_16"),
      exemptRatio: Number((suppReq as { exempt_ratio?: number | string }).exempt_ratio ?? 0),
    });
    const ivaServicio = netServiceCharge > 0
      ? Math.round((netServiceCharge - netServiceCharge / 1.16) * 100) / 100
      : 0;
    const iva = Math.round((suppTaxDb.vatAmount + ivaServicio) * 100) / 100;
    const subtotal_db = Math.round((exactTotal - iva) * 100) / 100;

    // Build receptor
    const issuerPostalCode = settings.pac_issuer_postal_code || "";
    if (!issuerPostalCode) {
      return new Response(
        JSON.stringify({ error: "Debe configurar el código postal fiscal de la plataforma en Configuración antes de generar CFDIs" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const fullName = [traveler?.first_name, traveler?.last_name].filter(Boolean).join(" ").trim();
    const isForeign = traveler?.is_foreign_traveler === true;

    let receptorRfc: string, receptorNombre: string, receptorRegimen: string,
      receptorUsoCfdi: string, receptorCP: string,
      receptorNumRegIdTrib: string | undefined, receptorResidenciaFiscal: string | undefined;

    if (traveler?.rfc && traveler.rfc.length >= 12) {
      receptorRfc = traveler.rfc;
      receptorNombre = traveler.razon_social || fullName || traveler.rfc;
      receptorRegimen = traveler.regimen_fiscal || "616";
      receptorUsoCfdi = traveler.uso_cfdi || "S01";
      receptorCP = traveler.codigo_postal_fiscal || issuerPostalCode;
    } else if (isForeign && traveler?.num_reg_id_trib) {
      receptorRfc = "XEXX010101000";
      receptorNombre = fullName || "EXTRANJERO";
      receptorRegimen = "616"; receptorUsoCfdi = "S01"; receptorCP = issuerPostalCode;
      receptorNumRegIdTrib = traveler.num_reg_id_trib;
      if (traveler?.residencia_fiscal) receptorResidenciaFiscal = traveler.residencia_fiscal;
    } else {
      receptorRfc = "XAXX010101000";
      receptorNombre = fullName || "SIN NOMBRE";
      receptorRegimen = "616"; receptorUsoCfdi = "S01"; receptorCP = issuerPostalCode;
    }

    // Agency tercero
    let terceroAgencia: CfdiConcepto["tercero"] | undefined;
    if (agencyData?.rfc && agencyData?.razon_social && agencyData.rfc !== receptorRfc && agencyData.rfc !== settings.pac_issuer_rfc) {
      if (!agencyData.regimen_fiscal || !agencyData.postal_code) {
        return new Response(
          JSON.stringify({
            error: "La agencia debe completar su régimen fiscal y código postal en su expediente antes de poder facturar a cuenta de terceros.",
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      terceroAgencia = {
        rfc: agencyData.rfc,
        nombre: agencyData.razon_social,
        regimen_fiscal: agencyData.regimen_fiscal,
        domicilio_fiscal: agencyData.postal_code,
      };
    }

    const supplementName = (suppReq.tour_supplements as any)?.name || "Suplemento";
    const suppRef = booking_supplement_id.slice(0, 8).toUpperCase();
    const serie = (settings.cfdi_serie_booking || "A") + "S";
    const effectivePaymentForm = payment_form || "03";

    const conceptos: CfdiConcepto[] = [];

    if (suppTaxCfdi.taxableBase > 0) {
      conceptos.push({
        clave_prod_serv: "90121500",
        cantidad: suppReq.quantity,
        clave_unidad: "E48",
        descripcion: `Suplemento adicional: ${supplementName} (Ref. ${suppRef})`,
        valor_unitario: precioSuplemento,
        tercero: terceroAgencia,
      });
    }

    // Parte exenta: importe COMPLETO (no hay IVA que separar) y con
    // ACuentaTerceros igual que la gravada — atribucion de ingreso a la
    // agencia para ISR, independiente de si causa IVA.
    if (suppTaxCfdi.exemptAmount > 0) {
      conceptos.push({
        clave_prod_serv: "90121500",
        cantidad: suppReq.quantity,
        clave_unidad: "E48",
        descripcion: `Suplemento adicional: ${supplementName} (Ref. ${suppRef})`,
        valor_unitario: suppTaxCfdi.exemptAmount,
        exento: true,
        tercero: terceroAgencia,
      });
    }

    if (precioServicio > 0) {
      conceptos.push({
        clave_prod_serv: "81141600",
        cantidad: 1,
        clave_unidad: "E48",
        descripcion: `Cargo por servicio de plataforma - Suplemento (Ref. ${suppRef})`,
        valor_unitario: precioServicio,
      });
    }

    const cfdiRequest: CfdiRequest = {
      tipo_de_comprobante: "I",
      serie,
      receptor: {
        rfc: receptorRfc, nombre: receptorNombre,
        domicilio_fiscal_receptor: receptorCP,
        regimen_fiscal_receptor: receptorRegimen,
        uso_cfdi: receptorUsoCfdi,
        ...(receptorNumRegIdTrib ? { num_reg_id_trib: receptorNumRegIdTrib } : {}),
        ...(receptorResidenciaFiscal ? { residencia_fiscal: receptorResidenciaFiscal } : {}),
      },
      conceptos,
      payment_form: effectivePaymentForm,
    };

    // Create pending CFDI record — reuse cfdi_invoices table with invoice_type='supplement'
    // booking_id field is repurposed to store booking_supplement_id for supplements
    const { data: cfdiRecord, error: insertError } = await supabase
      .from("cfdi_invoices")
      .insert({
        invoice_type: "supplement",
        booking_id: suppReq.booking_id,
        booking_supplement_id: booking_supplement_id,
        agency_id: agencyData?.id || null,
        pac_provider: settings.pac_provider,
        serie,
        receptor_rfc: receptorRfc,
        receptor_razon_social: receptorNombre,
        receptor_regimen_fiscal: receptorRegimen,
        receptor_uso_cfdi: receptorUsoCfdi,
        receptor_codigo_postal: receptorCP,
        subtotal: subtotal_db,
        iva_amount: iva,
        total: exactTotal,
        status: "pending",
      })
      .select()
      .single();

    if (insertError || !cfdiRecord) {
      throw new Error(`Error creando registro CFDI: ${insertError?.message}`);
    }

    // Update supplement with cfdi_invoice_id
    await supabase.from("booking_supplements")
      .update({ cfdi_invoice_id: cfdiRecord.id, updated_at: new Date().toISOString() })
      .eq("id", booking_supplement_id);

    // Stamp with PAC (only facturapi for now; zoho follows same pattern as booking CFDI)
    let cfdiResult: CfdiResult;
    try {
      if (settings.pac_provider !== "facturapi") {
        throw new Error(`PAC ${settings.pac_provider} no soportado aún para suplementos. Usa facturapi.`);
      }
      cfdiResult = await facturapiStamp(
        pacApiKey!,
        settings.pac_organization_id || "",
        cfdiRequest
      );
    } catch (stampError) {
      await supabase.from("cfdi_invoices").update({
        status: "error",
        error_message: String(stampError),
        retry_count: cfdiRecord.retry_count + 1,
      }).eq("id", cfdiRecord.id);

      return new Response(JSON.stringify({ error: "Error al timbrar CFDI", detail: String(stampError) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("cfdi_invoices").update({
      pac_invoice_id: cfdiResult.pac_invoice_id,
      uuid_fiscal: cfdiResult.uuid_fiscal,
      folio: cfdiResult.folio,
      serie: cfdiResult.serie,
      stamped_at: cfdiResult.stamped_at,
      status: "stamped",
      error_message: null,
    }).eq("id", cfdiRecord.id);

    // Send email notification async
    EdgeRuntime.waitUntil(
      supabase.functions.invoke("send-cfdi-email", {
        body: { cfdi_invoice_id: cfdiRecord.id, recipient_type: "traveler" },
      }).catch(() => {})
    );

    return new Response(JSON.stringify({
      success: true,
      cfdi_id: cfdiRecord.id,
      uuid_fiscal: cfdiResult.uuid_fiscal,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    if (sentryDsn) {
      Sentry.captureException(err, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
