// Mapa de asientos por horario y capacidad como tope (31-oct-2026).
//
// El MAPA (el vehiculo) es del tour y, si el horario tiene uno propio, ese manda: un tour con Sprinter por omision puede usar un autobus de
// 60 solo en los horarios de mucha demanda. La CAPACIDAD es lo que se vende y puede ser MENOR que los asientos del mapa (un hotel o un lugar
// con menos cupo que el autobus), pero nunca mayor. La base lo hace cumplir con triggers; aqui vive la misma regla para avisar antes.
//
// Espejo de public.effective_vehicle_map_type(tour, slot): si cambias una, cambia la otra (lo vigila scripts/test-mapa-por-horario.mjs).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VehicleMapType, VehicleSeatLayout } from '../types/seats';

export interface OpcionDeVehiculo {
  type: VehicleMapType;
  label: string;
  capacity: number;
  description: string;
}

export const OPCIONES_DE_VEHICULO: OpcionDeVehiculo[] = [
  { type: 'sprinter_20', label: 'Sprinter / Van', capacity: 20, description: '20 pasajeros' },
  { type: 'bus_50', label: 'Autobus', capacity: 50, description: '50 pasajeros' },
  { type: 'hiace_14', label: 'Toyota Hiace', capacity: 14, description: '14 pasajeros' },
  { type: 'urvan_13', label: 'Nissan Urvan', capacity: 13, description: '13 pasajeros' },
  { type: 'bus_60_2pisos', label: 'Autobus 2 pisos', capacity: 60, description: '60 pasajeros' },
];

export function opcionDeVehiculo(tipo: string | null | undefined): OpcionDeVehiculo | null {
  return OPCIONES_DE_VEHICULO.find((o) => o.type === tipo) ?? null;
}

/** El mapa del horario, y si no tiene propio, el del tour. */
export function mapaEfectivo(
  mapaDelHorario: string | null | undefined,
  mapaDelTour: string | null | undefined,
): string | null {
  return mapaDelHorario || mapaDelTour || null;
}

export type EstadoDeCapacidad =
  | { estado: 'sin_mapa' | 'sin_capacidad' | 'igual' }
  | { estado: 'menor' | 'excede'; capacidad: number; asientos: number; mensaje: string };

/**
 * Compara los cupos que se venden contra los asientos del vehiculo.
 *  - menor:  valido (un lugar con menos cupo que el autobus). Solo informa.
 *  - excede: invalido. La base tambien lo rechaza.
 */
export function evaluarCapacidad(capacidad: number | null | undefined, asientosDelMapa: number | null | undefined): EstadoDeCapacidad {
  if (!asientosDelMapa || asientosDelMapa <= 0) return { estado: 'sin_mapa' };
  if (!capacidad || capacidad <= 0 || !Number.isFinite(capacidad)) return { estado: 'sin_capacidad' };
  if (capacidad > asientosDelMapa) {
    return {
      estado: 'excede',
      capacidad,
      asientos: asientosDelMapa,
      mensaje: `Los cupos (${capacidad}) no pueden ser mayores a los asientos del vehiculo (${asientosDelMapa}).`,
    };
  }
  if (capacidad < asientosDelMapa) {
    return {
      estado: 'menor',
      capacidad,
      asientos: asientosDelMapa,
      mensaje: `Se venden ${capacidad} de los ${asientosDelMapa} asientos del vehiculo. Es valido si el lugar tiene menos cupo que el vehiculo.`,
    };
  }
  return { estado: 'igual' };
}

/**
 * Al elegir un vehiculo, los cupos lo siguen mientras el usuario no los haya personalizado: si estan vacios o eran los del vehiculo anterior se
 * actualizan; si puso un numero propio (por ejemplo 20 en un autobus de 60), se respeta.
 */
export function cuposSugeridos(
  cuposActuales: string | number | null | undefined,
  vehiculoAnterior: string | null | undefined,
  vehiculoNuevo: string | null | undefined,
): string {
  const nuevo = opcionDeVehiculo(vehiculoNuevo);
  const actual = cuposActuales === null || cuposActuales === undefined ? '' : String(cuposActuales).trim();
  if (!nuevo) return actual;
  if (actual === '') return String(nuevo.capacity);
  const anterior = opcionDeVehiculo(vehiculoAnterior);
  if (anterior && Number(actual) === anterior.capacity) return String(nuevo.capacity);
  return actual;
}

export function parsearLayout(fila: Record<string, unknown>): VehicleSeatLayout {
  const seats = fila.seats;
  const forma = fila.vehicle_shape;
  return {
    ...fila,
    seats: typeof seats === 'string' ? JSON.parse(seats) : seats,
    vehicle_shape: typeof forma === 'string' ? JSON.parse(forma) : forma,
  } as unknown as VehicleSeatLayout;
}

type Cliente = Pick<SupabaseClient, 'from'>;

/** Tipo de mapa efectivo de un horario (o del tour si no hay horario) y la capacidad del horario. */
export async function tipoDeMapaEfectivo(
  cliente: Cliente,
  tourId: string,
  slotId?: string | null,
): Promise<{ tipo: string | null; capacidadDelHorario: number | null; error: boolean }> {
  const { data: tour, error: errTour } = await cliente.from('tours').select('vehicle_map_type').eq('id', tourId).maybeSingle();
  if (errTour) return { tipo: null, capacidadDelHorario: null, error: true };
  let mapaDelHorario: string | null = null;
  let capacidadDelHorario: number | null = null;
  if (slotId) {
    const { data: slot, error: errSlot } = await cliente
      .from('tour_slots')
      .select('vehicle_map_type, capacity')
      .eq('id', slotId)
      .eq('tour_id', tourId)
      .maybeSingle();
    if (errSlot) return { tipo: null, capacidadDelHorario: null, error: true };
    mapaDelHorario = (slot?.vehicle_map_type as string | null | undefined) ?? null;
    capacidadDelHorario = typeof slot?.capacity === 'number' ? slot.capacity : null;
  }
  return { tipo: mapaEfectivo(mapaDelHorario, tour?.vehicle_map_type as string | null | undefined), capacidadDelHorario, error: false };
}

export async function cargarLayoutDeMapa(cliente: Cliente, tipo: string): Promise<VehicleSeatLayout | null> {
  const { data, error } = await cliente.from('vehicle_seat_layouts').select('*').eq('type', tipo).eq('is_active', true).maybeSingle();
  if (error || !data) return null;
  return parsearLayout(data as Record<string, unknown>);
}
