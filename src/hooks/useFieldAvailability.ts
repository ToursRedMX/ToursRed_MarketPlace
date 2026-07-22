import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

type AvailabilityState = {
  isChecking: boolean;
  isAvailable: boolean | null;
  errorMessage: string;
};

const IDLE: AvailabilityState = { isChecking: false, isAvailable: null, errorMessage: '' };

export function useFieldAvailability(
  value: string,
  rpcFunction: 'check_curp_available' | 'check_passport_available' | 'check_email_available',
  minLength: number,
  exactLength?: number,
  role?: string
): AvailabilityState {
  const [state, setState] = useState<AvailabilityState>(IDLE);

  useEffect(() => {
    const trimmed = value.trim();

    if (!trimmed || trimmed.length < minLength || (exactLength !== undefined && trimmed.length !== exactLength)) {
      setState(IDLE);
      return;
    }

    setState({ isChecking: true, isAvailable: null, errorMessage: '' });

    const timeoutId = setTimeout(async () => {
      try {
        let params: Record<string, string>;
        if (rpcFunction === 'check_curp_available') {
          params = { p_curp: trimmed, ...(role ? { p_role: role } : {}) };
        } else if (rpcFunction === 'check_passport_available') {
          params = { p_passport: trimmed };
        } else {
          params = { p_email: trimmed };
        }

        const { data, error } = await supabase.rpc(rpcFunction, params);

        if (error) throw error;

        setState({ isChecking: false, isAvailable: data === true, errorMessage: '' });
      } catch {
        // On network/RPC error, don't block the user — server validates on submit
        setState(IDLE);
      }
    }, 600);

    return () => clearTimeout(timeoutId);
  }, [value, rpcFunction, minLength, exactLength, role]);

  return state;
}
