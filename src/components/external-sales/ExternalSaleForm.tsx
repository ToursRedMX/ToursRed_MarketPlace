import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Armchair, CalendarDays, Info, Plus, Trash2, UserRound, Users, Wallet, X } from 'lucide-react';
import type { DepartureSeat, ExternalSale, ExternalTraveler, Operation } from '../../types/externalSales';
import { CHANNELS, PAYMENT_METHODS, EXTERNAL_NOTICE, operationKey } from '../../types/externalSales';
import { assignExternalSeats, loadDepartureSeats, saveExternalSale, sendExternalQrEmail, errorText } from '../../lib/externalSales';
import AgendaSeatMap from '../agenda/AgendaSeatMap';
import { EXTERNAL_COLOR, useHasSeatMap } from '../agenda/seatMapData';
import { OccupancyBar } from '../agenda/shared';
import { dayLabel, time5 } from '../agenda/helpers';
import type { SeatOwner } from '../agenda/seatMapData';
const ctl='mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200';
const lbl='block text-sm font-medium text-slate-700';
function Section({n,icon,title,hint,children,className='border-slate-200 bg-white'}:{n:number;icon:ReactNode;title:string;hint?:string;children:ReactNode;className?:string}) {
 return <section className={`rounded-2xl border p-4 sm:p-5 ${className}`}>
  <header className="mb-3 flex items-start gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-700 text-sm font-bold text-white" aria-hidden>{n}</span>
   <div><h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">{icon}{title}</h3>{hint&&<p className="text-sm text-slate-500">{hint}</p>}</div></header>
  <div className="space-y-4">{children}</div>
 </section>;
}
// El id nace aqui para poder asignar asiento justo despues de guardar, sin esperar a que la base lo invente.
const blankTraveler = (): ExternalTraveler => ({id:crypto.randomUUID(),first_name:'',last_name:'',traveler_type:'adulto',is_primary:false});
export default function ExternalSaleForm({operations,existing,onSaved,onClose}:{operations:Operation[];existing?:ExternalSale;onSaved:(id:string,warning?:string,emailSent?:boolean)=>void;onClose:()=>void}) {
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
 const [sendEmail,setSendEmail]=useState(false);
 const [travelers,setTravelers]=useState<ExternalTraveler[]>(existing?.external_sale_travelers.filter(t=>!t.is_cancelled)??[{...blankTraveler(),is_primary:true}]);
 const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 const op=operations.find(o=>operationKey(o)===departure);
 // Asientos: lo elegido en este formulario (por id de viajero) manda sobre lo que ya hay guardado.
 const [chosen,setChosen]=useState<Record<string,number|null>>({});
 const [picking,setPicking]=useState<string|null>(null);
 const {hasMap}=useHasSeatMap(op?.tour_id??'');
 const seatsQ=useQuery({queryKey:['form-seats',op?.tour_id,op?.slot_id],enabled:!!op&&hasMap,queryFn:()=>loadDepartureSeats(op!.tour_id,op!.slot_id)});
 // Si cambia la salida de una venta existente, sus asientos se sueltan solos en la base.
 const sameDeparture=!existing||departure===operationKey(existing);
 const myIds=useMemo(()=>new Set(travelers.map(t=>t.id as string)),[travelers]);
 const savedSeat=useMemo(()=>{const m=new Map<string,number>();if(sameDeparture)(seatsQ.data??[]).forEach(s=>{if(s.external_traveler_id&&myIds.has(s.external_traveler_id))m.set(s.external_traveler_id,s.seat_number);});return m;},[seatsQ.data,myIds,sameDeparture]);
 const seatByTraveler=useMemo(()=>{const m=new Map<string,number|null>();travelers.forEach(t=>{const id=t.id as string;m.set(id,id in chosen?chosen[id]:(savedSeat.get(id)??null));});return m;},[travelers,chosen,savedSeat]);
 const seatOf=(t:ExternalTraveler):number|null=>seatByTraveler.get(t.id as string)??null;
 const travelerLabel=(t:ExternalTraveler,i:number)=>(t.first_name+' '+t.last_name).trim()||'Viajero '+(i+1);
 // Para el mapa: lo ocupado por otros + lo que este formulario le asigna a cada viajero.
 const mapSeats:DepartureSeat[]=useMemo(()=>[
  ...(seatsQ.data??[]).filter(s=>!(s.external_traveler_id&&myIds.has(s.external_traveler_id))),
  ...travelers.flatMap(t=>{const n=seatByTraveler.get(t.id as string)??null;return n===null?[]:[{seat_number:n,status:'reservado_online',booking_id:null,block_note:null,external_traveler_id:t.id as string}];}),
 ],[seatsQ.data,myIds,travelers,seatByTraveler]);
 const resolveSeat=(s:DepartureSeat):SeatOwner|null=>{
  if(s.external_traveler_id&&myIds.has(s.external_traveler_id)){const i=travelers.findIndex(t=>t.id===s.external_traveler_id);return {groupId:s.external_traveler_id,color:EXTERNAL_COLOR,label:travelerLabel(travelers[i],i)+' (esta venta)'};}
  if(s.booking_id)return {groupId:s.booking_id,color:'#64748b',label:'Reservado en ToursRed'};
  if(s.external_traveler_id)return {groupId:s.external_traveler_id,color:'#94a3b8',label:'Venta externa'};
  return null;
 };
 const pending=Number(total)-Number(paid);
 // Mismo criterio que la base (prepare_external_sale_email): correo con forma valida Y autorizacion operativa.
 const canEmail=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())&&consent;
 const paidPct=Number(total)>0&&Number.isFinite(pending)?Math.min(100,Math.max(0,Math.round(Number(paid)/Number(total)*100))):0;
 const fmt=(n:number)=>Number.isFinite(n)?new Intl.NumberFormat('es-MX',{style:'currency',currency}).format(n):'—';
 // Mientras el formulario esta abierto la pagina de atras no debe desplazarse.
 useEffect(()=>{const prev=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=prev;};},[]);
 async function submit(e:FormEvent) {
 e.preventDefault(); if(!op) return;
 setBusy(true); setError('');
 try {
 const id=await saveExternalSale({tour_id:op.tour_id,slot_id:op.slot_id,source,external_reference:reference,primary_traveler_name:name,
 primary_traveler_email:email,primary_traveler_phone:phone,total_sale_amount:Number(total),amount_paid:Number(paid),currency,payment_method:method,notes,operational_email_authorized:consent},travelers,existing);
 // La venta ya existe. Si el asiento falla (p. ej. se ocupo mientras tanto) NO se pierde la venta: se avisa.
 let warning='';
 const changes=hasMap&&!seatsQ.error?travelers.map(t=>({traveler_id:t.id as string,seat_number:seatOf(t)})).filter(a=>a.seat_number!==(savedSeat.get(a.traveler_id)??null)):[];
 if(changes.length){try{await assignExternalSeats(id,changes);}catch(err){warning='No se pudieron guardar los asientos ('+errorText(err)+'). Asígnalos desde la Agenda.';}}
 // Correo con el QR: va DESPUES de guardar y de asignar asientos para que ya los traiga. Si los asientos fallaron no se manda (saldria incompleto).
 let emailSent=false;
 if(sendEmail&&canEmail) {
  if(warning) warning+=' No se envió el correo con el QR porque los asientos no se guardaron: asígnalos y envíalo desde la tarjeta de la venta.';
  else {try{await sendExternalQrEmail(id);emailSent=true;}catch(err){warning='La venta se guardó, pero el correo con el QR no se envió ('+errorText(err)+'). Puedes enviarlo desde la tarjeta de la venta.';}}
 }
 onSaved(id,warning||undefined,emailSent);
 } catch(e) {setError(errorText(e));} finally {setBusy(false);}
 }
 function travelerField(index:number,key:keyof ExternalTraveler,value:string) {setTravelers(ts=>ts.map((t,i)=>i===index?{...t,[key]:value}:t));}
 const pickingIndex=picking?travelers.findIndex(t=>t.id===picking):-1;
 return <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50" role="dialog" aria-modal="true" aria-labelledby="external-form-title">
 <form onSubmit={submit} className="mx-auto flex min-h-full max-w-3xl flex-col bg-slate-50 shadow-2xl sm:my-6 sm:min-h-0 sm:rounded-2xl">
 <header className="sticky top-0 z-20 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 sm:rounded-t-2xl">
  <div><h2 id="external-form-title" className="text-xl font-bold text-slate-900">{existing?'Editar venta externa':'Registrar venta externa'}</h2>
  <p className="text-sm text-slate-500">Registrada manualmente · Herramienta gratuita</p></div>
  <button type="button" onClick={onClose} disabled={busy} aria-label="Cerrar" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40"><X className="h-5 w-5"/></button>
 </header>
 <div className="space-y-4 p-4 sm:p-5">
 {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">{error}</p>}

 <Section n={1} icon={<CalendarDays className="h-4 w-4 text-blue-700" aria-hidden/>} title="Salida" hint="Elige a qué salida pertenece esta venta.">
  <label className={lbl}>Tour / fecha / horario<select required className={ctl} value={departure} onChange={e=>{setDeparture(e.target.value);setChosen({});setPicking(null);}}>
  <option value="">Selecciona una salida</option>{operations.filter(o=>!existing||o.tour_id===existing.tour_id).filter(o=>o.status==='activo'||o.status==='lleno').map(o=><option key={operationKey(o)} value={operationKey(o)}>{o.tour_name} · {o.departure_date} {o.departure_time?.slice(0,5)} · {o.available} disponibles</option>)}</select></label>
  {op&&<div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
   <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-semibold text-slate-900">{op.tour_name}</span><span className="text-sm text-slate-500">{dayLabel(op.departure_date)} · {time5(op.departure_time)}</span></div>
   <div className="mt-2"><OccupancyBar o={op}/></div>
   <p className="mt-2 text-xs text-slate-600">Capacidad {op.capacity} · ToursRed {op.marketplace} · Externos {op.external} · <strong className="text-emerald-700">Disponibles {op.available}</strong></p>
  </div>}
 </Section>

 <Section n={2} icon={<UserRound className="h-4 w-4 text-blue-700" aria-hidden/>} title="Contacto y canal" hint="Quién compró y por dónde llegó la venta.">
  <div className="grid gap-4 md:grid-cols-2">
  <label className={lbl}>Canal de venta<select className={ctl} value={source} onChange={e=>setSource(e.target.value)}>{Object.entries(CHANNELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
  <label className={lbl}>Referencia externa (opcional)<input className={ctl} maxLength={200} value={reference} onChange={e=>setReference(e.target.value)}/></label>
  <label className={lbl}>Nombre del contacto principal<input required className={ctl} maxLength={200} value={name} onChange={e=>setName(e.target.value)}/></label>
  <label className={lbl}>Teléfono<input type="tel" maxLength={40} className={ctl} value={phone} onChange={e=>setPhone(e.target.value)}/></label>
  <label className={`${lbl} md:col-span-2`}>Correo electrónico<input type="email" maxLength={254} className={ctl} value={email} onChange={e=>setEmail(e.target.value)}/></label>
  </div>
  <label className="flex gap-2.5 rounded-xl bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-200"><input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={consent} onChange={e=>setConsent(e.target.checked)}/>El viajero autorizó usar este correo para recibir información operativa de esta reservación. No se enviará marketing ni se creará una cuenta.</label>
  <label className={`flex gap-2.5 rounded-xl p-3 text-sm ring-1 ${canEmail?'bg-blue-50 text-slate-800 ring-blue-200':'bg-slate-50 text-slate-400 ring-slate-200'}`}><input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={sendEmail&&canEmail} disabled={!canEmail} onChange={e=>setSendEmail(e.target.checked)}/>
   <span><strong className="font-semibold">Enviar el QR de check-in por correo al guardar.</strong> El correo ya incluye los asientos asignados.{!canEmail&&<span className="mt-0.5 block text-xs">Para activarlo escribe el correo del viajero y marca la autorización de arriba.</span>}</span></label>
 </Section>

 <Section n={3} icon={<Users className="h-4 w-4 text-blue-700" aria-hidden/>} title={`Viajeros y acompañantes (${travelers.length})`} hint="El primero es el viajero principal.">
  <label className={`${lbl} max-w-[11rem]`}>Cantidad de viajeros<input type="number" min="1" max="1000" className={ctl} value={travelers.length} onChange={e=>{const count=Number(e.target.value);if(Number.isInteger(count)&&count>=1&&count<=1000)setTravelers(ts=>Array.from({length:count},(_,i)=>ts[i]??blankTraveler()));}}/></label>
  <div className="space-y-3">
  {travelers.map((t,i)=><div key={t.id??i} className="grid items-end gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 sm:grid-cols-[1fr_1fr_9rem_auto]">
   <label className={lbl}>Nombre {i===0?'(principal)':''}<input required maxLength={150} className={ctl} value={t.first_name} onChange={e=>travelerField(i,'first_name',e.target.value)}/></label>
   <label className={lbl}>Apellidos<input required maxLength={150} className={ctl} value={t.last_name} onChange={e=>travelerField(i,'last_name',e.target.value)}/></label>
   <label className={lbl}>Tipo<select className={ctl} value={t.traveler_type} onChange={e=>travelerField(i,'traveler_type',e.target.value)}><option value="adulto">Adulto</option><option value="nino">Niño</option><option value="infante">Infante</option><option value="adulto_mayor">Adulto mayor</option><option value="mascota">Mascota</option></select></label>
   {i>0?<button type="button" aria-label="Quitar acompañante" title="Quitar acompañante" className="mb-0.5 inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-red-700 hover:bg-red-50" onClick={()=>setTravelers(ts=>ts.filter((_,j)=>j!==i))}><Trash2 className="h-4 w-4" aria-hidden/><span className="sm:hidden">Quitar acompañante</span></button>:<span className="hidden sm:block"/>}
  </div>)}
  </div>
  <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-blue-300 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50" disabled={travelers.length>=1000} onClick={()=>setTravelers(ts=>[...ts,blankTraveler()])}><Plus className="h-4 w-4" aria-hidden/>Agregar acompañante</button>
 </Section>

 {op&&hasMap&&<Section n={4} icon={<Armchair className="h-4 w-4 text-blue-700" aria-hidden/>} title="Asientos (opcional)" hint="Elige el lugar de cada viajero. Se guarda al registrar la venta; si alguno se ocupa mientras tanto te avisamos y podrás asignarlo desde la Agenda.">
  {seatsQ.error?<p role="alert" className="text-sm text-red-700">No se pudo cargar la ocupación de asientos. Guarda la venta y asígnalos después desde la Agenda.</p>:<>
  <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">{travelers.map((t,i)=>{const n=seatOf(t);const id=t.id as string;return <li key={id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
   <span className="text-sm font-medium text-slate-800">{travelerLabel(t,i)}</span>
   <span className="flex items-center gap-2">{n!==null?<span className="rounded bg-amber-50 px-2 py-0.5 text-sm font-semibold text-amber-900">Asiento {n}</span>:<span className="text-sm text-slate-400">Sin asiento</span>}
   <button type="button" className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={()=>setPicking(picking===id?null:id)}>{picking===id?'Cancelar':n!==null?'Cambiar':'Elegir asiento'}</button>
   {n!==null&&<button type="button" className="text-sm text-red-700 underline" onClick={()=>{setChosen(c=>({...c,[id]:null}));if(picking===id)setPicking(null);}}>Quitar</button>}</span></li>;})}</ul>
  <AgendaSeatMap tourId={op.tour_id} seats={mapSeats} resolve={resolveSeat} activeGroupId={null} onSelectGroup={()=>undefined} hideHint
   pick={picking?{prompt:'Elige un asiento libre para '+travelerLabel(travelers[Math.max(0,pickingIndex)],Math.max(0,pickingIndex)),busy:false,onPick:n=>{setChosen(c=>({...c,[picking]:n}));setPicking(null);},onCancel:()=>setPicking(null)}:null}/></>}
 </Section>}

 <Section n={hasMap&&op?5:4} icon={<Wallet className="h-4 w-4 text-amber-700" aria-hidden/>} title="Control interno de la agencia" className="border-amber-200 bg-amber-50/60">
  <p className="flex items-start gap-2 text-sm text-amber-900"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden/>{EXTERNAL_NOTICE}</p>
  <div className="grid gap-4 sm:grid-cols-3">
  <label className={lbl}>Total<input required type="number" min="0" max="999999999999.99" step="0.01" className={ctl} value={total} onChange={e=>setTotal(e.target.value)}/></label>
  <label className={lbl}>Pagado<input required type="number" min="0" max={total} step="0.01" className={ctl} value={paid} onChange={e=>setPaid(e.target.value)}/></label>
  <label className={lbl}>Pendiente<output className={`mt-1 block rounded-lg bg-white px-3 py-2 text-sm font-semibold tabular-nums ring-1 ${pending<0?'text-red-700 ring-red-300':pending>0?'text-amber-700 ring-amber-200':'text-emerald-700 ring-emerald-200'}`}>{Number.isFinite(pending)?pending.toFixed(2):'—'}</output></label>
  <label className={lbl}>Moneda<select className={ctl} value={currency} onChange={e=>setCurrency(e.target.value)}><option>MXN</option><option>USD</option><option>EUR</option></select></label>
  <label className={`${lbl} sm:col-span-2`}>Método de pago<select className={ctl} value={method} onChange={e=>setMethod(e.target.value)}>{Object.entries(PAYMENT_METHODS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
  </div>
  <div><div className="h-2 overflow-hidden rounded-full bg-white ring-1 ring-amber-200" role="img" aria-label={`${paidPct}% cobrado`}><div className="h-full rounded-full bg-emerald-500" style={{width:`${paidPct}%`}}/></div><p className="mt-1 text-xs text-slate-600">{paidPct}% cobrado</p></div>
  {pending<0&&<p role="alert" className="text-sm font-medium text-red-700">Lo pagado no puede ser mayor que el total.</p>}
  <label className={lbl}>Notas internas<textarea rows={3} maxLength={4000} className={ctl} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
 </Section>
 </div>
 <footer className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3 sm:rounded-b-2xl">
  <p className="text-sm text-slate-600"><strong className="text-slate-900">{travelers.length}</strong> {travelers.length===1?'viajero':'viajeros'} · Total <strong className="tabular-nums text-slate-900">{fmt(Number(total))}</strong> · Pendiente <strong className={`tabular-nums ${pending>0?'text-amber-700':'text-emerald-700'}`}>{fmt(pending)}</strong>{!op&&<span className="ml-2 text-amber-700">Elige una salida para continuar</span>}</p>
  <div className="flex gap-2"><button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
  <button disabled={busy||pending<0||!op} className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 disabled:opacity-50">{busy?'Guardando…':'Guardar venta externa'}</button></div>
 </footer>
 </form></div>;
}
