import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey"
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }
  // Require valid JWT from admin/super_admin
  const authHeader = req.headers.get("Authorization");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (authHeader === `Bearer ${serviceKey}`) {
    // Internal service call — allowed
  } else if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    const supabaseUser = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const { data: { user } } = await supabaseUser.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: u } = await supabaseUser.from("users").select("role").eq("id", user.id).maybeSingle();
    if (!u || !["admin", "super_admin"].includes(u.role)) {
      return new Response(JSON.stringify({ success: false, error: "Admin access required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } else {
    return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    // Use service role key internally to access auth schema
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    // Delete orphaned identities: identity exists but the user was deleted from auth.users
    const { data, error } = await supabaseAdmin.rpc("cleanup_orphaned_identities");
    if (error) throw error;
    const deleted = typeof data === "number" ? data : 0;
    return new Response(JSON.stringify({
      success: true,
      deleted
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
