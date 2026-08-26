import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { checkAal2Required, aal2Response } from "../_shared/aal2Check.ts";
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

    const { data: adminUser } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
    if (adminUser?.role !== "admin") return new Response(JSON.stringify({ error: "Acceso denegado" }), { status: 403, headers: corsHeaders });

    // AAL2 (MFA) check — unbans a user and removes them from the fraud blocklist.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const aal2 = await checkAal2Required(userClient);
    if (!aal2.allowed) {
      return aal2Response(aal2.reason || "Se requiere autenticacion de dos factores");
    }

    const body = await req.json();
    const { agency_id, reversal_reason } = body;

    if (!agency_id || !reversal_reason) {
      return new Response(JSON.stringify({ error: "Faltan campos requeridos" }), { status: 400, headers: corsHeaders });
    }

    const { data: agency } = await supabase
      .from("agencies")
      .select("id, user_id, onboarding_status")
      .eq("id", agency_id)
      .maybeSingle();

    if (!agency) return new Response(JSON.stringify({ error: "Agencia no encontrada" }), { status: 404, headers: corsHeaders });
    if (agency.onboarding_status !== "rejected") {
      return new Response(JSON.stringify({ error: "La agencia no está en estado rechazado" }), { status: 409, headers: corsHeaders });
    }

    await supabase.from("agencies").update({
      onboarding_status:  "pending_documents",
      is_approved:        false,
      rejection_category: null,
      rejection_reason:   null,
      rejected_at:        null,
      rejected_by:        null,
      reversal_at:        new Date().toISOString(),
      reversal_by:        user.id,
      reversal_reason,
    }).eq("id", agency_id);

    await supabase.auth.admin.updateUserById(agency.user_id, { ban_duration: "none" });

    await supabase
      .from("fraud_blocklist")
      .delete()
      .eq("agency_id", agency_id);

    await supabase.from("notifications").insert({
      user_id: agency.user_id,
      type:    "agency_rejection_reversed",
      title:   "Rechazo revertido — sube tus documentos nuevamente",
      message: `Tu rechazo ha sido revisado y revertido. Por favor ingresa a la plataforma y sube tus documentos de nuevo para completar el proceso de registro.`,
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    if (sentryDsn) {
      Sentry.captureException(err, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return new Response(JSON.stringify({ error: "Error interno del servidor" }), { status: 500, headers: corsHeaders });
  }
});
