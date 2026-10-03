import { useState } from 'react';
import { pendingExternalQr } from '../../lib/externalQrSession';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { format, addDays, addMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval } from 'date-fns';
import { useAgencyId } from '../../hooks/useAgencyId';
import { loadOperations, loadManifest, checkinExternal, errorText } from '../../lib/externalSales';
import { operationKey } from '../../types/externalSales';
import type { Operation, ManifestRow } from '../../types/externalSales';
import { downloadExcel } from '../../utils/excelExport';
import jsPDF from 'jspdf';
import { autoTable } from 'jspdf-autotable';
export function OriginBadge({origin}:{origin:string}) {return <span className={'inline-block rounded-full px-2 py-1 text-xs font-medium '+(origin==='Externa'?'bg-amber-100 text-amber-900':'bg-blue-100 text-blue-900')}>{origin}</span>;}
function Manifest({op,agency,onRefresh}:{op:Operation;agency:string;onRefresh:()=>void}) {
 const [origin,setOrigin]=useState('Todos'); const [token,setToken]=useState(pendingExternalQr);
 const [message,setMessage]=useState(''); const [busy,setBusy]=useState(false);
 const query=useQuery({queryKey:['operational-manifest',agency,op.tour_id,op.slot_id],queryFn:()=>loadManifest(op.tour_id,op.slot_id)});
 const rows=(query.data??[]).filter(r=>origin==='Todos'||r.origin===origin);
 const headers=['Viajero','Origen','Personas','Tipo','Estado','Check-in'];
 const rowValues=(r:ManifestRow)=>[r.traveler_name,r.origin,r.people,r.traveler_type,r.status,r.checked_in_at?'Realizado':'Pendiente'];
 async function exportExcel() {try {await downloadExcel([{sheet:'Asistentes',data:[[op.tour_name,op.departure_date,op.departure_time??''],headers,...rows.map(rowValues)]}],'asistentes.xlsx');}catch(e){setMessage(errorText(e));}}
 function exportPdf() {const doc=new jsPDF();doc.text(op.tour_name,14,16);doc.text(op.departure_date+' '+(op.departure_time??''),14,24);autoTable(doc,{startY:30,head:[headers],body:rows.map(rowValues)});doc.save('asistentes.pdf');}
 async function checkin() {
 setBusy(true);setMessage('');
 try {let raw=token.trim();if(raw.includes('#')) raw=new URLSearchParams(raw.split('#')[1]).get('external-qr')??'';
 const result=await checkinExternal(raw,agency,op);setMessage(result.already_checked_in?'El check-in ya fue realizado.':'Check-in registrado: '+result.checked_in+' viajeros.');
 await query.refetch();onRefresh();
 }catch(e){setMessage(errorText(e));}finally{setBusy(false);}
 }
 return <section className="bg-white border rounded-xl p-5 space-y-4">
 <h2 className="font-bold text-xl">{op.tour_name} · {op.departure_date} {op.departure_time?.slice(0,5)}</h2>
 <p>Capacidad: {op.capacity} · ToursRed: {op.marketplace} · Externos: {op.external} · Ocupados: {op.marketplace+op.external} · Disponibles: {op.available}</p>
 {(op.blocked>0||op.held>0)&&<p className="text-sm text-gray-600">Bloqueados: {op.blocked} · Apartados temporalmente: {op.held}</p>}
 <div className="flex flex-wrap gap-4 items-center"><label>Origen <select className="border p-2 rounded" value={origin} onChange={e=>setOrigin(e.target.value)}><option>Todos</option><option>ToursRed</option><option>Externa</option></select></label>
 <button onClick={()=>void exportExcel()} disabled={!query.data}>Exportar Excel</button><button onClick={exportPdf} disabled={!query.data}>Exportar PDF</button>
 <Link className="text-blue-700 underline" to={'/agency/external-sales?tour='+op.tour_id+(op.slot_id?'&slot='+op.slot_id:'')}>Ver ventas externas</Link></div>
 {query.isPending&&<p>Cargando asistentes…</p>}{query.error&&<p role="alert">{errorText(query.error)}</p>}
 <p>Total de asistentes mostrados: {rows.reduce((s,r)=>s+r.people,0)}</p>
 <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr>{headers.map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead>
 <tbody>{rows.map((r,i)=><tr className="border-t" key={r.origin+':'+(r.traveler_id??r.reservation_id)+':'+i}><td className="p-2">{r.traveler_name}</td><td><OriginBadge origin={r.origin}/></td><td>{r.people}</td><td>{r.traveler_type}</td><td>{r.status==='active'?'Confirmada externamente':r.status}</td><td>{r.checked_in_at?'Realizado':'Pendiente'}</td></tr>)}</tbody></table></div>
 {!query.isPending&&!rows.length&&<p>No hay asistentes para este filtro.</p>}
 <div className="sentry-block border-t pt-4 space-y-2"><h3 className="font-semibold">Check-in de venta externa</h3><p className="text-sm">Confirma que estás en la salida correcta. Escanea el QR con la cámara de tu dispositivo para abrir esta agenda, o pega el enlace/token aquí.</p>
 <label className="block">QR / token<input className="border rounded p-2 w-full" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)}/></label>
 <button className="bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-50" disabled={busy||!token} onClick={()=>void checkin()}>{busy?'Validando…':'Confirmar check-in externo'}</button>
 <p role="status">{message}</p><Link className="text-blue-700 underline" to="/agency/bookings">Check-in y reservas ToursRed</Link></div>
 </section>;
}
export default function AgencyAgenda({embedded=false}:{embedded?:boolean}) {
 const {agencyId,error:agencyError}=useAgencyId(); const [params]=useSearchParams();
 const [anchor,setAnchor]=useState(()=>format(new Date(),'yyyy-MM-dd'));const [view,setView]=useState('lista'); const [selected,setSelected]=useState('');
 const date=new Date(anchor+'T12:00:00');
 const from=format(view==='mes'?startOfMonth(date):view==='semana'?startOfWeek(date,{weekStartsOn:1}):date,'yyyy-MM-dd');
 const to=format(view==='mes'?endOfMonth(date):view==='semana'?endOfWeek(date,{weekStartsOn:1}):addDays(date,89),'yyyy-MM-dd');
 const query=useQuery({queryKey:['agency-operations',agencyId,from,to],enabled:!!agencyId,queryFn:()=>loadOperations(agencyId!,from,to),refetchInterval:30000});
 const ops=query.data??[];
 const picked=ops.find(o=>operationKey(o)===selected)??ops.find(o=>o.tour_id===params.get('tour')&&o.slot_id===(params.get('slot')||null));
 const days=eachDayOfInterval({start:new Date(from+'T12:00:00'),end:new Date(to+'T12:00:00')});
 function card(o:Operation) {return <button key={operationKey(o)} onClick={()=>setSelected(operationKey(o))} className="block text-left border rounded-lg bg-white p-3 w-full hover:border-blue-500">
 <strong className="block">{o.tour_name}</strong><span className="block text-sm">{o.departure_date} · {o.departure_time?.slice(0,5)??'Sin horario'}</span>
 <span className="text-sm block">{o.capacity} lugares · {o.marketplace+o.external} ocupados</span>
 <span className="text-xs block mt-1">{o.marketplace} ToursRed · {o.external} externos · <strong>{o.available} disponibles</strong></span>
 {o.status!=='activo'&&<span className="text-xs">{o.status}</span>}</button>;}
 return <div className={embedded?'space-y-5':'max-w-7xl mx-auto p-4 md:p-8 space-y-5'}>
 <header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-bold">Agenda operativa</h1><p className="text-gray-600">Una salida, todos sus viajeros. Herramienta gratuita.</p></div><Link className="bg-blue-700 text-white rounded-lg px-4 py-2 self-start" to="/agency/external-sales">Registrar venta externa</Link></header>
 <div className="flex flex-wrap gap-3 items-center"><label>Vista <select className="border rounded p-2" value={view} onChange={e=>setView(e.target.value)}><option value="lista">Próximas salidas</option><option value="semana">Semana</option><option value="mes">Mes</option></select></label>
 <button onClick={()=>setAnchor(format(view==='mes'?addMonths(date,-1):addDays(date,view==='semana'?-7:-90),'yyyy-MM-dd'))}>Anterior</button>
 <label>Fecha <input type="date" className="border rounded p-2" value={anchor} onChange={e=>e.target.value&&setAnchor(e.target.value)}/></label>
 <button onClick={()=>setAnchor(format(view==='mes'?addMonths(date,1):addDays(date,view==='semana'?7:90),'yyyy-MM-dd'))}>Siguiente</button>
 <button onClick={()=>void query.refetch()}>Actualizar</button></div>
 {(agencyError||query.error)&&<p role="alert" className="text-red-700">{agencyError??errorText(query.error)}</p>}{query.isPending&&<p>Cargando agenda…</p>}
 {view==='lista'?<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{ops.map(card)}</div>:<div className="overflow-x-auto"><div className="grid grid-cols-7 gap-2 min-w-[800px]">
 {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(d=><div key={d} className="font-semibold p-2">{d}</div>)}
 {Array.from({length:(new Date(from+'T12:00:00').getDay()+6)%7},(_,i)=><div key={'blank'+i}/>)}
 {days.map(d=><div className="border rounded p-1 min-h-28 space-y-2" key={format(d,'yyyy-MM-dd')}><div className="text-sm">{format(d,'dd/MM')}</div>{ops.filter(o=>o.departure_date===format(d,'yyyy-MM-dd')).map(card)}</div>)}</div></div>}
 {!query.isPending&&!query.error&&!ops.length&&<p>No hay salidas en este periodo.</p>}
 {picked&&agencyId&&<Manifest key={operationKey(picked)} op={picked} agency={agencyId} onRefresh={()=>void query.refetch()}/>}
 </div>;
}
