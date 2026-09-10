import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import * as Sentry from "npm:@sentry/deno@9";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey" };
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) Sentry.init({ dsn: sentryDsn, environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production", release: Deno.env.get("SENTRY_RELEASE"), tracesSampleRate: 0.1 });

type JournalPayload = { journal_type?: "income" | "vendor_payment"; total?: number; gross_amount?: number; reference?: string };
type SyncResult = { external_entity_type: string; external_entity_id: string };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });

async function logSync(supabase: SupabaseClient, recordType: string, recordId: string, status: "pending" | "synced" | "error", result?: SyncResult, errorMessage?: string, payloadSummary?: Record<string, unknown>) {
  const { error } = await supabase.from("accounting_sync_log").upsert({ provider: "internal", record_type: recordType, record_id: recordId, status, external_entity_type: result?.external_entity_type, external_entity_id: result?.external_entity_id, error_message: errorMessage, synced_at: status === "synced" ? new Date().toISOString() : null, payload_summary: payloadSummary }, { onConflict: "provider,record_type,record_id" });
  if (error) console.error("accounting_sync_log error", error.message);
}

async function isAuthorized(req: Request, url: string, serviceKey: string, supabase: SupabaseClient) {
  const header = req.headers.get("Authorization");
  if (!header) return false;
  const token = header.replace(/^Bearer\s+/i, "");
  if (token === serviceKey) return true;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!anonKey) return false;
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: header } } });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return false;
  const { data: caller } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  return ["admin", "super_admin", "accountant"].includes(caller?.role ?? "");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return reply({ error: "Accounting service is not configured" }, 500);
    const supabase = createClient(url, serviceKey);
    if (!await isAuthorized(req, url, serviceKey, supabase)) return reply({ error: "No autorizado" }, 401);
    const body = await req.json().catch(() => ({}));
    const action = body.action as string | undefined;
    if (!action) return reply({ error: "action is required" }, 400);
    const { data: settings, error: settingsError } = await supabase.from("platform_settings").select("accounting_provider, accounting_sync_enabled").maybeSingle();
    if (settingsError) throw settingsError;
    if (action === "health_check") return reply({ healthy: settings?.accounting_provider === "internal" && settings?.accounting_sync_enabled === true, provider: settings?.accounting_provider ?? "none" });
    if (settings?.accounting_provider !== "internal") return reply({ error: "El ERP interno es el Ãºnico proveedor contable habilitado" }, 409);
    if (settings.accounting_sync_enabled !== true) return reply({ skipped: true, reason: "Accounting sync disabled" });
    if (action === "retry_errors") return reply({ retried: 0, succeeded: 0, failed: 0, reason: "No hay adaptadores externos que reintentar" });
    const recordId = body.record_id as string | undefined;
    if (!recordId) return reply({ error: "record_id is required for sync actions" }, 400);
    const payload = (body.data ?? {}) as JournalPayload;
    if (action === "sync_contact") {
      const result: SyncResult = { external_entity_type: "internal_contact", external_entity_id: recordId };
      await logSync(supabase, body.record_type || "contact_agency", recordId, "synced", result);
      return reply({ success: true, provider: "internal", ...result });
    }
    if (action !== "sync_journal") return reply({ error: `La operaciÃ³n ${action} no es vÃ¡lida para el ERP interno` }, 400);
    const isPayout = payload.journal_type === "vendor_payment";
    const recordType = isPayout ? "payout_journal" : "booking";
    await logSync(supabase, recordType, recordId, "pending", undefined, undefined, { total: payload.total ?? payload.gross_amount, reference: payload.reference });
    const rpcName = isPayout ? "create_accounting_entry_for_payout" : "create_accounting_entry_for_booking";
    const { data: entryId, error: rpcError } = await supabase.rpc(rpcName, isPayout ? { p_payout_id: recordId } : { p_booking_id: recordId });
    if (rpcError) {
      await logSync(supabase, recordType, recordId, "error", undefined, rpcError.message);
      return reply({ error: rpcError.message, record_id: recordId, record_type: recordType }, 500);
    }
    const result: SyncResult = { external_entity_type: "accounting_entry", external_entity_id: entryId ?? recordId };
    await logSync(supabase, recordType, recordId, "synced", result);
    return reply({ success: true, provider: "internal", ...result, entry_id: entryId, skipped: entryId === null });
  } catch (err) {
    if (sentryDsn) { Sentry.captureException(err, { tags: { execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown" } }); await Sentry.flush(2000); }
    return reply({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

