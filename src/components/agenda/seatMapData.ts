import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import type { VehicleSeatLayout } from '../../types/seats';
import { tipoDeMapaEfectivo, cargarLayoutDeMapa } from '../../lib/mapaDeAsientos';

// Quien ocupa un asiento. groupId agrupa los asientos de una misma reserva para resaltarlos juntos.
export type SeatOwner = { groupId: string; label: string; color: string };
export const EXTERNAL_COLOR = '#d97706';

// Una paleta corta que se repite: lo importante es distinguir reservas vecinas, no identificarlas.
export const BOOKING_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0d9488', '#ca8a04', '#4f46e5', '#059669'];

/** Mapa del HORARIO si tiene uno propio, y si no el del tour (cada salida puede usar otro vehiculo). */
export function useLayout(tourId: string, slotId?: string | null) {
  return useQuery({
    queryKey: ['agenda-seat-layout', tourId, slotId ?? null],
    staleTime: 5 * 60_000,
    enabled: !!tourId,
    queryFn: async (): Promise<VehicleSeatLayout | null> => {
      const mapa = await tipoDeMapaEfectivo(supabase, tourId, slotId);
      if (mapa.error) throw new Error('No se pudo leer el mapa del horario');
      if (!mapa.tipo) return null;
      return cargarLayoutDeMapa(supabase, mapa.tipo);
    },
  });
}

/** Indica si la salida tiene mapa de asientos. Comparte cache con el mapa. */
export function useHasSeatMap(tourId: string, slotId?: string | null) {
  const q = useLayout(tourId, slotId);
  return { loading: q.isPending, hasMap: !!q.data, layout: q.data ?? null, error: q.error };
}

