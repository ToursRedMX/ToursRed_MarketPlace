import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface CreateAdminUserRequest {
  email: string;
  password: string;
  nombre: string;
  apellido: string;
  permissions: {
    can_manage_agencies: boolean;
    can_manage_users: boolean;
    can_manage_travelers: boolean;
    can_manage_destinations: boolean;
    can_manage_categories: boolean;
    can_manage_departure_points: boolean;
    can_manage_reviews: boolean;
    can_manage_messages: boolean;
    can_manage_settings: boolean;
    can_manage_memberships: boolean;
    can_manage_inquiries: boolean;
    can_manage_points: boolean;
    can_manage_discount_codes: boolean;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('role, is_super_admin')
      .eq('id', user.id)
      .maybeSingle();

    if (!userData || userData.role !== 'admin' || !userData.is_super_admin) {
      return new Response(
        JSON.stringify({ error: 'Only super admins can create admin users' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const requestData: CreateAdminUserRequest = await req.json();
    const { email, password, nombre, apellido, permissions } = requestData;

    if (!email || !password || !nombre || !apellido) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { data: authData, error: signUpError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role: 'admin',
      },
    });

    if (signUpError || !authData.user) {
      console.error('Error creating auth user:', signUpError);
      return new Response(
        JSON.stringify({ error: signUpError?.message || 'Failed to create user' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { error: profileError } = await supabaseAdmin
      .from('users')
      .insert({
        id: authData.user.id,
        email,
        first_name: nombre,
        last_name: apellido,
        role: 'admin',
        is_super_admin: false,
        email_verified: true,
      });

    if (profileError) {
      console.error('Error creating user profile:', profileError);
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return new Response(
        JSON.stringify({ error: 'Failed to create user profile: ' + profileError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { error: permsError } = await supabaseAdmin
      .from('admin_permissions')
      .insert({
        user_id: authData.user.id,
        can_manage_agencies: permissions.can_manage_agencies,
        can_manage_users: permissions.can_manage_users,
        can_manage_travelers: permissions.can_manage_travelers,
        can_manage_destinations: permissions.can_manage_destinations,
        can_manage_categories: permissions.can_manage_categories,
        can_manage_departure_points: permissions.can_manage_departure_points,
        can_manage_reviews: permissions.can_manage_reviews,
        can_manage_messages: permissions.can_manage_messages,
        can_manage_settings: permissions.can_manage_settings,
        can_manage_memberships: permissions.can_manage_memberships,
        can_manage_inquiries: permissions.can_manage_inquiries,
        can_manage_points: permissions.can_manage_points,
        can_manage_discount_codes: permissions.can_manage_discount_codes,
      });

    if (permsError) {
      console.error('Error creating permissions:', permsError);
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      await supabaseAdmin.from('users').delete().eq('id', authData.user.id);
      return new Response(
        JSON.stringify({ error: 'Failed to create user permissions: ' + permsError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: authData.user.id,
          email,
          nombre,
          apellido,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in create-admin-user function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});