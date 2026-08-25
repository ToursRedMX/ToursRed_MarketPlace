import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface ValidateReferralCodeRequest {
  code: string;
  userId?: string;
}

interface ValidationResponse {
  valid: boolean;
  code?: string;
  referrer_name?: string;
  referrer_id?: string;
  message?: string;
  max_referrals?: number;
  current_referrals?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { code, userId }: ValidateReferralCodeRequest = await req.json();

    if (!code || typeof code !== 'string') {
      return new Response(
        JSON.stringify({
          valid: false,
          message: 'Código de referido es requerido',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const normalizedCode = code.trim().toLowerCase();

    const { data: referralCode, error: codeError } = await supabase
      .from('referral_codes')
      .select(`
        id,
        user_id,
        code,
        is_active,
        successful_referrals_count,
        max_referrals_allowed,
        users:user_id (
          id,
          first_name,
          last_name,
          email,
          role
        )
      `)
      .ilike('code', normalizedCode)
      .maybeSingle();

    if (codeError) {
      console.error('Error fetching referral code:', codeError);
      return new Response(
        JSON.stringify({
          valid: false,
          message: 'Error al validar código de referido',
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!referralCode) {
      return new Response(
        JSON.stringify({
          valid: false,
          message: 'Código de referido no existe',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!referralCode.is_active) {
      return new Response(
        JSON.stringify({
          valid: false,
          message: 'Código de referido no está activo',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const referrerUser = referralCode.users as any;

    if (!referrerUser || referrerUser.role !== 'traveler') {
      return new Response(
        JSON.stringify({
          valid: false,
          message: 'Código de referido no válido',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (userId && referrerUser.id === userId) {
      return new Response(
        JSON.stringify({
          valid: false,
          message: 'No puedes usar tu propio código de referido',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (referralCode.successful_referrals_count >= referralCode.max_referrals_allowed) {
      return new Response(
        JSON.stringify({
          valid: false,
          message: 'Este código ha alcanzado su límite de referidos',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { data: programSettings } = await supabase
      .from('platform_settings')
      .select('referral_program_enabled')
      .maybeSingle();

    if (programSettings && !programSettings.referral_program_enabled) {
      return new Response(
        JSON.stringify({
          valid: false,
          message: 'El programa de referidos no está activo en este momento',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const referrerName = referrerUser.first_name && referrerUser.last_name
      ? `${referrerUser.first_name} ${referrerUser.last_name}`
      : referrerUser.email;

    const response: ValidationResponse = {
      valid: true,
      code: referralCode.code,
      referrer_name: referrerName,
      referrer_id: referrerUser.id,
      message: 'Código de referido válido',
      max_referrals: referralCode.max_referrals_allowed,
      current_referrals: referralCode.successful_referrals_count,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in validate-referral-code function:', error);
    return new Response(
      JSON.stringify({
        valid: false,
        message: 'Error al procesar solicitud',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
