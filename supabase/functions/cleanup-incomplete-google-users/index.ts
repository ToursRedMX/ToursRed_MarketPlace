import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get all auth users where onboarding_completed is false/null and older than 24h
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: authUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (listError) throw listError;

    const toDelete: string[] = [];

    for (const u of authUsers.users) {
      const meta = u.user_metadata ?? {};
      const onboardingCompleted = meta.onboarding_completed;
      const isGoogleUser = u.app_metadata?.provider === "google" ||
        (u.identities ?? []).some((i: any) => i.provider === "google");

      if (
        isGoogleUser &&
        (onboardingCompleted === false || onboardingCompleted === null || onboardingCompleted === undefined) &&
        u.created_at < cutoff
      ) {
        toDelete.push(u.id);
      }
    }

    let deleted = 0;
    for (const userId of toDelete) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (!error) deleted++;
    }

    return new Response(
      JSON.stringify({ success: true, deleted, scanned: authUsers.users.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
