export type VehicleMapType = 'sprinter_20' | 'bus_50';

export type SeatStatusType = 'disponible' | 'reservado' | 'bloqueado';

export interface SeatDefinition {
  number: number;
  row: number;
  col: number;
  side: 'left' | 'right' | 'full';
  type: 'normal' | 'driver' | 'special' | 'wc';
}

export interface VehicleShape {
  totalRows: number;
  totalCols: number;
  aisleAfterCol: number;
  hasDriver: boolean;
  driverRow: number;
  driverCol: number;
  hasBathroom: boolean;
  bathroomRow?: number;
  bathroomCol?: number;
  aspectRatio: 'tall' | 'wide';
}

export interface VehicleSeatLayout {
  id: string;
  type: VehicleMapType;
  name: string;
  capacity: number;
  seats: SeatDefinition[];
  vehicle_shape: VehicleShape;
  is_active: boolean;
  display_order: number;
}

export interface SlotSeatStatus {
  id: string;
  tour_id: string;
  slot_id: string | null;
  agency_id: string;
  seat_number: number;
  status: SeatStatusType;
  booking_id: string | null;
  block_note: string | null;
  blocked_by: string | null;
  blocked_at: string | null;
}

export interface SeatWithStatus extends SeatDefinition {
  status: SeatStatusType;
  booking_id?: string | null;
  block_note?: string | null;
  traveler_name?: string | null;
  booking_code?: string | null;
}
