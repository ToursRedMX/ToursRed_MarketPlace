import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { checkAal2Required, aal2Response } from '../_shared/aal2Check.ts';
import * as Sentry from "npm:@sentry/deno@9.47.1";
import { opcionesConContexto } from "../_shared/contextoAuditoria.ts";

const sentryDsn = Deno.env.get("SENTRY_BACKEND_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: Deno.env.get("SUPABASE_URL")?.includes("localhost") ? "development" : "production",
    release: Deno.env.get("SENTRY_RELEASE"),
    tracesSampleRate: 0.1,
  });
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

/**
 * Roles que esta funcion puede crear. Es una LISTA BLANCA a proposito: el rol
 * llega en el cuerpo de la peticion, asi que sin ella un super admin podria
 * teclear cualquier cosa -- 'agency' para colarse a otra agencia, o un valor
 * que no existe y dejar al usuario sin ruta de aterrizaje. `is_super_admin`
 * NO se toma nunca de la peticion; se escribe false mas abajo y punto.
 */
const ROLES_QUE_SE_PUEDEN_CREAR = ['admin', 'accountant'] as const;
type RolCreable = (typeof ROLES_QUE_SE_PUEDEN_CREAR)[number];

/**
 * Type guard de verdad, no un `as`. Castear el rol de la peticion a RolCreable
 * ANTES de validarlo compila igual y deja la guardia de adorno: el tipo diria
 * que solo puede valer 'admin' o 'accountant' cuando en realidad vale lo que
 * haya mandado el cliente. Asi, el estrechamiento lo hace la comprobacion.
 */
const esRolCreable = (valor: string): valor is RolCreable =>
  (ROLES_QUE_SE_PUEDEN_CREAR as readonly string[]).includes(valor);

interface CreateAdminUserRequest {
  email: string;
  password: string;
  nombre: string;
  apellido: string;
  /** Omitido = 'admin', que es lo que hacia esta funcion antes de existir el campo. */
  rol?: string;
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
    // Los de abajo no existian cuando se escribio la pantalla de alta, asi que
    // un usuario nuevo nacia sin ellos y habia que entrar a "Editar Permisos"
    // para ponerlos. Van opcionales para no romper a ningun llamador viejo.
    can_view_accounting?: boolean;
    can_export_sat_xml?: boolean;
    can_manage_chart_of_accounts?: boolean;
    can_manage_expenses?: boolean;
    can_view_audit_log?: boolean;
    can_view_audit_sensitive_data?: boolean;
    can_export_audit_log?: boolean;
    can_cancel_bookings?: boolean;
    can_manage_service_desk?: boolean;
    can_manage_executives?: boolean;
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
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', opcionesConContexto(req,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    ));

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

    // AAL2 (MFA) check — must use a client authenticated with the CALLER's own JWT,
    // not the service-role client: requires_aal2_check()/has_aal2() read auth.uid()/
    // auth.jwt(), which resolve to NULL under a service-role session and silently
    // no-op the check. Creating a new admin account is a privilege-escalation-level
    // action, so this must be enforced correctly.
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '', opcionesConContexto(req,
      { global: { headers: { Authorization: authHeader } } }
    ));
    const aal2 = await checkAal2Required(userClient);
    if (!aal2.allowed) {
      return aal2Response(aal2.reason || 'Se requiere autenticacion de dos factores', aal2.code);
    }

    const requestData: CreateAdminUserRequest = await req.json();
    const { email, password, nombre, apellido, permissions } = requestData;

    const rol = requestData.rol ?? 'admin';
    if (!esRolCreable(rol)) {
      return new Response(
        JSON.stringify({
          error: `Rol no permitido: "${requestData.rol}". Solo se pueden crear ${ROLES_QUE_SE_PUEDEN_CREAR.join(' o ')}.`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

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
        role: rol,
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
        role: rol,
        // NUNCA desde la peticion: un super admin solo puede crear usuarios
        // que no lo son. Para elevar a alguien hace falta tocar la base.
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
        // `?? false` y no `?? true`: un permiso que el llamador no menciona no
        // se concede. Vale para todos, pero sobre todo para los contables, que
        // dan acceso de ESCRITURA a la contabilidad.
        can_view_accounting: permissions.can_view_accounting ?? false,
        can_export_sat_xml: permissions.can_export_sat_xml ?? false,
        can_manage_chart_of_accounts: permissions.can_manage_chart_of_accounts ?? false,
        can_manage_expenses: permissions.can_manage_expenses ?? false,
        can_view_audit_log: permissions.can_view_audit_log ?? false,
        can_view_audit_sensitive_data: permissions.can_view_audit_sensitive_data ?? false,
        can_export_audit_log: permissions.can_export_audit_log ?? false,
        can_cancel_bookings: permissions.can_cancel_bookings ?? false,
        can_manage_service_desk: permissions.can_manage_service_desk ?? false,
        can_manage_executives: permissions.can_manage_executives ?? false,
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
          rol,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in create-admin-user function:', error);
    if (sentryDsn) {
      Sentry.captureException(error, {
        tags: {
          execution_id: Deno.env.get("SB_EXECUTION_ID") || "unknown",
          region: Deno.env.get("SB_REGION") || "unknown",
        },
      });
      await Sentry.flush(2000);
    }
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});