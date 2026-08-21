import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verify calling user is admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (!userData || userData.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Only admins can create executive users' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { email, password, first_name, last_name, phone, notes } = await req.json();

    if (!email || !password || !first_name) {
      return new Response(JSON.stringify({ error: 'email, password y first_name son requeridos' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create auth user with admin API — does NOT affect the current session
    const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: 'account_executive' },
    });

    if (createError || !authData.user) {
      return new Response(JSON.stringify({ error: createError?.message || 'Error al crear usuario' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const newUserId = authData.user.id;

    // Insert into users table
    const { error: profileError } = await supabaseAdmin.from('users').insert({
      id: newUserId,
      email,
      first_name,
      last_name: last_name || '',
      role: 'account_executive',
      email_verified: true,
    });

    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      return new Response(JSON.stringify({ error: 'Error al crear perfil: ' + profileError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Insert into account_executives table
    const { error: execError } = await supabaseAdmin.from('account_executives').insert({
      user_id: newUserId,
      first_name,
      last_name: last_name || '',
      email,
      phone: phone || null,
      notes: notes || null,
      is_active: true,
      created_by: user.id,
    });

    if (execError) {
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      await supabaseAdmin.from('users').delete().eq('id', newUserId);
      return new Response(JSON.stringify({ error: 'Error al registrar ejecutivo: ' + execError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Send credentials email (fire-and-forget — don't fail the creation if email fails)
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
      await fetch(`${supabaseUrl}/functions/v1/send-executive-credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          firstName: first_name,
          lastName: last_name || '',
          password,
        }),
      });
    } catch (emailErr) {
      console.error('Failed to send credentials email:', emailErr);
    }

    return new Response(JSON.stringify({ success: true, user_id: newUserId }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Error interno' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
