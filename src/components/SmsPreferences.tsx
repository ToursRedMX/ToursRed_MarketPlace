import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
export function SmsPreferences(){
 const {user}=useAuth();const client=useQueryClient();const key=['sms-preferences',user?.id];
 const query=useQuery({queryKey:key,enabled:Boolean(user),queryFn:async()=>{const{data,error}=await supabase.rpc('get_my_sms_preferences');if(error)throw error;return data===true;}});
 const mutation=useMutation({mutationFn:async(enabled:boolean)=>{const{error}=await supabase.rpc('set_my_sms_preferences',{p_enabled:enabled});if(error)throw error;return enabled;},onSuccess:data=>client.setQueryData(key,data)});
 if(query.isPending)return <p role="status">Cargando preferencias…</p>;
 return <div className="my-6 border-t pt-4"><h2 className="font-semibold">Mensajes operativos</h2><label className="mt-2 flex gap-2"><input type="checkbox" checked={query.data??false} disabled={query.isError||mutation.isPending} onChange={e=>mutation.mutate(e.target.checked)}/>Recibir confirmaciones y recordatorios de mis reservas por SMS</label><p className="text-sm text-slate-600">Esta preferencia no desactiva los códigos necesarios para verificar tu teléfono. No incluye publicidad.</p>{(query.isError||mutation.isError)&&<p role="alert">No se pudieron guardar o consultar las preferencias. Intenta de nuevo.</p>}</div>;
}
