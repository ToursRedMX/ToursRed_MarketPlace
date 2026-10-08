import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { requireServiceRole } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
Deno.serve(async req => {
 const cors=corsHeaders(req);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const auth=requireServiceRole(req,{recurso:'queue-booking-reminders',cors});if(!auth.ok)return auth.response;
 if(req.method!=='POST')return new Response('method',{status:405,headers:cors});
 const client=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{auth:{persistSession:false}});
 const {data,error}=await client.rpc('queue_booking_sms_batch');
 return Response.json(error?{error:'programacion_no_disponible'}:data,{status:error?503:200,headers:cors});
});
