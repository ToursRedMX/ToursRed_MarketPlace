// AAL2 verification helper for Edge Functions
// Returns true if the current request has AAL2 (MFA completed) OR if MFA is not required for this user.
// Returns false (meaning: block the request) if MFA IS required AND the user does NOT have AAL2.

interface SupabaseClient {
  from(table: string): any;
  rpc(fn: string, params?: Record<string, unknown>): { data: any; error: any };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

export function aal2Response(message: string): Response {
  return new Response(
    JSON.stringify({ error: message, code: "MFA_REQUIRED" }),
    {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

export async function checkAal2Required(supabase: SupabaseClient): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  try {
    // Check if MFA is required for the current user via the database function
    const { data, error } = await supabase.rpc("requires_aal2_check");

    if (error) {
      // If we can't determine, allow the request (fail-open for availability)
      return { allowed: true };
    }

    const requiresMfa = data === true || data === "true";

    if (!requiresMfa) {
      return { allowed: true };
    }

    // MFA is required — check if the user has AAL2
    const { data: aal2Data, error: aal2Error } = await supabase.rpc("has_aal2");

    if (aal2Error) {
      return { allowed: false, reason: "No se pudo verificar el nivel de autenticacion" };
    }

    const hasAal2 = aal2Data === true || aal2Data === "true";

    if (!hasAal2) {
      return {
        allowed: false,
        reason: "Se requiere autenticacion de dos factores (AAL2) para esta accion",
      };
    }

    return { allowed: true };
  } catch {
    // Fail-open for availability
    return { allowed: true };
  }
}
