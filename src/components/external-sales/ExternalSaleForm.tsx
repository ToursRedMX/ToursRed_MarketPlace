import { useState } from 'react';
import type { FormEvent } from 'react';
import type { ExternalSale, ExternalTraveler, Operation } from '../../types/externalSales';
import { CHANNELS, PAYMENT_METHODS, EXTERNAL_NOTICE, operationKey } from '../../types/externalSales';
import { saveExternalSale, errorText } from '../../lib/externalSales';
const field='w-full border rounded-lg px-3 py-2 bg-white';
const blankTraveler = (): ExternalTraveler => ({first_name:'',last_name:'',traveler_type:'adulto',is_primary:false});
export default function ExternalSaleForm({operations,existing,onSaved,onClose}:{operations:Operation[];existing?:ExternalSale;onSaved:(id:string)=>void;onClose:()=>void}) {
 const [departure,setDeparture]=useState(existing?operationKey(existing):'');
 const [source,setSource]=useState(existing?.source??'whatsapp');
 const [reference,setReference]=useState(existing?.external_reference??'');
 const [name,setName]=useState(existing?.primary_traveler_name??'');
 const [email,setEmail]=useState(existing?.primary_traveler_email??'');
 const [phone,setPhone]=useState(existing?.primary_traveler_phone??'');
 const [total,setTotal]=useState(String(existing?.external_sale_financials?.total_sale_amount??0));
 const [paid,setPaid]=useState(String(existing?.external_sale_financials?.amount_paid??0));
 const [currency,setCurrency]=useState(existing?.external_sale_financials?.currency??'MXN');
 const [method,setMethod]=useState(existing?.external_sale_financials?.payment_method??'cash');
 const [notes,setNotes]=useState(existing?.notes??'');
 const [consent,setConsent]=useState(existing?.operational_email_authorized??false);
 const [travelers,setTravelers]=useState<ExternalTraveler[]>(existing?.external_sale_travelers.filter(t=>!t.is_cancelled)??[{...blankTraveler(),is_primary:true}]);
 const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 const op=operations.find(o=>operationKey(o)===departure);
 const pending=Number(total)-Number(paid);
 async function submit(e:FormEvent) {
 e.preventDefault(); if(!op) return;
 setBusy(true); setError('');
 try {
 const id=await saveExternalSale({tour_id:op.tour_id,slot_id:op.slot_id,source,external_reference:reference,primary_traveler_name:name,
 primary_traveler_email:email,primary_traveler_phone:phone,total_sale_amount:Number(total),amount_paid:Number(paid),currency,payment_method:method,notes,operational_email_authorized:consent},travelers,existing);
 onSaved(id);
 } catch(e) {setError(errorText(e));} finally {setBusy(false);}
 }
 function travelerField(index:number,key:keyof ExternalTraveler,value:string) {setTravelers(ts=>ts.map((t,i)=>i===index?{...t,[key]:value}:t));}
 return <div className="fixed inset-0 z-50 bg-black/40 overflow-y-auto p-4" role="dialog" aria-modal="true" aria-labelledby="external-form-title">
 <form onSubmit={submit} className="max-w-3xl mx-auto bg-white rounded-xl p-6 space-y-5">
 <div className="flex justify-between"><h2 id="external-form-title" className="text-xl font-bold">{existing?'Editar venta externa':'Registrar venta externa'}</h2><button type="button" onClick={onClose} disabled={busy}>Cerrar</button></div>
 <p className="text-sm text-gray-600">Registrada manualmente · Herramienta gratuita</p>
 {error&&<p role="alert" className="bg-red-50 text-red-800 p-3">{error}</p>}
 <label className="block">Tour / fecha / horario<select required className={field} value={departure} onChange={e=>setDeparture(e.target.value)}>
 <option value="">Selecciona una salida</option>{operations.filter(o=>!existing||o.tour_id===existing.tour_id).filter(o=>o.status==='activo'||o.status==='lleno').map(o=><option key={operationKey(o)} value={operationKey(o)}>{o.tour_name} · {o.departure_date} {o.departure_time?.slice(0,5)} · {o.available} disponibles</option>)}</select></label>
 {op&&<p className="text-sm">Capacidad {op.capacity} · ToursRed {op.marketplace} · Externos {op.external} · Disponibles {op.available}</p>}
 <div className="grid md:grid-cols-2 gap-4">
 <label>Canal de venta<select className={field} value={source} onChange={e=>setSource(e.target.value)}>{Object.entries(CHANNELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
 <label>Referencia externa (opcional)<input className={field} maxLength={200} value={reference} onChange={e=>setReference(e.target.value)}/></label>
 <label>Nombre del contacto principal<input required className={field} maxLength={200} value={name} onChange={e=>setName(e.target.value)}/></label>
 <label>Correo electrónico<input type="email" maxLength={254} className={field} value={email} onChange={e=>setEmail(e.target.value)}/></label>
 <label>Teléfono<input type="tel" maxLength={40} className={field} value={phone} onChange={e=>setPhone(e.target.value)}/></label>
 </div>
 <fieldset className="space-y-3"><legend className="font-semibold">Viajeros y acompañantes ({travelers.length})</legend>
 <label className="block">Cantidad de viajeros<input type="number" min="1" max="1000" className={field} value={travelers.length} onChange={e=>{const count=Number(e.target.value);if(Number.isInteger(count)&&count>=1&&count<=1000)setTravelers(ts=>Array.from({length:count},(_,i)=>ts[i]??blankTraveler()));}}/></label>
 {travelers.map((t,i)=><div key={t.id??i} className="grid sm:grid-cols-4 gap-2 border-b pb-3">
 <label>Nombre {i===0?'(principal)':''}<input required maxLength={150} className={field} value={t.first_name} onChange={e=>travelerField(i,'first_name',e.target.value)}/></label>
 <label>Apellidos<input required maxLength={150} className={field} value={t.last_name} onChange={e=>travelerField(i,'last_name',e.target.value)}/></label>
 <label>Tipo<select className={field} value={t.traveler_type} onChange={e=>travelerField(i,'traveler_type',e.target.value)}><option value="adulto">Adulto</option><option value="nino">Niño</option><option value="infante">Infante</option><option value="adulto_mayor">Adulto mayor</option><option value="mascota">Mascota</option></select></label>
 {i>0&&<button type="button" onClick={()=>setTravelers(ts=>ts.filter((_,j)=>j!==i))}>Quitar acompañante</button>}
 </div>)}
 <button type="button" className="text-blue-700 underline" disabled={travelers.length>=1000} onClick={()=>setTravelers(ts=>[...ts,blankTraveler()])}>Agregar acompañante</button>
 </fieldset>
 <fieldset className="bg-amber-50 p-4 rounded-lg space-y-3"><legend className="font-semibold">Control interno de la agencia</legend><p className="text-sm">{EXTERNAL_NOTICE}</p>
 <div className="grid sm:grid-cols-3 gap-3">
 <label>Total<input required type="number" min="0" max="999999999999.99" step="0.01" className={field} value={total} onChange={e=>setTotal(e.target.value)}/></label>
 <label>Pagado<input required type="number" min="0" max={total} step="0.01" className={field} value={paid} onChange={e=>setPaid(e.target.value)}/></label>
 <label>Pendiente<output className="block p-2">{Number.isFinite(pending)?pending.toFixed(2):'—'}</output></label>
 <label>Moneda<select className={field} value={currency} onChange={e=>setCurrency(e.target.value)}><option>MXN</option><option>USD</option><option>EUR</option></select></label>
 <label>Método de pago<select className={field} value={method} onChange={e=>setMethod(e.target.value)}>{Object.entries(PAYMENT_METHODS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
 </div></fieldset>
 <label className="block">Notas internas<textarea maxLength={4000} className={field} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
 <label className="flex gap-2"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>El viajero autorizó usar este correo para recibir información operativa de esta reservación. No se enviará marketing ni se creará una cuenta.</label>
 <button disabled={busy||pending<0||!op} className="bg-blue-700 text-white rounded-lg px-5 py-2 disabled:opacity-50">{busy?'Guardando…':'Guardar venta externa'}</button>
 </form></div>;
}
