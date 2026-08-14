import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export function useTurnstileEnabled(): { turnstileEnabled: boolean; loading: boolean } {
  const [turnstileEnabled, setTurnstileEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('platform_settings')
      .select('turnstile_auth_enabled')
      .maybeSingle()
      .then(({ data }) => {
        setTurnstileEnabled(data?.turnstile_auth_enabled ?? false);
        setLoading(false);
      })
      .catch(() => {
        setTurnstileEnabled(false);
        setLoading(false);
      });
  }, []);

  return { turnstileEnabled, loading };
}
