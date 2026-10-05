import { useQuery } from '@tanstack/react-query';
import { getTours, TourFilters } from '../lib/supabase';

export const useTours = (filters: TourFilters = {}) => {
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
