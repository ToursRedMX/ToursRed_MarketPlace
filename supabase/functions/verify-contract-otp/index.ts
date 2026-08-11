import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import type { ContractData, AnexoBData } from "../_shared/contractDocDefinition.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MAX_OTP_ATTEMPTS = 5;

// Las fuentes Roboto (~700KB base64), contractDocDefinition (~130KB) y
// pdfmake se cargan TODOS de forma perezosa via dynamic import() dentro
// del try de generación de PDF. Esto evita que el runtime procese ~1MB
// de módulos en CADA arranque en frío — solo se cargan cuando de verdad
// se necesita el PDF, después de validar el OTP. Esto corrige el 503
// intermitente en boot que veíamos en OPTIONS y POST sin auth.

async function hashOtp(otp: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(otp));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// deno-lint-ignore no-explicit-any
async function pdfDocToBytes(pdfDoc: any): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  return new Promise((resolve, reject) => {
    pdfDoc.on("data",  (chunk: Uint8Array) => chunks.push(chunk));
    pdfDoc.on("error", reject);
    pdfDoc.on("end", () => {
      const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
      const merged   = new Uint8Array(totalLen);
      let offset     = 0;
      for (const c of chunks) { merged.set(c, offset); offset += c.length; }
      resolve(merged);
    });
    pdfDoc.end();
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: corsHeaders });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: corsHeaders });

    const body = await req.json();
    const { otp } = body;

    if (!otp || typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
      return new Response(JSON.stringify({ error: "Código OTP inválido" }), { status: 400, headers: corsHeaders });
    }

    const { data: agency } = await supabase
      .from("agencies")
      .select("id, onboarding_status, contact_email, razon_social, rfc, representante_legal_nombre, name, commission_percentage, pending_amendment_id, street, exterior_number, interior_number, colony, city, state, postal_code, country")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!agency) return new Response(JSON.stringify({ error: "Agencia no encontrada" }), { status: 404, headers: corsHeaders });

    const isInitialFlow   = agency.onboarding_status === "pending_signature";
    const isAmendmentFlow = agency.pending_amendment_id != null;

    if (!isInitialFlow && !isAmendmentFlow) {
      return new Response(JSON.stringify({ error: "La agencia no tiene una firma pendiente" }), { status: 409, headers: corsHeaders });
    }

    const { data: acceptance } = await supabase
      .from("contract_acceptances")
      .select("id, otp_code_hash, otp_expires_at, otp_attempts, contract_version, folio_contrato, amendment_type, commission_percentage_proposed")
      .eq("agency_id", agency.id)
      .eq("status", "pending")
      .maybeSingle();

    if (!acceptance?.otp_code_hash) {
      return new Response(JSON.stringify({ error: "No hay un código activo. Solicita uno nuevo." }), { status: 404, headers: corsHeaders });
    }

    if (acceptance.otp_expires_at && new Date(acceptance.otp_expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "El código ha expirado. Solicita uno nuevo." }), { status: 410, headers: corsHeaders });
    }

    // ── Verify OTP ──────────────────────────────────────────────────────────
    const inputHash = await hashOtp(otp);
    if (inputHash !== acceptance.otp_code_hash) {
      const newAttempts = (acceptance.otp_attempts ?? 0) + 1;

      if (newAttempts >= MAX_OTP_ATTEMPTS) {
        await supabase.from("contract_acceptances").update({
          otp_attempts:   newAttempts,
          status:         "failed",
          otp_code_hash:  null,
          otp_expires_at: null,
        }).eq("id", acceptance.id);

        return new Response(
          JSON.stringify({ error: "Demasiados intentos fallidos. Solicita un código nuevo." }),
          { status: 429, headers: corsHeaders },
        );
      }

      await supabase.from("contract_acceptances").update({ otp_attempts: newAttempts }).eq("id", acceptance.id);

      const remaining = MAX_OTP_ATTEMPTS - newAttempts;
      return new Response(
        JSON.stringify({ error: `Código incorrecto. Te quedan ${remaining} intento${remaining === 1 ? "" : "s"}.` }),
        { status: 422, headers: corsHeaders },
      );
    }

    // ── OTP válido — preparar datos del contrato ─────────────────────────────
    const now    = new Date();
    const nowIso = now.toISOString();
    const ip     = (req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? "No disponible")
      .split(",")[0]
      .trim();
    const ua     = req.headers.get("user-agent") ?? "No disponible";

    const MESES    = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
    const fechaDia  = String(now.getDate()).padStart(2, "0");
    const fechaMes  = MESES[now.getMonth()];
    const fechaAnio = String(now.getFullYear());

    const folio           = acceptance.folio_contrato as string | null;
    const contractVersion = (acceptance.contract_version as string | null) ?? "1.0";

    if (!folio) {
      console.error(`Inconsistent state: contract_acceptances ${acceptance.id} has null folio_contrato`);
      return new Response(JSON.stringify({ error: "Error de estado: folio de contrato ausente. Contacta a soporte." }), { status: 500, headers: corsHeaders });
    }

    const signerEmail = agency.contact_email ?? user.email ?? "";

    // Resolve effective commission
    const { data: platformSettings } = await supabase
      .from("platform_settings")
      .select("agency_commission_percentage")
      .limit(1)
      .maybeSingle();

    const platformDefault = platformSettings?.agency_commission_percentage ?? 15;

    const isAmendment         = acceptance.amendment_type === "commission_change";
    const proposedCommission  = acceptance.commission_percentage_proposed as number | null;
    const effectiveCommission = isAmendment
      ? (proposedCommission ?? platformDefault)
      : (agency.commission_percentage ?? platformDefault);

    if (!agency.representante_legal_nombre) {
      console.error(`Inconsistent state: agency ${agency.id} has no representante_legal_nombre`);
      return new Response(JSON.stringify({ error: "Error de estado: nombre del firmante ausente. Contacta a soporte." }), { status: 500, headers: corsHeaders });
    }

    const fechaHoraFormatted = now.toLocaleString("es-MX", {
      timeZone:  "America/Mexico_City",
      dateStyle: "long",
      timeStyle: "medium",
    }) + " (hora Ciudad de México)";

    // Construir domicilio fiscal desde columnas separadas (domicilio_fiscal está NULL)
    const domicilioFiscal = [
      agency.street,
      agency.exterior_number && `#${agency.exterior_number}`,
      agency.interior_number && `Int. ${agency.interior_number}`,
    ].filter(Boolean).join(" ") +
      (agency.colony ? `, ${agency.colony}` : "") +
      (agency.city ? `, ${agency.city}` : "") +
      (agency.state ? `, ${agency.state}` : "") +
      (agency.postal_code ? ` ${agency.postal_code}` : "") +
      (agency.country ? `, ${agency.country}` : "") || "A confirmar";

    // ── Construir datos del contrato (server-side, nunca del cliente) ────────
    const contractData: ContractData = {
      razonSocial:          agency.razon_social ?? agency.name ?? "Sin nombre",
      rfcAgencia:           agency.rfc ?? "PENDIENTE",
      domicilioFiscal:      domicilioFiscal,
      representanteLegal:   agency.representante_legal_nombre,
      emailContacto:        signerEmail,
      folioContrato:        folio,
      fechaDia,
      fechaMes,
      fechaAnio,
      versionContrato:      contractVersion,
      commissionPercentage: effectiveCommission,
    };

    const anexoB: AnexoBData = {
      contractFolio:       folio,
      contractVersion:    contractVersion,
      razonSocial:         agency.razon_social ?? agency.name ?? "Sin nombre",
      rfcAgencia:          agency.rfc ?? "PENDIENTE",
      emailAceptacion:     signerEmail,
      fechaHoraAceptacion: fechaHoraFormatted,
      ipAceptacion:        ip,
      userAgentAceptacion: ua.length > 120 ? ua.slice(0, 120) + "…" : ua,
      otpEstatus:          "Verificado — código de 6 dígitos validado correctamente",
      // hashDocumento se deja undefined — el Anexo B impreso mostrará el texto
      // estático "El hash de integridad de este documento está disponible en el
      // registro digital de la plataforma". El hash se calcula sobre los bytes
      // del PDF y se guarda solo en contract_acceptances.document_hash.
    };

    // ── Generación de PDF, hash y subida a Storage ───────────────────────────
    // TODO en un solo try/catch. Si algo falla aquí, NO se actualiza
    // contract_acceptances.status ni agencies.onboarding_status.
    let pdfBytes: Uint8Array;
    let documentHash: string;
    let storagePath: string;

    try {
      const { default: PdfPrinter } = await import("npm:pdfmake@0.2.20");
      const { Buffer } = await import("node:buffer");
      const {
        ROBOTO_NORMAL_B64,
        ROBOTO_BOLD_B64,
        ROBOTO_ITALICS_B64,
        ROBOTO_BOLDITALICS_B64,
      } = await import("../_shared/robotoFonts.ts");
      const { buildSignedContractDocDefinition } = await import("../_shared/contractDocDefinition.ts");

      const fonts = {
        Roboto: {
          normal:      Buffer.from(ROBOTO_NORMAL_B64,      "base64"),
          bold:        Buffer.from(ROBOTO_BOLD_B64,        "base64"),
          italics:     Buffer.from(ROBOTO_ITALICS_B64,     "base64"),
          bolditalics: Buffer.from(ROBOTO_BOLDITALICS_B64, "base64"),
        },
      };

      const docDefinition = buildSignedContractDocDefinition(contractData, anexoB);
      // deno-lint-ignore no-explicit-any
      const printer = new (PdfPrinter as any)(fonts);
      const pdfDoc = printer.createPdfKitDocument(docDefinition);

      pdfBytes = await pdfDocToBytes(pdfDoc);

      if (!pdfBytes || pdfBytes.length < 1000) {
        throw new Error(`PDF generado con tamaño sospechoso: ${pdfBytes?.length ?? 0} bytes`);
      }

      // SHA-256 sobre los bytes de la única generación
      const hashBuffer = await crypto.subtle.digest("SHA-256", pdfBytes);
      documentHash = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");

      storagePath = `${agency.id}/contratos/${folio}.pdf`;

      const { error: uploadError } = await supabase.storage
        .from("agency-documents")
        .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });

      if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);
    } catch (pdfError) {
      console.error("Fallo en generación de contrato firmado:", pdfError);
      // NO tocar contract_acceptances.status, NO tocar agencies.onboarding_status.
      // El OTP ya se validó, así que no se pierde — el usuario puede
      // reintentar sin pedir código nuevo.
      return new Response(
        JSON.stringify({
          error: "No se pudo generar el documento del contrato. Intenta de nuevo en unos momentos.",
          debug_detail: String(pdfError instanceof Error ? pdfError.message : pdfError),
          debug_stack: pdfError instanceof Error ? (pdfError.stack ?? null) : null,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Solo si llegamos aquí: PDF real confirmado, hash real, archivo subido ──

    // 1. Marcar acceptance como signed con document_hash
    await supabase.from("contract_acceptances").update({
      status:                       "signed",
      signed_at:                    nowIso,
      signer_user_id:               user.id,
      ip_address:                   ip,
      user_agent:                   ua,
      otp_code_hash:                null,
      otp_expires_at:               null,
      folio_contrato:               folio,
      accepted_email:               signerEmail,
      commission_percentage_at_signing: effectiveCommission,
      document_hash:                documentHash,
    }).eq("id", acceptance.id);

    // 2. Marcar contrato_agencia previo como superseded
    await supabase.from("agency_documents")
      .update({ is_current: false, status: "superseded" })
      .eq("agency_id", agency.id)
      .eq("document_type_key", "contrato_agencia")
      .eq("is_current", true);

    // 3. Insertar nuevo agency_documents con status=approved
    await supabase.from("agency_documents").insert({
      agency_id:         agency.id,
      document_type_key: "contrato_agencia",
      storage_path:      storagePath,
      file_name:         `${folio}.pdf`,
      mime_type:         "application/pdf",
      file_size_bytes:   pdfBytes.length,
      is_current:        true,
      status:            "approved",
      uploaded_by:       user.id,
    });

    // 4. Actualizar agencia
    if (isAmendment) {
      await supabase.from("agencies").update({
        commission_percentage:  effectiveCommission,
        pending_amendment_id:   null,
      }).eq("id", agency.id);

      await supabase.from("audit_logs").insert({
        actor_id:   user.id,
        event_type: "commission_amendment_signed",
        severity:   "info",
        old_values: { commission_percentage: agency.commission_percentage },
        new_values: { commission_percentage: effectiveCommission },
        metadata:   { agency_id: agency.id, folio, acceptance_id: acceptance.id },
      }).select();
    } else {
      await supabase.from("agencies").update({
        onboarding_status:     "active",
        is_approved:           true,
        approved_at:           nowIso,
        commission_percentage: agency.commission_percentage,
      }).eq("id", agency.id);
    }

    // 5. Generar signed URL para descarga
    const { data: urlData } = await supabase.storage
      .from("agency-documents")
      .createSignedUrl(storagePath, 31536000);

    // 6. Notificación interna
    try {
      await supabase.from("notifications").insert({
        user_id:  user.id,
        type:     "contract_signed",
        title:    isAmendment ? "Enmienda firmada" : "Contrato firmado",
        message:  isAmendment
          ? `Enmienda firmada exitosamente. Folio: ${folio}`
          : `Contrato firmado exitosamente. Folio: ${folio}`,
      }).select();
    } catch {
      // non-blocking
    }

    return new Response(
      JSON.stringify({
        ok:            true,
        message:       isAmendment ? "Enmienda firmada exitosamente." : "Contrato firmado exitosamente.",
        folio,
        contract_version: contractVersion,
        is_amendment:  isAmendment,
        document_hash: documentHash,
        signed_url:    urlData?.signedUrl ?? null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Unexpected error in verify-contract-otp:", err);
    return new Response(JSON.stringify({ error: "Error interno del servidor", detail: String(err?.message || err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
