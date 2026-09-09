import * as Sentry from "npm:@sentry/deno@9";

const dsn = Deno.env.get("SENTRY_BACKEND_DSN");
const functionName = Deno.env.get("SB_FUNCTION_NAME") ?? "unknown-function";
const environment = Deno.env.get("SUPABASE_URL")?.includes("localhost")
  ? "development"
  : Deno.env.get("SENTRY_ENVIRONMENT") ?? "production";
const release = Deno.env.get("SENTRY_RELEASE");

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate: 0.1,
  });
}

/** Reporta una excepción de una Edge Function y espera a que el evento salga. */
export async function reportEdgeError(
  error: unknown,
  context: string,
  tags: Record<string, string> = {},
): Promise<void> {
  console.error(`[${functionName}] ${context}`, error);
  if (!dsn) return;

  Sentry.withScope((scope) => {
    scope.setTag("function_name", functionName);
    scope.setTag("context", context);
    scope.setTag("execution_id", Deno.env.get("SB_EXECUTION_ID") ?? "unknown");
    scope.setTag("region", Deno.env.get("SB_REGION") ?? "unknown");
    for (const [key, value] of Object.entries(tags)) scope.setTag(key, value);
    Sentry.captureException(error);
  });
  await Sentry.flush(2000);
}
