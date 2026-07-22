import { useQuery } from '@tanstack/react-query';
import { getTours } from '../lib/supabase';

export const useTours = (filters: any = {}) => {
  return useQuery({
    queryKey: ['tours', filters],
    queryFn: async () => {
      const { data, error } = await getTours(filters);
      if (error) throw error;
      return data || [];
    },
    staleTime: 3 * 60 * 1000,
  });
};
