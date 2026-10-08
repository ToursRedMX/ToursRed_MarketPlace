import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
export interface PhonePolicy { required: boolean; verified: boolean; pending: boolean; sms_enabled: boolean; simulation: boolean }
export interface PhoneVerificationStatus { traveler: PhonePolicy; agency: PhonePolicy; verified_at: string | null; phone_suffix: string | null }
export function usePhoneVerification(userId: string | undefined) {
  const query = useQuery({
    queryKey: ['phone-verification', userId], enabled: Boolean(userId), staleTime: 0,
    refetchInterval: 5000, refetchIntervalInBackground: false, retry: 1,
    queryFn: async (): Promise<PhoneVerificationStatus> => {
      const { data,error } = await supabase.rpc('get_my_phone_verification_status');
      if (error || typeof data?.traveler?.pending !== 'boolean' || typeof data?.agency?.pending !== 'boolean') throw new Error('No se pudo comprobar la política de teléfono');
      return data as PhoneVerificationStatus;
    },
  });
  return query;
}
