import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import type { VehicleSeatLayout } from '../../types/seats';

// Quien ocupa un asiento. groupId agrupa los asientos de una misma reserva para resaltarlos juntos.
export type SeatOwner = { groupId: string; label: string; color: string };
export const EXTERNAL_COLOR = '#d97706';

// Una paleta corta que se repite: lo importante es distinguir reservas vecinas, no identificarlas.
export const BOOKING_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0d9488', '#ca8a04', '#4f46e5', '#059669'];

/** Lee el mapa de la salida (tour_slots.vehicle_map_type) y, si no tiene uno propio, el del tour. */
export async function fetchSeatLayout(tourId: string, slotId?: string | null): Promise<{ layout: VehicleSeatLayout | null; slotOverride: boolean }> {
  let mapType: string | null = null;
  let slotOverride = false;
  if (slotId) {
    const { data: slot, error: slotError } = await supabase.from('tour_slots').select('vehicle_map_type').eq('id', slotId).maybeSingle();
    if (slotError) throw slotError;
    mapType = slot?.vehicle_map_type ?? null;
    slotOverride = !!mapType;
  }
  if (!mapType) {
    const { data: tour, error: tourError } = await supabase.from('tours').select('vehicle_map_type').eq('id', tourId).maybeSingle();
    if (tourError) throw tourError;
    mapType = tour?.vehicle_map_type ?? null;
  }
  if (!mapType) return { layout: null, slotOverride };
  const { data, error } = await supabase.from('vehicle_seat_layouts').select('*').eq('type', mapType).eq('is_active', true).maybeSingle();
  if (error) throw error;
  if (!data) return { layout: null, slotOverride };
  return {
    slotOverride,
    layout: {
      ...data,
      seats: typeof data.seats === 'string' ? JSON.parse(data.seats) : data.seats,
      vehicle_shape: typeof data.vehicle_shape === 'string' ? JSON.parse(data.vehicle_shape) : data.vehicle_shape,
    } as VehicleSeatLayout,
  };
}

export function useLayout(tourId: string, slotId?: string | null) {
  return useQuery({
    queryKey: ['agenda-seat-layout', tourId, slotId ?? null],
    staleTime: 60_000,
    enabled: !!tourId,
    queryFn: async (): Promise<VehicleSeatLayout | null> => (await fetchSeatLayout(tourId, slotId)).layout,
  });
}

/** Indica si el tour tiene mapa de asientos. Comparte cache con el mapa. */
export function useHasSeatMap(tourId: string, slotId?: string | null) {
  const q = useLayout(tourId, slotId);
  return { loading: q.isPending, hasMap: !!q.data, layout: q.data ?? null, error: q.error };
}

