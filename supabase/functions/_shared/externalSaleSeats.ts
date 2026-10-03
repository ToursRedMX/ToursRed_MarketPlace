// Asientos de una venta externa para el correo del viajero.
// Pura a proposito: la funcion de correo hace las dos consultas y aqui solo se arma la lista.
export type EmailSeat={name:string;seat:number};
export type SeatTraveler={id:string;first_name:string;last_name:string|null};
export type SeatRow={seat_number:number;external_sale_traveler_id:string|null};
/** Solo viajeros con asiento, ordenados por numero de asiento. Una fila rara (sin viajero, sin numero valido) se ignora. */
export function buildEmailSeats(travelers:SeatTraveler[],rows:SeatRow[]):EmailSeat[] {
 const names=new Map(travelers.map(t=>[t.id,((t.first_name??'')+' '+(t.last_name??'')).trim()]));
 return rows
  .filter(r=>r.external_sale_traveler_id!==null&&names.has(r.external_sale_traveler_id)&&Number.isInteger(r.seat_number)&&r.seat_number>0)
  .map(r=>({name:names.get(r.external_sale_traveler_id as string) as string,seat:r.seat_number}))
  .sort((a,b)=>a.seat-b.seat);
}
