import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Punto 1: specifier raíz — resuelve a src/printer.js (main del package.json, no el bundle de browser)
import PdfPrinter from "npm:pdfmake@0.2.20";

// Punto 2: Buffer de Node — pdfkit internamente verifica Buffer.isBuffer()
import { Buffer } from "node:buffer";

// Punto 3: fuentes bundled como base64, sin fetch() externo en runtime
import {
  ROBOTO_NORMAL_B64,
  ROBOTO_BOLD_B64,
  ROBOTO_ITALICS_B64,
  ROBOTO_BOLDITALICS_B64,
} from "../_shared/robotoFonts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Construido fuera del handler para reutilizarse en invocaciones warm
const fonts = {
  Roboto: {
    normal:      Buffer.from(ROBOTO_NORMAL_B64,      "base64"),
    bold:        Buffer.from(ROBOTO_BOLD_B64,        "base64"),
    italics:     Buffer.from(ROBOTO_ITALICS_B64,     "base64"),
    bolditalics: Buffer.from(ROBOTO_BOLDITALICS_B64, "base64"),
  },
};

/** Recolecta el stream de pdfkit en un Uint8Array */
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

  const t0 = Date.now();

  try {
    // 1. Documento de prueba con acentos y ñ para verificar codificación Roboto
    const docDefinition = {
      defaultStyle: { font: "Roboto", fontSize: 11 },
      content: [
        { text: "Prueba de generación de PDF — ToursRed", style: "header", marginBottom: 16 },
        { text: "Texto con caracteres especiales: áéíóúüñÁÉÍÓÚÜÑ", marginBottom: 8 },
        { text: "Contrato de uso de plataforma digital, intermediación y comisión mercantil.", marginBottom: 8 },
        {
          text: [
            { text: "Cláusula 1. — ", bold: true },
            "Representación legal: el representante actuará en nombre de la agencia.",
          ],
          marginBottom: 8,
        },
        {
          text: [
            { text: "Cursiva: ", italics: true },
            { text: "énfasis en términos legales.", italics: true },
          ],
        },
      ],
      styles: {
        header: { fontSize: 18, bold: true },
      },
    };

    // 2. Generar PDF como Uint8Array
    // deno-lint-ignore no-explicit-any
    const printer = new (PdfPrinter as any)(fonts);
    const pdfDoc  = printer.createPdfKitDocument(docDefinition);
    const pdfBytes = await pdfDocToBytes(pdfDoc);

    // 3. SHA-256 sobre los bytes reales del PDF
    const hashBuffer   = await crypto.subtle.digest("SHA-256", pdfBytes);
    const documentHash = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");

    // 4. Subir al bucket agency-documents en carpeta test/
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const testPath = `test/pdfmake-test-${Date.now()}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from("agency-documents")
      .upload(testPath, pdfBytes, { contentType: "application/pdf", upsert: true });

    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

    // 5. Signed URL válida 1 hora para descarga manual y verificación
    const { data: urlData } = await supabase.storage
      .from("agency-documents")
      .createSignedUrl(testPath, 3600);

    const elapsed = Date.now() - t0;

    return new Response(
      JSON.stringify({
        ok:             true,
        pdf_size_bytes: pdfBytes.length,
        document_hash:  documentHash,
        signed_url:     urlData?.signedUrl ?? null,
        elapsed_ms:     elapsed,
        font_source:    "robotoFonts.ts (base64 bundled, no external fetch)",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("test-pdfmake error:", message);
    return new Response(
      JSON.stringify({ ok: false, error: message, elapsed_ms: Date.now() - t0 }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
