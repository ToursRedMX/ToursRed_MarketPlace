import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { requireServiceRole } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { labsmobile } from '../_shared/mensajeria/proveedores/labsmobile.ts';
Deno.serve(async req=>{
 const cors=corsHeaders(req);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const auth=requireServiceRole(req,{recurso:'monitor-sms-health',cors});if(!auth.ok)return auth.response;
 if(req.method!=='POST')return new Response('method',{status:405,headers:cors});
 try{
  const client=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{auth:{persistSession:false}});
  const user=Deno.env.get('LABSMOBILE_USER')??'',token=Deno.env.get('LABSMOBILE_TOKEN')??'';
  const balance=user&&token?await labsmobile(user,token,Deno.env.get('LABSMOBILE_SENDER')??'ToursRed').saldo?.():null;
  const {error}=await client.rpc('record_sms_health',{p_credits:balance?.creditos??null,p_balance_ok:balance!=null,p_worker:false});
  if(error)throw error;
  // Presence is insufficient: initial LabsMobile readiness requires a successful
  // authenticated balance response. Temporary outages don't erase last readiness.
  if(balance){const result=await client.rpc('refresh_sms_provider_capability',{p_provider:'labsmobile',p_ready:true});if(result.error)throw result.error;}
  const mockResult=await client.rpc('refresh_sms_provider_capability',{p_provider:'mock',p_ready:true});if(mockResult.error)throw mockResult.error;
  // Deployment-only certification, not the business activation switch. No OTP
  // gate is certified until staging validation and explicit deployment settings.
  const processor=Deno.env.get('SMS_PROCESSOR_CERTIFIED')==='true';
  const otp=processor&&Deno.env.get('PHONE_OTP_ENFORCEMENT_CERTIFIED')==='true'&&(Deno.env.get('PHONE_OTP_PEPPER')?.length??0)>=32&&(Deno.env.get('SMS_WEBHOOK_SECRET')?.length??0)>=32&&Deno.env.get('SMS_ALLOW_REAL_SENDS')==='true';
  const cert=await client.rpc('certify_sms_runtime',{p_processor:processor,p_otp:otp});if(cert.error)throw cert.error;
  return Response.json({ok:true,balance_available:balance!=null,processor_certified:processor,otp_certified:otp},{headers:cors});
 }catch(e){console.error('monitor-sms-health:',e instanceof Error?e.message:JSON.stringify(e));return Response.json({error:'monitor_no_disponible'},{status:503,headers:cors});}
});
