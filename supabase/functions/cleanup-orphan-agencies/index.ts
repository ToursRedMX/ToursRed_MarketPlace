import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Huérfanos: usuarios con role='agency' que no tienen fila correspondiente en agencies.
// Esta función solo puede invocarla un usuario con role='admin' AND is_super_admin=true.
// Es de uso manual único — limpiar registros rotos del flujo anterior a la RPC atómica.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    // Verificar identidad del llamante con la anon key (respeta RLS).
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) return json({ error: "Invalid token" }, 401);

    // Admin con service role key para leer sin restricción de RLS.
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verificar que el llamante es admin con is_super_admin = true.
    const { data: caller, error: callerError } = await supabaseAdmin
      .from("users")
      .select("role, is_super_admin")
      .eq("id", user.id)
      .maybeSingle();

    if (callerError || !caller) return json({ error: "No se pudo verificar el perfil del usuario" }, 403);
    if (caller.role !== "admin" || caller.is_super_admin !== true) {
      return json({ error: "Acceso denegado: se requiere super admin" }, 403);
    }

    // Obtener los huérfanos: usuarios con role='agency' sin fila en agencies.
    const { data: orphans, error: orphanError } = await supabaseAdmin
      .from("users")
      .select("id, email, created_at")
      .eq("role", "agency")
      .not("id", "in", `(SELECT user_id FROM agencies)`);

    // Fallback: el filtro .not(...) con subquery no siempre es soportado en client.
    // Usamos SQL directo para mayor fiabilidad.
    const { data: orphanRows, error: sqlError } = await supabaseAdmin.rpc(
      "exec_sql_get_orphan_agencies" as never
    ).catch(() => ({ data: null, error: { message: "rpc_not_found" } }));

    let orphanList: { id: string; email: string; created_at: string }[] = [];

    if (!sqlError && orphanRows) {
      orphanList = orphanRows as typeof orphanList;
    } else if (!orphanError && orphans) {
      orphanList = orphans as typeof orphanList;
    } else {
      // Consulta directa con execute_sql equivalente vía supabase-js filter chain.
      // Obtenemos todos los agency users y filtramos en memoria contra agencies.
      const { data: agencyUsers } = await supabaseAdmin
        .from("users")
        .select("id, email, created_at")
        .eq("role", "agency");

      const { data: existingAgencies } = await supabaseAdmin
        .from("agencies")
        .select("user_id");

      if (agencyUsers && existingAgencies) {
        const agencyUserIds = new Set(existingAgencies.map((a: { user_id: string }) => a.user_id));
        orphanList = agencyUsers.filter((u: { id: string }) => !agencyUserIds.has(u.id)) as typeof orphanList;
      }
    }

    if (orphanList.length === 0) {
      return json({ message: "No se encontraron huérfanos", processed: [], errors: [] });
    }

    const processed: string[] = [];
    const errors: { id: string; email: string; error: string }[] = [];

    for (const orphan of orphanList) {
      try {
        // Paso 1: eliminar fila de public.users.
        const { error: deletePublicError } = await supabaseAdmin
          .from("users")
          .delete()
          .eq("id", orphan.id);

        if (deletePublicError) {
          errors.push({ id: orphan.id, email: orphan.email, error: `public.users: ${deletePublicError.message}` });
          continue;
        }

        // Paso 2: eliminar entrada en auth.users (libera el correo completamente).
        const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(orphan.id);

        if (deleteAuthError) {
          errors.push({ id: orphan.id, email: orphan.email, error: `auth.users: ${deleteAuthError.message}` });
          // public.users ya fue eliminado — el correo queda liberado del perfil aunque
          // el auth user persista. Se registra el error para revisión manual.
          continue;
        }

        processed.push(`${orphan.id} (${orphan.email})`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ id: orphan.id, email: orphan.email, error: message });
      }
    }

    return json({
      message: `Limpieza completada. ${processed.length} huérfanos eliminados, ${errors.length} errores.`,
      orphans_found: orphanList.length,
      processed,
      errors,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});
