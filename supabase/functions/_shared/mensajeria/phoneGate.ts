import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
export type PhoneContext = 'traveler' | 'agency' | 'account' | 'administrative' | 'verification';
const recovery = new Set(['request-phone-otp','verify-phone-otp','send-verification-email','verify-email-code','send-agency-registration-admin','send-agency-welcome','upload-agency-document','validate-agency-rfc']);
export async function phoneGate(client: SupabaseClient, userId: string, resource: string, requested: PhoneContext = 'account'): Promise<'allowed' | 'pending' | 'unavailable'> {
  if (requested === 'verification' || recovery.has(resource)) return 'allowed';
  const { data: profile, error } = await client.from('users').select('role,is_active').eq('id',userId).maybeSingle();
  if (error || !profile?.is_active) return 'unavailable';
  let context = requested;
  if (context === 'account') context = profile.role === 'agency' ? 'agency' : profile.role === 'traveler' ? 'traveler' : 'administrative';
  const { data, error: policyError } = await client.rpc('phone_verification_policy',{p_user_id:userId,p_context:context});
  if (policyError || typeof data?.pending !== 'boolean') return 'unavailable';
  return data.pending ? 'pending' : 'allowed';
}
