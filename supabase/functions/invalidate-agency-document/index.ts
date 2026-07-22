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

    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: corsHeaders });

    // Admin only
    const { data: adminUser } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
    if (adminUser?.role !== "admin") return new Response(JSON.stringify({ error: "Acceso denegado" }), { status: 403, headers: corsHeaders });

    const body = await req.json();
    const { document_id, rejection_reason } = body;

    if (!document_id) return new Response(JSON.stringify({ error: "Se requiere document_id" }), { status: 400, headers: corsHeaders });

    const { data: doc } = await supabase
      .from("agency_documents")
      .select("id, agency_id, document_type_key, storage_path, is_current")
      .eq("id", document_id)
      .maybeSingle();

    if (!doc) return new Response(JSON.stringify({ error: "Documento no encontrado" }), { status: 404, headers: corsHeaders });

    await supabase.from("agency_documents").update({
      status:           "rejected",
      rejection_reason: rejection_reason ?? null,
      reviewed_by:      user.id,
      reviewed_at:      new Date().toISOString(),
      is_current:       false,
    }).eq("id", document_id);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Error interno del servidor" }), { status: 500, headers: corsHeaders });
  }
});
