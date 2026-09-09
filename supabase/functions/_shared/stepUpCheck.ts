import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type UserClient = Pick<SupabaseClient, "auth">;

interface StepUpResult {
  verified: boolean;
  reason?: string;
}

const corsHeadersForResponses = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

export async function checkStepUp(
  serviceRoleKey: string,
  supabaseUrl: string,
  userId: string
): Promise<StepUpResult> {
  if (!userId) return { verified: false, reason: "STEP_UP_REQUIRED" };
  try {
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const now = new Date().toISOString();
    const { data, error } = await adminClient
      .from("sensitive_verifications")
      .select("id")
      .eq("user_id", userId)
      .gt("expires_at", now)
      .order("verified_at", { ascending: false })
      .limit(1);

    if (error) {
      return { verified: false, reason: "Error verifying recent authentication" };
    }
    if (Array.isArray(data) && data.some(row => row && typeof row.id === "string" && row.id.length > 0)) {
      return { verified: true };
    }
    return { verified: false, reason: "STEP_UP_REQUIRED" };
  } catch {
    return { verified: false, reason: "Error verifying recent authentication" };
  }
}

export async function checkUserHasMfa(
  userClient: UserClient,
  userId: string
): Promise<boolean> {
  try {
    if (!userId) return false;
    const { data: factorsData, error } = await userClient.auth.mfa.listFactors();
    if (error || !Array.isArray(factorsData?.totp)) return false;
    return factorsData.totp.some(factor => factor && factor.status === "verified");
  } catch {
    return false;
  }
}

export function stepUpRequiredResponse() {
  return new Response(
    JSON.stringify({
      error: "Debes verificar tu identidad con tu codigo TOTP para realizar esta accion.",
      code: "STEP_UP_REQUIRED",
    }),
    { status: 403, headers: { ...corsHeadersForResponses, "Content-Type": "application/json" } }
  );
}

export function mfaRequiredResponse() {
  return new Response(
    JSON.stringify({
      error: "Protege tus fondos. Activa la autenticacion en dos pasos desde Seguridad para continuar.",
      code: "MFA_NOT_CONFIGURED",
    }),
    { status: 403, headers: { ...corsHeadersForResponses, "Content-Type": "application/json" } }
  );
}

export async function enforceStepUp(
  userClient: UserClient,
  serviceRoleKey: string,
  supabaseUrl: string,
  userId: string
): Promise<Response | null> {
  const hasMfa = await checkUserHasMfa(userClient, userId);
  if (!hasMfa) {
    return mfaRequiredResponse();
  }
  const stepUp = await checkStepUp(serviceRoleKey, supabaseUrl, userId);
  if (!stepUp.verified) {
    return stepUpRequiredResponse();
  }
  return null;
}
