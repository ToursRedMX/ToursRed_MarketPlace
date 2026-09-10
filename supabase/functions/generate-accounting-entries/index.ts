import "jsr:@supabase/functions-js@2.112.4/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { checkAal2Required, aal2Response } from "../_shared/aal2Check.ts";
import * as Sentry from "npm:@sentry/deno@9.47.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userData } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (!userData || !["admin", "accountant"].includes(userData.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // AAL2 (MFA) check — this batch-generates real accounting entries (writes).
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const aal2 = await checkAal2Required(userClient);
    if (!aal2.allowed) {
      return aal2Response(aal2.reason || "Se requiere autenticacion de dos factores", aal2.code);
    }

    let fromDate: string | undefined;
    let toDate: string | undefined;

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      fromDate = body.from_date;
      toDate = body.to_date;
    } else {
      const url = new URL(req.url);
      fromDate = url.searchParams.get("from_date") ?? undefined;
      toDate = url.searchParams.get("to_date") ?? undefined;
    }

    const rpcArgs: Record<string, string> = {};
    if (fromDate) rpcArgs.p_from_date = fromDate;
    if (toDate) rpcArgs.p_to_date = toDate;
    const { data, error } = await supabase.rpc("generate_accounting_entries_batch", rpcArgs);

    if (error) throw error;

    const { data: executiveCommissions, error: executiveError } = await supabase.rpc(
      "reconcile_executive_commissions_batch",
      rpcArgs,
    );
    if (executiveError) throw executiveError;

    const { data: paidMovements, error: paidMovementsError } = await supabase.rpc(
      "reconcile_paid_accounting_movements",
      rpcArgs,
    );
    if (paidMovementsError) throw paidMovementsError;

    return new Response(JSON.stringify({
      success: true,
      result: data,
      executive_commissions_processed: executiveCommissions ?? 0,
      paid_movements: paidMovements ?? {},
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
