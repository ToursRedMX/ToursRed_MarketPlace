import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const STALE_30_MIN = 30 * 60 * 1000;

export const useTourCategories = () =>
  useQuery({
    queryKey: ['tour_categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tour_categories')
        .select('id, name, slug')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    staleTime: STALE_30_MIN,
  });

export const useAgencies = () =>
  useQuery({
    queryKey: ['agencies_search'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agencies')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    staleTime: STALE_30_MIN,
  });

export const useDeparturePoints = () =>
  useQuery({
    queryKey: ['departure_points'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('departure_points')
        .select('id, name, city, municipality')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    staleTime: STALE_30_MIN,
  });

export const usePlatformSettings = () =>
  useQuery({
    queryKey: ['platform_settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('service_charge_percentage, agency_commission_percentage')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: STALE_30_MIN,
  });

export const useTourPromotionsBatch = (tourIds: string[]) =>
  useQuery({
    queryKey: ['tour_promotions_batch', [...tourIds].sort().join(',')],
    queryFn: async () => {
      if (tourIds.length === 0) return {};
      const { data, error } = await supabase
        .rpc('get_promotions_for_tours', { p_tour_ids: tourIds });
      if (error) throw error;
      const map: Record<string, any> = {};
      (data ?? []).forEach((promo: any) => {
        map[promo.tour_id] = promo;
      });
      return map;
    },
    staleTime: 5 * 60 * 1000,
    enabled: tourIds.length > 0,
  });
