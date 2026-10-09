import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type OtpChannel = 'sms' | 'whatsapp';
export const otpChannelLabel = (channel: OtpChannel) => channel === 'sms' ? 'SMS' : 'WhatsApp';
export function useOtpChannels() {
  return useQuery({
    queryKey: ['otp-channels'], staleTime: 0, refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase.from('platform_settings')
        .select('sms_habilitado, whatsapp_habilitado, sms_paises_permitidos').single();
      if (error) throw error;
      const channels: OtpChannel[] = [];
      if (data.sms_habilitado) channels.push('sms');
      if (data.whatsapp_habilitado) channels.push('whatsapp');
      return { channels, countries: data.sms_paises_permitidos as string[] };
    },
  });
}
