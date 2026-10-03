export type Operation = {
 tour_id: string; slot_id: string | null; tour_name: string; departure_date: string; departure_time: string | null;
 capacity: number; marketplace: number; external: number; blocked: number; held: number; available: number; status: string;
};
export type ExternalTraveler = { id?: string; first_name: string; last_name: string; email?: string | null; phone?: string | null; traveler_type: string; is_primary: boolean; is_cancelled?: boolean; checked_in_at?: string | null };
export type ExternalFinancials = { total_sale_amount: number; amount_paid: number; amount_pending: number; currency: string; payment_method: string };
export type ExternalSale = {
 id: string; tour_id: string; slot_id: string | null; agency_id: string; departure_date: string; departure_time: string | null;
 source: string; external_reference: string | null; primary_traveler_name: string; primary_traveler_email: string | null; primary_traveler_phone: string | null;
 travelers_count: number; notes: string | null; status: 'active' | 'cancelled'; version: number; qr_enabled: boolean; qr_sent_at: string | null;
 tours: { name: string } | null;
 operational_email_authorized: boolean; external_sale_financials: ExternalFinancials | null; external_sale_travelers: ExternalTraveler[];
};
export type ManifestRow = { origin: 'ToursRed' | 'Externa'; reservation_id: string; traveler_id: string | null; traveler_name: string; traveler_type: string; email: string | null; phone: string | null; people: number; status: string; checked_in_at: string | null };
// Una fila por reserva de la salida (ToursRed o externa). Las columnas de dinero
// vienen NULL cuando quien consulta no tiene permiso financiero.
export type DepartureReservation = {
 origin: 'ToursRed' | 'Externa'; reservation_id: string; reservation_code: string | null;
 holder_name: string; holder_email: string | null; holder_phone: string | null;
 people: number; status: string; payment_status: string | null; has_payment_plan: boolean;
 channel: string | null; external_reference: string | null; notes: string | null; created_at: string;
 total_amount: number | null; collected_amount: number | null; pending_amount: number | null;
 release_pending_amount: number | null; released_amount: number | null; currency: string | null;
};
export type DepartureSeat = { seat_number: number; status: 'reservado_online' | 'bloqueado_agencia' | string; booking_id: string | null; block_note: string | null };
export const CHANNELS: Record<string,string> = { whatsapp:'WhatsApp',facebook:'Facebook',instagram:'Instagram',website:'Sitio web propio',office:'Oficina',phone:'Teléfono',direct:'Venta directa',other:'Otro' };
export const PAYMENT_METHODS: Record<string,string> = { cash:'Efectivo',bank_transfer:'Transferencia bancaria',card:'Tarjeta (fuera de ToursRed)',other:'Otro' };
export const EXTERNAL_NOTICE = 'Esta venta fue realizada fuera de ToursRed. Los importes capturados son únicamente para tu control interno y no generan comisión ni movimientos financieros en ToursRed.';
export const operationKey = (o: Pick<Operation,'tour_id'|'slot_id'>) => o.tour_id + ':' + (o.slot_id ?? 'fixed');
