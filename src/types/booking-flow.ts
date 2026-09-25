import type { CodigoDeDescuento as DatosDelCodigoDeDescuento } from '../utils/descuentoDeReserva.ts';
import type { PromocionDeGrupo as PromocionVigente } from '../utils/promocionDeGrupo.ts';

import type { Tour } from './index';

export type TravelerCategory = 'adulto' | 'nino' | 'infante' | 'adulto_mayor' | 'mascota';

export type PaymentProvider = 'stripe' | 'mercadopago' | 'paypal' | 'conekta' | 'openpay' | 'toursred_cash';

export type ConektaMethod = 'bnpl' | 'card' | 'cash' | 'spei';

export type OpenpayMethod = 'card' | 'spei' | 'cash';

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
  /** Mismo dominio que `users.sexo` y que el CHECK de `booking_travelers`.
   *  `no_binario` faltaba aqui y en el selector del paso 2, asi que a quien
   *  lo tuviera guardado en su perfil no le cabia su propio dato. */
  sexo: 'masculino' | 'femenino' | 'no_binario' | '';
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
  /**
   * El CODIGO validado, no su importe. La RPC devuelve tipo, valor, tope y
   * ambito; el monto lo calcula el front sobre una base que cambia si el
   * viajero vuelve atras y toca los viajeros. Guardar el importe ya calculado
   * lo dejaria congelado contra un precio que ya no existe.
   */
  discountCodeMeta: DatosDelCodigoDeDescuento | null;
  insuranceDiscountCodeId: string | null;
  /** Mismo criterio que el del tour: se guarda el codigo, el monto se deriva. */
  insuranceDiscountMeta: DatosDelCodigoDeDescuento | null;
  /** La promocion de grupo vigente del tour, tal como la devuelve la RPC. */
  promocion: PromocionVigente | null;

  pointsUsed: number;
  toursredCashUsed: number;

  paymentProvider: PaymentProvider;
  conektaMethod: ConektaMethod;
  openpayMethod: OpenpayMethod;
  paymentMode: PaymentMode;
  customPaymentAmount: number | null;
  payNowMode: 'full' | 'partial';
  partialPaymentAmount: number;
  bnplProductType: 'aplazo_bnpl' | 'creditea_bnpl' | 'coppel_bnpl';

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
  discountCodeMeta: null,
  insuranceDiscountCodeId: null,
  insuranceDiscountMeta: null,
  promocion: null,
  pointsUsed: 0,
  toursredCashUsed: 0,
  paymentProvider: 'stripe',
  conektaMethod: 'card',
  openpayMethod: 'card',
  paymentMode: 'standard',
  customPaymentAmount: null,
  payNowMode: 'full',
  partialPaymentAmount: 0,
  bnplProductType: 'aplazo_bnpl',
  restrictionsAccepted: false,
  pendingRedirectMessage: null,
};

export function totalTravelerCount(counts: TravelerCounts): number {
  return counts.adultos + counts.ninos + counts.infantes + counts.adultos_mayores;
}

export function totalTravelerCountWithPets(counts: TravelerCounts): number {
  return totalTravelerCount(counts) + counts.mascotas;
}
