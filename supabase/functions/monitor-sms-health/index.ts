import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { requireServiceRole } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { twilio } from '../_shared/mensajeria/proveedores/twilio.ts';
import { twilioConfig } from '../_shared/mensajeria/twilioConfig.ts';
import { reconciliarTwilio } from '../_shared/mensajeria/reconciliarTwilio.ts';
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
  const health=await client.rpc('record_sms_provider_health',{p_provider:'labsmobile',p_available:balance!=null,p_balance:balance?.creditos??null,p_unit:balance?'credits':null});
  if(health.error)throw health.error;
  if(balance){const result=await client.rpc('refresh_sms_provider_capability',{p_provider:'labsmobile',p_ready:true});if(result.error)throw result.error;}
  const twilioAdapter=twilio(twilioConfig());
  const twilioReady=await twilioAdapter.comprobar();
  const twilioBalance=twilioReady?await twilioAdapter.saldoMonetario():null;
  const twilioHealth=await client.rpc('record_sms_provider_health',{p_provider:'twilio',p_available:twilioReady,p_balance:twilioBalance?.amount??null,p_unit:twilioBalance?.currency??null});
  if(twilioHealth.error)throw twilioHealth.error;
  const capability=await client.rpc('refresh_sms_provider_capability',{p_provider:'twilio',p_ready:twilioReady});
  if(capability.error)throw capability.error;
  const whatsappReady=await twilioAdapter.comprobarWhatsApp();
  const whatsappCapability=await client.rpc('refresh_whatsapp_provider_capability',{p_provider:'twilio',p_ready:whatsappReady});
  if(whatsappCapability.error)throw whatsappCapability.error;
  const reconciled=await reconciliarTwilio(client,twilioAdapter.consultar);
  const operational=await client.rpc('record_sms_health');if(operational.error)throw operational.error;
  const mockResult=await client.rpc('refresh_sms_provider_capability',{p_provider:'mock',p_ready:true});if(mockResult.error)throw mockResult.error;
  // Deployment-only certification, not the business activation switch. No OTP
  // gate is certified until staging validation and explicit deployment settings.
  const processor=Deno.env.get('SMS_PROCESSOR_CERTIFIED')==='true';
  const otp=processor&&Deno.env.get('PHONE_OTP_ENFORCEMENT_CERTIFIED')==='true'&&(Deno.env.get('PHONE_OTP_PEPPER')?.length??0)>=32&&(Deno.env.get('SMS_WEBHOOK_SECRET')?.length??0)>=32&&Deno.env.get('SMS_ALLOW_REAL_SENDS')==='true';
  const cert=await client.rpc('certify_sms_runtime',{p_processor:processor,p_otp:otp});if(cert.error)throw cert.error;
  return Response.json({ok:true,balance_available:balance!=null,twilio_ready:twilioReady,whatsapp_ready:whatsappReady,reconciled,processor_certified:processor,otp_certified:otp},{headers:cors});
 }catch(e){
  // Preserve SQL diagnostics without dumping provider payloads or personal data.
  const code=e&&typeof e==='object'&&'code' in e&&typeof e.code==='string'&&/^[A-Z0-9]{5}$/.test(e.code)?e.code:'monitor_failure';
  console.error('monitor-sms-health:',code);
  return Response.json({error:'monitor_no_disponible'},{status:503,headers:cors});
 }
});
