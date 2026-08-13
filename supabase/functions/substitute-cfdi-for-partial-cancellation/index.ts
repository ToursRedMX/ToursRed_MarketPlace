import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface CfdiConcepto {
  clave_prod_serv: string;
  cantidad: number;
  clave_unidad: string;
  descripcion: string;
  valor_unitario: number;
  tercero?: {
    rfc: string;
    nombre: string;
    regimen_fiscal: string;
    domicilio_fiscal: string;
  } | null;
}

interface CfdiReceptor {
  rfc: string;
  nombre: string;
  domicilio_fiscal_receptor: string;
  regimen_fiscal_receptor: string;
  uso_cfdi: string;
  num_reg_id_trib?: string;
  residencia_fiscal?: string;
}

interface CfdiRequest {
  tipo_de_comprobante: string;
  serie: string;
  receptor: CfdiReceptor;
  conceptos: CfdiConcepto[];
  payment_form?: string;
  related_documents?: { relationship: string; cfdi_uuids: string[] }[];
}

interface CfdiResult {
  pac_invoice_id: string;
  uuid_fiscal: string;
  folio: string;
  serie: string;
  xml_url: string;
  pdf_url: string;
  stamped_at: string;
}

const r6 = (n: number) => Math.round(n * 1000000) / 1000000;

