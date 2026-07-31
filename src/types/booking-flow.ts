import type { Tour } from './index';

export type TravelerCategory = 'adulto' | 'nino' | 'infante' | 'adulto_mayor' | 'mascota';

export type PaymentProvider = 'stripe' | 'mercadopago' | 'paypal' | 'conekta' | 'toursred_cash';

export type ConektaMethod = 'bnpl' | 'card' | 'cash' | 'spei';

export type PaymentMode = 'standard' | 'full_upfront' | 'payment_plan';

export interface TravelerCounts {
  adultos: number;
  ninos: number;
  infantes: number;
  adultos_mayores: number;
  mascotas: number;
}

export interface FlowTraveler {
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  fecha_nacimiento: string;
  tipo_documento: 'curp' | 'pasaporte' | '';
  numero_documento: string;
  curp: string;
  pasaporte: string;
  categoria_viajero: TravelerCategory;
  contacto_emergencia_nombre: string;
  contacto_emergencia_telefono: string;
  sexo: 'masculino' | 'femenino' | '';
  precio_aplicado: number;
}

export interface FlowOptionalService {
  tour_optional_service_id: string | null;
  service_kind: 'optional_service' | 'pickup' | 'language';
  description: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  service_charge: number;
  agency_commission: number;
  total_paid: number;
}

export interface TourSlot {
  id: string;
  slot_date: string;
  departure_time: string | null;
  capacity: number;
  booked_count: number;
  status: string;
}

export interface BookingFlowState {
  tourId: string;
  tourSlug: string;
  tour: Tour | null;

  step: 1 | 2 | 3 | 4;

  travelerCounts: TravelerCounts;

  selectedSlot: TourSlot | null;
  selectedDate: string | null;
  selectedTime: string | null;

  travelers: FlowTraveler[];

  selectedSeats: number[];
  seatsHeld: boolean;
  holdExpiresAt: string | null;

  optionalServices: FlowOptionalService[];
  pickupType: 'meeting_point' | 'pickup' | null;
  pickupZoneName: string | null;
  pickupHotelAddress: string | null;
  pickupExtraCost: number;
  selectedLanguage: string | null;
  languageExtraCost: number;

  addMembership: boolean;
  membershipPlan: 'mensual' | 'anual' | null;
  membershipCost: number;

  includeInsurance: boolean;
  insuranceCost: number;
  insuranceDays: number | null;

  discountCode: string;
  discountCodeId: string | null;
  discountAmount: number;
  insuranceDiscountCodeId: string | null;
  insuranceDiscountAmount: number;

  pointsUsed: number;
  toursredCashUsed: number;

  paymentProvider: PaymentProvider;
  conektaMethod: ConektaMethod;
  paymentMode: PaymentMode;
  customPaymentAmount: number | null;

  restrictionsAccepted: boolean;

  pendingRedirectMessage: string | null;
}

export const INITIAL_FLOW_STATE: BookingFlowState = {
  tourId: '',
  tourSlug: '',
  tour: null,
  step: 1,
  travelerCounts: { adultos: 0, ninos: 0, infantes: 0, adultos_mayores: 0, mascotas: 0 },
  selectedSlot: null,
  selectedDate: null,
  selectedTime: null,
  travelers: [],
  selectedSeats: [],
  seatsHeld: false,
  holdExpiresAt: null,
  optionalServices: [],
  pickupType: null,
  pickupZoneName: null,
  pickupHotelAddress: null,
  pickupExtraCost: 0,
  selectedLanguage: null,
  languageExtraCost: 0,
  addMembership: false,
  membershipPlan: null,
  membershipCost: 0,
  includeInsurance: false,
  insuranceCost: 0,
  insuranceDays: null,
  discountCode: '',
  discountCodeId: null,
  discountAmount: 0,
  insuranceDiscountCodeId: null,
  insuranceDiscountAmount: 0,
  pointsUsed: 0,
  toursredCashUsed: 0,
  paymentProvider: 'stripe',
  conektaMethod: 'card',
  paymentMode: 'standard',
  customPaymentAmount: null,
  restrictionsAccepted: false,
  pendingRedirectMessage: null,
};

export function totalTravelerCount(counts: TravelerCounts): number {
  return counts.adultos + counts.ninos + counts.infantes + counts.adultos_mayores;
}

export function totalTravelerCountWithPets(counts: TravelerCounts): number {
  return totalTravelerCount(counts) + counts.mascotas;
}
