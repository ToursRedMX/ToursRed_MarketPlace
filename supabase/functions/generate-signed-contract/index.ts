import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import PdfPrinter from "npm:pdfmake@0.2.20/js/printer.js";
import { Buffer } from "node:buffer";
import { ROBOTO_NORMAL_B64, ROBOTO_BOLD_B64, ROBOTO_ITALICS_B64, ROBOTO_BOLDITALICS_B64 } from "../_shared/robotoFonts.ts";
import { buildSignedContractDocDefinition } from "../_shared/contractDocDefinition.ts";
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
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey"
};
const fonts = {
  Roboto: {
    normal: Buffer.from(ROBOTO_NORMAL_B64, "base64"),
    bold: Buffer.from(ROBOTO_BOLD_B64, "base64"),
    italics: Buffer.from(ROBOTO_ITALICS_B64, "base64"),
    bolditalics: Buffer.from(ROBOTO_BOLDITALICS_B64, "base64")
  }
};
async function pdfDocToBytes(pdfDoc) {
  const chunks = [];
  return new Promise((resolve, reject)=>{
    pdfDoc.on("data", (chunk)=>chunks.push(chunk));
    pdfDoc.on("error", reject);
    pdfDoc.on("end", ()=>{
      const totalLen = chunks.reduce((acc, c)=>acc + c.length, 0);
      const merged = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks){
        merged.set(c, offset);
        offset += c.length;
      }
      resolve(merged);
    });
    pdfDoc.end();
  });
}
async function sha256Hex(bytes) {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf)).map((b)=>b.toString(16).padStart(2, "0")).join("");
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    status: 200,
    headers: corsHeaders
  });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({
      error: "No autorizado"
    }), {
      status: 401,
      headers: corsHeaders
    });
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return new Response(JSON.stringify({
      error: "No autorizado"
    }), {
      status: 401,
      headers: corsHeaders
    });
    const body = await req.json();
    const { agency_id, signing_data } = body;
    if (!agency_id || !signing_data) {
      return new Response(JSON.stringify({
        error: "Faltan datos: agency_id y signing_data son requeridos"
      }), {
        status: 400,
        headers: corsHeaders
      });
    }
    // Verify the user owns this agency
    const { data: agency } = await supabase.from("agencies").select("id, user_id").eq("id", agency_id).maybeSingle();
    if (!agency) return new Response(JSON.stringify({
      error: "Agencia no encontrada"
    }), {
      status: 404,
      headers: corsHeaders
    });
    if (agency.user_id !== user.id) return new Response(JSON.stringify({
      error: "No autorizado para esta agencia"
    }), {
      status: 403,
      headers: corsHeaders
    });
    const sd = signing_data;
    // Build ContractData
    const contractData = {
      razonSocial: sd.razonSocial,
      rfcAgencia: sd.rfcAgencia,
      domicilioFiscal: sd.domicilioFiscal,
      representanteLegal: sd.representanteLegal,
      emailContacto: sd.emailContacto,
      folioContrato: sd.folioContrato,
      fechaDia: sd.fechaDia,
      fechaMes: sd.fechaMes,
      fechaAnio: sd.fechaAnio,
      versionContrato: sd.versionContrato,
      commissionPercentage: sd.commissionPercentage
    };
    if (sd.specialCommissionClause) {
      contractData.specialCommissionClause = sd.specialCommissionClause;
    }
    // ── Generate PDF ──────────────────────────────────────────────────────
    // First pass: generate without hash to get bytes, then compute hash,
    // then regenerate with hash in Anexo B.
    const anexoNoHash = {
      contractFolio: sd.folioContrato,
      contractVersion: sd.versionContrato,
      razonSocial: sd.razonSocial,
      rfcAgencia: sd.rfcAgencia,
      emailAceptacion: sd.emailAceptacion,
      fechaHoraAceptacion: sd.fechaHoraAceptacion,
      ipAceptacion: sd.ipAceptacion,
      userAgentAceptacion: sd.userAgentAceptacion,
      otpEstatus: sd.otpEstatus
    };
    const printer = new PdfPrinter(fonts);
    // First pass — get bytes to compute hash
    const docDef1 = buildSignedContractDocDefinition(contractData, anexoNoHash);
    const pdfDoc1 = printer.createPdfKitDocument(docDef1);
    const pdfBytes1 = await pdfDocToBytes(pdfDoc1);
    const hashHex = await sha256Hex(pdfBytes1);
    // Second pass — include hash in Anexo B
    const anexWithHash = {
      ...anexoNoHash,
      hashDocumento: hashHex
    };
    const docDef2 = buildSignedContractDocDefinition(contractData, anexWithHash);
    const pdfDoc2 = printer.createPdfKitDocument(docDef2);
    const pdfBytes = await pdfDocToBytes(pdfDoc2);
    // ── Upload to Storage ──────────────────────────────────────────────────
    const storagePath = `${agency_id}/contratos/${sd.folioContrato}.pdf`;
    // Remove existing file at this path first
    await supabase.storage.from("agency-documents").remove([
      storagePath
    ]);
    const { error: uploadErr } = await supabase.storage.from("agency-documents").upload(storagePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: false
    });
    if (uploadErr) throw new Error(`Error al subir el PDF: ${uploadErr.message}`);
    const { data: urlData, error: urlErr } = await supabase.storage.from("agency-documents").createSignedUrl(storagePath, 31536000);
    if (urlErr || !urlData?.signedUrl) throw new Error("Error al generar la URL del contrato");
    // Update agency record
    await supabase.from("agencies").update({
      signed_contract_url: urlData.signedUrl
    }).eq("id", agency_id);
    // Insert agency_documents record
    await supabase.from("agency_documents").insert({
      agency_id: agency_id,
      document_type_key: "contrato_agencia",
      storage_path: storagePath,
      file_name: `${sd.folioContrato}.pdf`,
      mime_type: "application/pdf",
      file_size_bytes: pdfBytes.length,
      is_current: true,
      status: "approved",
      uploaded_by: user.id
    }).select();
    return new Response(JSON.stringify({
      ok: true,
      signed_url: urlData.signedUrl,
      hash: hashHex,
      file_size: pdfBytes.length
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("Error in generate-signed-contract:", err);
    if (sentryDsn) {
      Sentry.captureException(err, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return new Response(JSON.stringify({
      error: "Error interno del servidor",
      detail: String(err?.message || err)
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
