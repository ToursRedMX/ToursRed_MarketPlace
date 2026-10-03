import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { format, addDays } from 'date-fns';
import { QRCodeSVG } from 'qrcode.react';
import { useAgencyId } from '../../hooks/useAgencyId';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { loadExternalSales, loadOperations, cancelExternalSale, generateExternalQr, externalQrUrl, errorText } from '../../lib/externalSales';
import { CHANNELS, EXTERNAL_NOTICE } from '../../types/externalSales';
import type { ExternalSale } from '../../types/externalSales';
import ExternalSaleForm from '../../components/external-sales/ExternalSaleForm';
import { OriginBadge } from './AgencyAgenda';
const money=(n:number,c:string)=>new Intl.NumberFormat('es-MX',{style:'currency',currency:c}).format(n);
export default function AgencyExternalSales() {
 const {agencyId}=useAgencyId();const {isAgencyStaff,staffInfo}=useAuth();const [params]=useSearchParams();
 const canManage=!isAgencyStaff||!!(staffInfo?.permissions.canManageTours&&staffInfo.permissions.canViewFinancials);
 const [from,setFrom]=useState(()=>format(new Date(),'yyyy-MM-dd'));const [to,setTo]=useState(()=>format(addDays(new Date(),90),'yyyy-MM-dd'));
 const [tour,setTour]=useState(params.get('tour')??'');const [channel,setChannel]=useState('');const [status,setStatus]=useState('');const [payment,setPayment]=useState('');
 const [form,setForm]=useState<ExternalSale|'new'|null>(null);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const [qr,setQr]=useState<{url:string;sale:ExternalSale}|null>(null);
 const sales=useQuery({queryKey:['external-sales',agencyId,from,to],enabled:!!agencyId&&!!from&&!!to,queryFn:()=>loadExternalSales(agencyId!,from,to)});
 const operations=useQuery({queryKey:['external-sale-options',agencyId],enabled:!!agencyId,queryFn:()=>loadOperations(agencyId!,format(new Date(),'yyyy-MM-dd'),format(addDays(new Date(),365),'yyyy-MM-dd'))});
 const filtered=(sales.data??[]).filter(s=>(!tour||s.tour_id===tour)&&(!params.get('slot')||s.slot_id===params.get('slot'))&&(!channel||s.source===channel)&&(!status||s.status===status)&&(!payment||(payment==='pending'?Number(s.external_sale_financials?.amount_pending)>0:Number(s.external_sale_financials?.amount_pending)===0)));
 const active=filtered.filter(s=>s.status==='active');
 const totals=new Map<string,{total:number;paid:number;pending:number}>();
 for(const s of active) {const f=s.external_sale_financials;if(f){const t=totals.get(f.currency)??{total:0,paid:0,pending:0};t.total+=Number(f.total_sale_amount);t.paid+=Number(f.amount_paid);t.pending+=Number(f.amount_pending);totals.set(f.currency,t);}}
 const names=new Map<string,string>((operations.data??[]).map(o=>[o.tour_id,o.tour_name]));
 for(const s of sales.data??[]) if(s.tours?.name) names.set(s.tour_id,s.tours.name);
 async function run(action:()=>Promise<void>) {setBusy(true);setMessage('');try{await action();await Promise.all([sales.refetch(),operations.refetch()]);}catch(e){setMessage(errorText(e));}finally{setBusy(false);}}
 async function showQr(s:ExternalSale) {const token=await generateExternalQr(s.id);setQr({url:externalQrUrl(s,token),sale:s});}
 async function sendQr(s:ExternalSale) {
 if(!s.operational_email_authorized) throw new Error('Registra primero la autorización de correo operativo.');
 const {data,error}=await supabase.functions.invoke('send-external-sale-qr',{body:{external_sale_id:s.id}});
 if(error||!data?.success) throw new Error(data?.error??error?.message??'No se pudo enviar el correo');
 setMessage('QR enviado con la marca de tu agencia.');setQr(null);
 }
 return <main className="max-w-7xl mx-auto p-4 md:p-8 space-y-5">
 <header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-bold">Ventas externas</h1><p>Control privado de tu agencia · Gratuito</p></div><div className="flex gap-3 items-center"><Link to="/agency/agenda" className="text-blue-700 underline">Agenda</Link>{canManage&&<button className="bg-blue-700 text-white rounded-lg px-4 py-2" onClick={()=>setForm('new')}>Registrar venta externa</button>}</div></header>
 <p className="bg-amber-50 p-4 rounded-lg">{EXTERNAL_NOTICE}</p>
 <div className="flex flex-wrap gap-3">
 <label>Desde<input type="date" className="block border rounded p-2" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Hasta<input type="date" className="block border rounded p-2" value={to} onChange={e=>setTo(e.target.value)}/></label>
 <label>Tour<select className="block border rounded p-2" value={tour} onChange={e=>setTour(e.target.value)}><option value="">Todos</option>{[...names].map(([id,n])=><option key={id} value={id}>{n}</option>)}</select></label>
 <label>Canal<select className="block border rounded p-2" value={channel} onChange={e=>setChannel(e.target.value)}><option value="">Todos</option>{Object.entries(CHANNELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
 <label>Estado<select className="block border rounded p-2" value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos</option><option value="active">Activas</option><option value="cancelled">Canceladas</option></select></label>
 <label>Cobro<select className="block border rounded p-2" value={payment} onChange={e=>setPayment(e.target.value)}><option value="">Todos</option><option value="paid">Pagado</option><option value="pending">Pendiente</option></select></label></div>
 <section className="bg-white border rounded-lg p-4 space-y-2"><p>{filtered.length} ventas registradas · {active.reduce((n,s)=>n+s.travelers_count,0)} viajeros externos activos</p>
 {[...totals].map(([c,t])=><p key={c}>{c}: Total {money(t.total,c)} · Cobrado {money(t.paid,c)} · Pendiente {money(t.pending,c)}</p>)}
 <p className="text-sm">Importes de ventas activas dentro del filtro. Cada moneda se muestra por separado.</p>
 <div className="flex flex-wrap gap-3">{Object.entries(CHANNELS).map(([k,v])=><span key={k} className="text-sm">{v}: {filtered.filter(s=>s.source===k).length}</span>)}</div></section>
 {(message||sales.error||operations.error)&&<p role="status" className="bg-blue-50 p-3">{message||errorText(sales.error??operations.error)}</p>}
 {sales.isPending?<p>Cargando ventas…</p>:<div className="overflow-x-auto bg-white border rounded-lg"><table className="w-full text-sm text-left"><thead><tr>{['Origen / fecha','Tour / viajero','Asistentes','Canal','Total','Pagado','Pendiente','Estado','Acciones'].map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>
 {filtered.map(s=><tr key={s.id} className="border-t"><td className="p-3"><OriginBadge origin="Externa"/><div>{s.departure_date} {s.departure_time?.slice(0,5)}</div></td><td>{names.get(s.tour_id)??'Tour'}<div>{s.primary_traveler_name}</div></td><td>{s.travelers_count}</td><td>{CHANNELS[s.source]}</td>
 {(['total_sale_amount','amount_paid','amount_pending'] as const).map(k=><td key={k}>{s.external_sale_financials?money(Number(s.external_sale_financials[k]),s.external_sale_financials.currency):'Privado'}</td>)}
 <td>{s.status==='active'?'Activa':'Cancelada'}</td><td className="p-3 space-y-2">
 <Link className="block text-blue-700 underline" to={'/agency/agenda?tour='+s.tour_id+(s.slot_id?'&slot='+s.slot_id:'')}>Asistentes / check-in</Link>
 {s.status==='active'&&canManage&&<><button disabled={busy} className="block" onClick={()=>setForm(s)}>Editar</button><button disabled={busy} className="block" onClick={()=>void run(()=>showQr(s))}>Generar QR de check-in</button><button disabled={busy||!s.primary_traveler_email||!s.operational_email_authorized} className="block disabled:opacity-40" onClick={()=>void run(()=>sendQr(s))}>Enviar QR por correo</button><button disabled={busy} className="block text-red-700" onClick={()=>{const reason=window.prompt('Motivo de cancelación (se conservará el historial)');if(reason)void run(()=>cancelExternalSale(s,reason));}}>Cancelar</button></>}
 </td></tr>)}</tbody></table>{!filtered.length&&<p className="p-4">No hay ventas externas en este periodo.</p>}</div>}
 {qr&&<section className="bg-white border rounded-lg p-5 space-y-3"><h2 className="font-bold">QR de check-in · {qr.sale.primary_traveler_name}</h2><p>Este QR identifica al grupo. Al generar otro, el anterior deja de funcionar.</p><QRCodeSVG className="sentry-block" value={qr.url} size={220}/><a className="sentry-block text-blue-700 underline" href={qr.url}>Abrir check-in</a><button className="ml-4" onClick={()=>setQr(null)}>Cerrar QR</button></section>}
 {form&&<ExternalSaleForm key={form==='new'?'new':form.id} operations={operations.data??[]} existing={form==='new'?undefined:form} onClose={()=>setForm(null)} onSaved={id=>{setForm(null);setMessage('Venta externa guardada. Ya puedes generar o enviar el QR de check-in.');void run(async()=>{await sales.refetch();const s=(await loadExternalSales(agencyId!,from,to)).find(s=>s.id===id);if(s)setMessage('Venta externa guardada. Genera o envía su QR desde Acciones.');});}}/>}
 </main>;
}
