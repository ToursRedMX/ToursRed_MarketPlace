import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import type { VehicleSeatLayout } from '../../types/seats';

// Quien ocupa un asiento. groupId agrupa los asientos de una misma reserva para resaltarlos juntos.
export type SeatOwner = { groupId: string; label: string; color: string };
export const EXTERNAL_COLOR = '#d97706';

// Una paleta corta que se repite: lo importante es distinguir reservas vecinas, no identificarlas.
export const BOOKING_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0d9488', '#ca8a04', '#4f46e5', '#059669'];

export function useLayout(tourId: string) {
  return useQuery({
    queryKey: ['agenda-seat-layout', tourId],
    staleTime: 5 * 60_000,
    enabled: !!tourId,
    queryFn: async (): Promise<VehicleSeatLayout | null> => {
      const { data: tour, error: tourError } = await supabase.from('tours').select('vehicle_map_type').eq('id', tourId).maybeSingle();
      if (tourError) throw tourError;
      if (!tour?.vehicle_map_type) return null;
      const { data, error } = await supabase.from('vehicle_seat_layouts').select('*').eq('type', tour.vehicle_map_type).eq('is_active', true).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        ...data,
        seats: typeof data.seats === 'string' ? JSON.parse(data.seats) : data.seats,
        vehicle_shape: typeof data.vehicle_shape === 'string' ? JSON.parse(data.vehicle_shape) : data.vehicle_shape,
      } as VehicleSeatLayout;
    },
  });
}

/** Indica si el tour tiene mapa de asientos. Comparte cache con el mapa. */
export function useHasSeatMap(tourId: string) {
  const q = useLayout(tourId);
  return { loading: q.isPending, hasMap: !!q.data, layout: q.data ?? null, error: q.error };
}

