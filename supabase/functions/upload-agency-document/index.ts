import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: corsHeaders });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify caller
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: corsHeaders });

    const { data: agency } = await supabase
      .from("agencies")
      .select("id, onboarding_status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!agency) return new Response(JSON.stringify({ error: "Agencia no encontrada" }), { status: 404, headers: corsHeaders });

    // Parse multipart form
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const documentTypeKey = form.get("document_type_key") as string | null;

    if (!file || !documentTypeKey) {
      return new Response(JSON.stringify({ error: "Se requiere file y document_type_key" }), { status: 400, headers: corsHeaders });
    }

    // Validate document type
    const { data: docType } = await supabase
      .from("document_types")
      .select("key, label")
      .eq("key", documentTypeKey)
      .maybeSingle();

    if (!docType) return new Response(JSON.stringify({ error: "Tipo de documento inválido" }), { status: 400, headers: corsHeaders });

    // Validate file size (10 MB)
    if (file.size > 10 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "El archivo excede 10 MB" }), { status: 413, headers: corsHeaders });
    }

    // Validate MIME
    const allowedMimes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowedMimes.includes(file.type)) {
      return new Response(JSON.stringify({ error: "Formato no permitido. Use PDF, JPG, PNG o WEBP." }), { status: 415, headers: corsHeaders });
    }

    const ext = file.name.split(".").pop() ?? "bin";
    const storagePath = `${agency.id}/${documentTypeKey}/${Date.now()}.${ext}`;

    // Upload to storage
    const fileBytes = await file.arrayBuffer();
    const { error: uploadErr } = await supabase.storage
      .from("agency-documents")
      .upload(storagePath, fileBytes, { contentType: file.type, upsert: false });

    if (uploadErr) {
      console.error("Storage upload error:", uploadErr);
      return new Response(JSON.stringify({ error: "Error al subir el archivo" }), { status: 500, headers: corsHeaders });
    }

    // Mark previous docs of same type as superseded
    await supabase
      .from("agency_documents")
      .update({ is_current: false, status: "superseded" })
      .eq("agency_id", agency.id)
      .eq("document_type_key", documentTypeKey)
      .eq("is_current", true);

    // Insert new record
    const { data: doc, error: insertErr } = await supabase
      .from("agency_documents")
      .insert({
        agency_id:         agency.id,
        document_type_key: documentTypeKey,
        storage_path:      storagePath,
        file_name:         file.name,
        mime_type:         file.type,
        file_size_bytes:   file.size,
        is_current:        true,
        status:            "pending_review",
        uploaded_by:       user.id,
      })
      .select()
      .single();

    if (insertErr) {
      console.error("Insert error:", insertErr);
      return new Response(JSON.stringify({ error: "Error al registrar el documento" }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ document: doc }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Error interno del servidor" }), { status: 500, headers: corsHeaders });
  }
});
