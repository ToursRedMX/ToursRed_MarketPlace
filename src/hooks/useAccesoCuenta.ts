import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export interface AccesoCuenta {
  email: string | null;
  phone_number: string | null;
  phone_verified_at: string | null;
}

/** Correo y celular de la cuenta con su estado de verificación (una sola consulta compartida por las pantallas de perfil). */
export function useAccesoCuenta() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const consulta = useQuery({
    queryKey: ['acceso-cuenta', user?.id],
    enabled: Boolean(user?.id),
    staleTime: 0,
    queryFn: async (): Promise<AccesoCuenta | null> => {
      const { data, error } = await supabase
        .from('users').select('email, phone_number, phone_verified_at').eq('id', user!.id).maybeSingle();
      if (error) throw error;
      return data as AccesoCuenta | null;
    },
  });
  return {
    acceso: consulta.data ?? null,
    cargaFallida: consulta.isError,
    /** Un celular verificado solo cambia por el flujo de código (AccountAccessSection): las pantallas lo muestran de solo lectura. */
    telefonoVerificado: Boolean(consulta.data?.phone_verified_at),
    recargar: () => queryClient.invalidateQueries({ queryKey: ['acceso-cuenta', user?.id] }),
  };
}
