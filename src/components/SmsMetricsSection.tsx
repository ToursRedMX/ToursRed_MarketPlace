import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
interface Metrics {
 period: string;
 messages: {category:string;status:string;country_code:string;total:number}[];
 attempts: {provider:string;status:string;country_code:string;is_simulated:boolean;total:number;segments:number;fallback:number;retries:number;known_cost:number|null;cost_unit:string|null}[];
 otp:{requested:number;verified:number;simulated:number;invalid:number};
 consumption:{scope:string;window_start:string;segments:number}[];
 health:{provider:string;balance_credits:number|null;balance_checked_at:string|null;last_worker_at:string|null}[];
 alerts:{code:string;last_seen_at:string;occurrences:number}[];
}
const labels:Record<string,string>={queue_error:'Error al preparar una notificación',missing_schedule:'Salidas sin hora o zona horaria inequívoca',low_balance:'Saldo bajo del proveedor',provider_unavailable:'No se pudo consultar al proveedor',repeated_errors:'Errores de envío reiterados',unknown_results:'Envíos con resultado desconocido: no reenviar a ciegas',consumption_high:'Consumo cercano al límite diario',otp_abuse:'Límite de solicitudes OTP alcanzado',worker_stale:'El procesador no ha reportado actividad reciente'};
export function SmsMetricsSection(){
 const query=useQuery({queryKey:['sms-metrics'],queryFn:async()=>{const{data,error}=await supabase.rpc('get_sms_metrics');if(error)throw error;return data as Metrics;},refetchInterval:30000,retry:false});
 if(query.isPending)return <p role="status">Cargando actividad SMS…</p>;
 if(query.isError||!query.data)return <section className="rounded border p-5"><p role="alert">No se pudo consultar la actividad SMS.</p><button onClick={()=>void query.refetch()}>Reintentar</button></section>;
 const m=query.data;
 return <section className="space-y-4 rounded-lg border p-5" aria-label="Actividad y alertas SMS"><h2 className="text-xl font-semibold">Actividad SMS · últimos 30 días</h2>
  <p className="text-sm text-slate-600">Métricas de mensajería independientes de ventas, comisiones y contabilidad. Aceptado por el proveedor no significa entregado.</p>
  <div className="flex flex-wrap gap-6"><span>OTP reales solicitados: <strong>{m.otp.requested}</strong></span><span>Verificados: <strong>{m.otp.verified}</strong></span><span>Conversión por desafío: <strong>{m.otp.requested?`${(100*m.otp.verified/m.otp.requested).toFixed(1)}%`:'—'}</strong></span><span>OTP simulados: {m.otp.simulated}</span></div>
  {m.alerts.length>0&&<ul className="space-y-2 rounded bg-amber-50 p-4" aria-label="Alertas operativas">{m.alerts.map(a=><li key={a.code}>{labels[a.code]??a.code} · {new Date(a.last_seen_at).toLocaleString()}</li>)}</ul>}
  <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="text-left font-semibold">Mensajes lógicos</caption><thead><tr><th>Categoría</th><th>Estado</th><th>País</th><th>Total</th></tr></thead><tbody>{m.messages.map((r,i)=><tr key={i}><td>{r.category==='reserva_confirmada'?'Confirmación':'Recordatorio'}</td><td>{r.status}</td><td>{r.country_code==='ZZ'?'Por determinar':r.country_code}</td><td>{r.total}</td></tr>)}</tbody></table></div>
  <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="text-left font-semibold">Intentos por proveedor y país</caption><thead><tr><th>Proveedor</th><th>Estado</th><th>País</th><th>Modo</th><th>Intentos</th><th>Segmentos</th><th>Respaldo</th><th>Reintentos</th><th>Costo conocido</th></tr></thead><tbody>{m.attempts.map((a,i)=><tr key={i}><td>{a.provider}</td><td>{a.status}</td><td>{a.country_code}</td><td>{a.is_simulated?'Simulado':'Real'}</td><td>{a.total}</td><td>{a.segments}</td><td>{a.fallback}</td><td>{a.retries}</td><td>{a.known_cost==null?'No informado':`${a.known_cost} ${a.cost_unit??''}`}</td></tr>)}</tbody></table></div>
  <p>Cuota consumida: {m.consumption.length?m.consumption.map(c=>`${c.scope==='sms_daily'?'Diaria':'Mensual'}: ${c.segments} segmentos`).join(' · '):'Sin consumo registrado'}. La cuota reserva intentos reales; no equivale a un costo facturado.</p>
  {m.health.map(h=><p key={h.provider}>{h.provider}: {h.balance_credits==null?'saldo no disponible':`${h.balance_credits} créditos`} {h.balance_checked_at&&`· consultado ${new Date(h.balance_checked_at).toLocaleString()}`}.</p>)}
 </section>;
}