async function facturapiStamp(
  apiKey: string,
  orgId: string,
  request: CfdiRequest
): Promise<CfdiResult> {
  const baseUrl = "https://www.facturapi.io/v2";

  const isForeignWithTaxId = request.receptor.rfc === "XEXX010101000" && request.receptor.num_reg_id_trib;
  const effectiveTaxId = isForeignWithTaxId ? request.receptor.num_reg_id_trib! : request.receptor.rfc;

  const address: Record<string, unknown> = { zip: request.receptor.domicilio_fiscal_receptor };
  if (request.receptor.residencia_fiscal) address.country = request.receptor.residencia_fiscal;

  const customer: Record<string, unknown> = {
    legal_name: request.receptor.nombre,
    tax_id: effectiveTaxId,
    tax_system: request.receptor.regimen_fiscal_receptor,
    address,
  };

  const body: Record<string, unknown> = {
    type: request.tipo_de_comprobante,
    payment_form: request.payment_form ?? "03",
    payment_method: "PUE",
    customer,
    use: request.receptor.uso_cfdi,
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
      ...(c.tercero && c.tercero.domicilio_fiscal
        ? {
            third_party: {
              tax_id: c.tercero.rfc,
              legal_name: c.tercero.nombre,
              tax_system: c.tercero.regimen_fiscal,
              zip: c.tercero.domicilio_fiscal,
            },
          }
        : {}),
    })),
  };

  if (request.related_documents && request.related_documents.length > 0) {
    body.related_documents = request.related_documents.map((rd) => ({
      relationship: rd.relationship,
      documents: rd.cfdi_uuids,
    }));
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (orgId) headers["X-Organization-Id"] = orgId;

  const res = await fetch(`${baseUrl}/invoices`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FacturAPI error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return {
    pac_invoice_id: data.id,
    uuid_fiscal: data.uuid,
    folio: data.folio_number?.toString() ?? "",
    serie: data.series ?? request.serie,
    xml_url: `${baseUrl}/invoices/${data.id}/xml`,
    pdf_url: `${baseUrl}/invoices/${data.id}/pdf`,
    stamped_at: data.created_at ?? new Date().toISOString(),
  };
}

function resolveReceptor(traveler: any): {
  rfc: string; nombre: string; regimen: string; usoCfdi: string; cp: string;
  numRegIdTrib?: string; residenciaFiscal?: string;
} {
  const fullName = [traveler?.first_name, traveler?.last_name].filter(Boolean).join(" ").trim();
  const isForeign = traveler?.is_foreign_traveler === true;
  const issuerPostalCode = "06600";

  if (traveler?.rfc && traveler.rfc.length >= 12) {
    return {
      rfc: traveler.rfc,
      nombre: traveler.razon_social || fullName || traveler.rfc,
      regimen: traveler.regimen_fiscal || "616",
      usoCfdi: traveler.uso_cfdi || "S01",
      cp: traveler.codigo_postal_fiscal || issuerPostalCode,
    };
  }
  if (isForeign && traveler?.num_reg_id_trib) {
    return {
      rfc: "XEXX010101000",
      nombre: fullName || "EXTRANJERO",
      regimen: "616",
      usoCfdi: "S01",
      cp: issuerPostalCode,
      numRegIdTrib: traveler.num_reg_id_trib,
      residenciaFiscal: traveler.residencia_fiscal,
    };
  }
  return {
    rfc: "XAXX010101000",
    nombre: fullName || "SIN NOMBRE",
    regimen: "616",
    usoCfdi: "S01",
    cp: issuerPostalCode,
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

    const { booking_id, partial_cancellation_id } = await req.json();

    if (!booking_id || !partial_cancellation_id) {
      return new Response(
        JSON.stringify({ error: "booking_id and partial_cancellation_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: existingSustitutos } = await supabase
      .from("cfdi_invoices")
      .select("id, status")
      .eq("booking_partial_cancellation_id", partial_cancellation_id)
      .eq("tipo_relacion", "04")
      .in("status", ["stamped", "pending"]);

    if (existingSustitutos && existingSustitutos.length > 0) {
      return new Response(
        JSON.stringify({ success: true, message: "Sustituto CFDIs already exist", count: existingSustitutos.length }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        id, booking_code, user_id, total_price, deposit_amount,
        travel_insurance_included, travel_insurance_cost,
        tours (name),
        agencies (id, rfc, razon_social, regimen_fiscal, codigo_postal_fiscal)
      `)
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: activeTravelers } = await supabase
      .from("booking_travelers")
      .select("precio_aplicado")
      .eq("booking_id", booking_id)
      .eq("is_cancelled", false);

    const { count: totalOriginalCount } = await supabase
      .from("booking_travelers")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", booking_id);

    const activeTravelersPrecioSum = (activeTravelers || []).reduce(
      (sum: number, t: any) => sum + Number(t.precio_aplicado), 0
    );
    const activeTravelerCount = activeTravelers?.length || 0;
    const totalPrice = Number(booking.total_price) || 0;
    const depositAmount = Number(booking.deposit_amount) || totalPrice;
    const insuranceCost = Number(booking.travel_insurance_cost) || 0;
    const insuranceIncluded = booking.travel_insurance_included === true;
    const totalOriginalTravelerCount = totalOriginalCount || 1;

    if (totalPrice <= 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No total_price to calculate ratios from" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: stampedCfdis } = await supabase
      .from("cfdi_invoices")
      .select(`
        id, uuid_fiscal, pac_invoice_id, invoice_type, serie, subtotal, iva_amount, total,
        receptor_rfc, receptor_razon_social, receptor_regimen_fiscal, receptor_uso_cfdi,
        receptor_codigo_postal, booking_payment_plan_transaction_id, tipo_relacion,
        booking_payment_plan_transactions ( amount )
      `)
      .eq("booking_id", booking_id)
      .eq("status", "stamped")
      .in("invoice_type", ["booking", "booking_installment"])
      .order("created_at", { ascending: true });

    if (!stampedCfdis || stampedCfdis.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No stamped CFDIs to substitute" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: settings } = await supabase
      .from("platform_settings")
      .select("pac_provider, pac_api_key_encrypted, pac_organization_id, cfdi_serie_booking, cfdi_serie_installment")
      .maybeSingle();

    if (!settings || !settings.pac_api_key_encrypted) {
      return new Response(
        JSON.stringify({ error: "PAC not configured" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: traveler } = await supabase
      .from("users")
      .select("first_name, last_name, rfc, razon_social, regimen_fiscal, uso_cfdi, codigo_postal_fiscal, is_foreign_traveler, num_reg_id_trib, residencia_fiscal")
      .eq("id", booking.user_id)
      .maybeSingle();

    const rec = resolveReceptor(traveler);
    const tourName = (booking as any).tours?.name || "";
    const bookingCode = booking.booking_code || booking_id;

    const agency = (booking as any).agencies;
    const needsTercero = agency?.rfc && agency.rfc !== rec.rfc;
    if (needsTercero && (!agency.regimen_fiscal || !agency.codigo_postal_fiscal)) {
      return new Response(
        JSON.stringify({
          error: "La agencia debe completar su régimen fiscal y código postal en su expediente antes de poder facturar a cuenta de terceros.",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const terceroAgencia = needsTercero && agency?.codigo_postal_fiscal
      ? {
          rfc: agency.rfc,
          nombre: agency.razon_social || "Agencia",
          regimen_fiscal: agency.regimen_fiscal,
          domicilio_fiscal: agency.codigo_postal_fiscal,
        }
      : null;

    const tourRatio = activeTravelersPrecioSum / totalPrice;
    const insuranceRatio = totalOriginalTravelerCount > 0
      ? activeTravelerCount / totalOriginalTravelerCount
      : 1;

    let successCount = 0;
    let failureCount = 0;

    for (const originalCfdi of stampedCfdis) {
      const isDeposit = originalCfdi.invoice_type === "booking";
      const isInstallment = originalCfdi.invoice_type === "booking_installment";

      if (!isDeposit && !isInstallment) continue;

      let newTourAmount: number;
      let newSeguroAmount = 0;

      if (isDeposit) {
        newTourAmount = depositAmount * tourRatio;
        if (insuranceIncluded && insuranceCost > 0) {
          newSeguroAmount = insuranceCost * insuranceRatio;
        }
      } else {
        const txnAmount = Number((originalCfdi as any).booking_payment_plan_transactions?.amount) || 0;
        if (txnAmount <= 0) {
          console.warn(`Installment CFDI ${originalCfdi.id} has no transaction amount, skipping`);
          failureCount++;
          continue;
        }
        newTourAmount = txnAmount * tourRatio;
      }

      const conceptos: CfdiConcepto[] = [];

      conceptos.push({
        clave_prod_serv: "90121500",
        cantidad: 1,
        clave_unidad: "E48",
        descripcion: isDeposit
          ? `${tourName} (Reserva ${bookingCode}) — Depósito`
          : `${tourName} (Reserva ${bookingCode}) — Parcialidad`,
        valor_unitario: r6(newTourAmount / 1.16),
        tercero: terceroAgencia,
      });

      if (newSeguroAmount > 0) {
        conceptos.push({
          clave_prod_serv: "90111500",
          cantidad: 1,
          clave_unidad: "E48",
          descripcion: `Seguro de viaje — ${tourName} (Reserva ${bookingCode})`,
          valor_unitario: r6(newSeguroAmount / 1.16),
          tercero: terceroAgencia,
        });
      }

      // Preserve non-tour, non-seguro concepts (penalty, service charge) from the CFDI
      // being substituted. Works for both original CFDIs and chained sustitutos by using
      // the same subtraction logic: total of the CFDI minus the tour and seguro amounts
      // that CFDI specifically represented.
      const originalTourAmount = isInstallment
        ? (Number((originalCfdi as any).booking_payment_plan_transactions?.amount) || 0)
        : depositAmount;
      const originalSeguroAmount = (isDeposit && insuranceIncluded) ? insuranceCost : 0;
      const nonTourNonSeguro = Math.max(0,
        Number(originalCfdi.total) - originalTourAmount - originalSeguroAmount
      );

      if (nonTourNonSeguro > 0) {
        conceptos.push({
          clave_prod_serv: "81141600",
          cantidad: 1,
          clave_unidad: "E48",
          descripcion: `Cargo por servicio y penalizaciones conservados — ${tourName} (Reserva ${bookingCode})`,
          valor_unitario: r6(nonTourNonSeguro / 1.16),
        });
      }

      if (conceptos.length === 0) continue;

      const conceptosTotal = conceptos.reduce(
        (sum, c) => sum + c.valor_unitario * c.cantidad * 1.16, 0
      );
      const iva = Math.round(conceptosTotal * 16 / 116 * 100) / 100;
      const subtotal = Math.round((conceptosTotal - iva) * 100) / 100;
      const total = Math.round(conceptosTotal * 100) / 100;

      const serieToUse = isInstallment
        ? (settings.cfdi_serie_installment || "AI")
        : (settings.cfdi_serie_booking || "A");

      const cfdiRequest: CfdiRequest = {
        tipo_de_comprobante: "I",
        serie: serieToUse,
        receptor: {
          rfc: rec.rfc,
          nombre: rec.nombre,
          domicilio_fiscal_receptor: rec.cp,
          regimen_fiscal_receptor: rec.regimen,
          uso_cfdi: rec.usoCfdi,
          ...(rec.numRegIdTrib ? { num_reg_id_trib: rec.numRegIdTrib } : {}),
          ...(rec.residenciaFiscal ? { residencia_fiscal: rec.residenciaFiscal } : {}),
        },
        conceptos,
        payment_form: "03",
        related_documents: [{ relationship: "04", cfdi_uuids: [originalCfdi.uuid_fiscal!] }],
      };

      const { data: sustitutoRecord, error: insertError } = await supabase
        .from("cfdi_invoices")
        .insert({
          invoice_type: originalCfdi.invoice_type,
          booking_id,
          booking_partial_cancellation_id: partial_cancellation_id,
          related_cfdi_invoice_id: originalCfdi.id,
          tipo_relacion: "04",
          booking_payment_plan_transaction_id: originalCfdi.booking_payment_plan_transaction_id || null,
          pac_provider: settings.pac_provider,
          serie: serieToUse,
          receptor_rfc: rec.rfc,
          receptor_razon_social: rec.nombre,
          receptor_regimen_fiscal: rec.regimen,
          receptor_uso_cfdi: rec.usoCfdi,
          receptor_codigo_postal: rec.cp,
          cfdi_type: "I",
          subtotal,
          iva_amount: iva,
          total,
          currency: "MXN",
          status: "pending",
        })
        .select()
        .single();

      if (insertError || !sustitutoRecord) {
        console.error(`Failed to create sustituto CFDI record: ${insertError?.message}`);
        failureCount++;
        continue;
      }

      let cfdiResult: CfdiResult;
      try {
        cfdiResult = await facturapiStamp(
          settings.pac_api_key_encrypted!,
          settings.pac_organization_id || "",
          cfdiRequest
        );
      } catch (stampError) {
        const stampErrStr = String(stampError);
        console.error(`Sustituto CFDI stamping failed for ${originalCfdi.id}: ${stampErrStr}`);
        await supabase
          .from("cfdi_invoices")
          .update({ status: "error", error_message: stampErrStr })
          .eq("id", sustitutoRecord.id);
        failureCount++;
        continue;
      }

      await supabase
        .from("cfdi_invoices")
        .update({
          pac_invoice_id: cfdiResult.pac_invoice_id,
          uuid_fiscal: cfdiResult.uuid_fiscal,
          folio: cfdiResult.folio,
          serie: cfdiResult.serie,
          xml_url: cfdiResult.xml_url,
          pdf_url: cfdiResult.pdf_url,
          stamped_at: cfdiResult.stamped_at,
          status: "stamped",
          error_message: null,
        })
        .eq("id", sustitutoRecord.id);

      try {
        await supabase.functions.invoke("cancel-cfdi", {
          body: {
            cfdi_invoice_id: originalCfdi.id,
            motivo: "01",
            uuid_sustitucion: cfdiResult.uuid_fiscal,
            cancellation_id: partial_cancellation_id,
          },
        });
      } catch (cancelErr) {
        console.error(`Error cancelling original CFDI ${originalCfdi.id} (no crítico):`, cancelErr);
      }

      EdgeRuntime.waitUntil(
        supabase.functions.invoke("send-cfdi-email", {
          body: { cfdi_invoice_id: sustitutoRecord.id, recipient_type: "traveler" },
        }).catch(() => {})
      );

      successCount++;
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: stampedCfdis.length,
        succeeded: successCount,
        failed: failureCount,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
