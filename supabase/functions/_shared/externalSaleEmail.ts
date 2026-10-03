export type ExternalEmail = {
 agency: {name:string;logo:string|null;contact_email:string}; tour_name:string; date:string; time:string|null;
 travelers_count:number;meeting:string|null;
 // Asientos ya asignados a los viajeros de esta venta (opcional: sin asientos el correo sale igual).
 seats?:{name:string;seat:number}[];
};
const escapeHtml=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function safeImage(url:string|null) {try {const u=new URL(url??'');return u.protocol==='https:'?escapeHtml(u.href):'';}catch{return '';}}
// Un solo viajero con un solo asiento: "Asiento asignado: 7". Varios: una linea por viajero, con su nombre.
function seatsHtml(data:ExternalEmail) {
 const seats=(data.seats??[]).filter(s=>Number.isInteger(s.seat)&&s.seat>0);
 if(!seats.length) return '';
 if(data.travelers_count===1&&seats.length===1) return '<p>Asiento asignado: <strong>'+seats[0].seat+'</strong></p>';
 return '<p>Asientos asignados:<br>'+seats.map(s=>escapeHtml(s.name||'Viajero')+': asiento <strong>'+s.seat+'</strong>').join('<br>')+'</p>';
}
export function externalEmailHtml(data:ExternalEmail,platformLogo:string) {
 const logo=safeImage(data.agency.logo);
 return '<!doctype html><html lang="es"><body style="font-family:Arial,sans-serif;color:#243047;max-width:600px;margin:auto;padding:24px">'+
 (logo?'<img src="'+logo+'" alt="'+escapeHtml(data.agency.name)+'" width="160"/>':'')+
 '<h1>'+escapeHtml(data.agency.name)+'</h1><p>'+escapeHtml(data.agency.name)+' ha registrado tu reservación para '+escapeHtml(data.tour_name)+'.</p>'+
 '<p>Fecha: '+escapeHtml(data.date)+'<br>Horario: '+escapeHtml(data.time?.slice(0,5)??'Consulta con tu agencia')+'<br>Viajeros: '+data.travelers_count+'</p>'+
 seatsHtml(data)+
 (data.meeting?'<p>Punto de encuentro: '+escapeHtml(data.meeting)+'</p>':'')+
 '<h2>Tu QR de check-in</h2><img src="cid:checkin.png" alt="QR de check-in" width="240" height="240"/>'+
 '<p>Presenta este QR al personal de tu agencia el día de la salida. Identifica a tu grupo; no lo compartas públicamente.</p>'+
 '<p>Esta reservación fue realizada directamente con '+escapeHtml(data.agency.name)+'. ToursRed proporciona la tecnología de gestión y check-in; no recibió el pago ni actúa como vendedor u operador de esta reservación.</p>'+
 '<hr><p style="font-size:12px">Powered by ToursRed</p><img src="'+safeImage(platformLogo)+'" width="80" alt="ToursRed"/></body></html>';
}
