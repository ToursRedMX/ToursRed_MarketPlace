import { supabase } from './supabase';
import type { Operation, ExternalSale, ManifestRow, ExternalTraveler, DepartureReservation, DepartureSeat } from '../types/externalSales';
export async function loadOperations(agency: string, from: string, to: string): Promise<Operation[]> {
 const rows:Operation[]=[];
 for(let offset=0;;offset+=500) {
 const {data,error}=await supabase.rpc('get_agency_operations',{p_agency_id:agency,p_from:from,p_to:to}).range(offset,offset+499);
 if(error) throw error; rows.push(...(data??[]));if(!data||data.length<500)break;
 } return rows;
}
export async function loadExternalSales(agency: string, from: string, to: string): Promise<ExternalSale[]> {
 const rows: ExternalSale[]=[];
 // Pagination keeps indicators honest beyond the default PostgREST 1000-row limit.
 for(let offset=0;;offset+=500) {
 const {data,error}=await supabase.from('external_sales').select('*,tours(name),external_sale_financials(*),external_sale_travelers(*)')
 .eq('agency_id',agency).gte('departure_date',from).lte('departure_date',to).order('id').range(offset,offset+499);
 if(error) throw error;
 rows.push(...(data as ExternalSale[] ?? []));
 if(!data || data.length<500) break;
 } return rows.map(s=>({...s,external_sale_travelers:[...s.external_sale_travelers].sort((a,b)=>Number(b.is_primary)-Number(a.is_primary))}));
}
export async function loadManifest(tour: string, slot: string|null): Promise<ManifestRow[]> {
 const rows:ManifestRow[]=[];
 for(let offset=0;;offset+=500) {
 const {data,error}=await supabase.rpc('get_operational_manifest',{p_tour_id:tour,p_slot_id:slot}).range(offset,offset+499);
 if(error) throw error; rows.push(...(data??[]));if(!data||data.length<500)break;
 } return rows;
}
export async function loadDepartureReservations(tour: string, slot: string|null): Promise<DepartureReservation[]> {
 const {data,error}=await supabase.rpc('get_departure_reservations',{p_tour_id:tour,p_slot_id:slot});
 if(error) throw error;
 // numeric llega como string o number segun el driver: se normaliza una sola vez aqui.
 const n=(v:unknown)=>v==null?null:Number(v);
 return ((data??[]) as DepartureReservation[]).map(r=>({...r,total_amount:n(r.total_amount),collected_amount:n(r.collected_amount),pending_amount:n(r.pending_amount),release_pending_amount:n(r.release_pending_amount),released_amount:n(r.released_amount)}));
}
export async function loadDepartureSeats(tour: string, slot: string|null): Promise<DepartureSeat[]> {
 const {data,error}=await supabase.rpc('get_departure_seats',{p_tour_id:tour,p_slot_id:slot});
 if(error) throw error; return (data??[]) as DepartureSeat[];
}
export async function saveExternalSale(sale: Record<string,unknown>,travelers: ExternalTraveler[],existing?: ExternalSale) {
 const {data,error}=await supabase.rpc('save_external_sale',{p_sale:sale,p_travelers:travelers,p_id:existing?.id ?? null,p_version:existing?.version ?? null});
 if(error) throw error; return data as string;
}
export async function cancelExternalSale(sale:ExternalSale,reason:string) {
 const {error}=await supabase.rpc('cancel_external_sale',{p_id:sale.id,p_reason:reason,p_version:sale.version}); if(error) throw error;
}
export async function generateExternalQr(id:string) {
 const {data,error}=await supabase.rpc('generate_external_sale_qr',{p_id:id}); if(error) throw error; return data as string;
}
export function externalQrUrl(sale: Pick<ExternalSale,'tour_id'|'slot_id'>, token:string) {
 const url=new URL('/agency/agenda',window.location.origin);
 url.searchParams.set('tour',sale.tour_id); if(sale.slot_id) url.searchParams.set('slot',sale.slot_id);
 url.hash='external-qr='+token; return url.toString();
}
export async function checkinExternal(token:string,agency:string,op:Operation) {
 const {data,error}=await supabase.rpc('checkin_external_sale',{p_token:token,p_agency_id:agency,p_tour_id:op.tour_id,p_slot_id:op.slot_id});
 if(error) throw error; return data as {already_checked_in:boolean;checked_in:number};
}
export function errorText(error:unknown) { return error instanceof Error ? error.message : typeof error==='object' && error && 'message' in error ? String(error.message) : 'No se pudo completar la operación'; }
