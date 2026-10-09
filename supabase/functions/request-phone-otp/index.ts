import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { requireUser } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { normalizarTelefonoSms } from '../_shared/mensajeria/telefono.ts';
import { hmac, nuevoCodigo, datosOtp } from '../_shared/mensajeria/seguridad.ts';
import { plantillaOtp } from '../_shared/mensajeria/plantillas.ts';
import { cargarRuntime, enviarPersistido } from '../_shared/mensajeria/servicio.ts';

Deno.serve(async req => {
  const cors=corsHeaders(req);
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST') return new Response('method',{status:405,headers:cors});
  const auth=await requireUser(req,{recurso:'request-phone-otp',cors,phoneContext:'verification'});
  if(!auth.ok)return auth.response;
  if(!auth.llamador.userId)return Response.json({code:'USER_SESSION_REQUIRED'},{status:401,headers:cors});
  try {
    const raw=await req.text(); if(raw.length>4096)throw Error('peticion_invalida');
    const body=JSON.parse(raw); if(typeof body.phone!=='string'||typeof body.country!=='string')throw Error('telefono_invalido');
    const channel=body.channel??'sms';
    if(channel!=='sms'&&channel!=='whatsapp')return Response.json({code:'OTP_CHANNEL_INVALID'},{status:400,headers:cors});
    const client=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{auth:{persistSession:false}});
    const runtime=await cargarRuntime(client);
    if(!(channel==='sms'?runtime.settings.sms_habilitado:runtime.settings.whatsapp_habilitado)||!runtime.processor_ready) return Response.json({code:'SMS_UNAVAILABLE'},{status:503,headers:cors});
    const {data:settings,error:settingsError}=await client.from('platform_settings').select('turnstile_auth_enabled').single();
    if(settingsError)throw Error('configuracion_no_disponible');
    if(settings.turnstile_auth_enabled){
      const secret=Deno.env.get('TURNSTILE_SECRET_KEY');
      if(!secret||typeof body.turnstile_token!=='string'||!body.turnstile_token)return Response.json({code:'CAPTCHA_REQUIRED'},{status:403,headers:cors});
      const r=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret,response:body.turnstile_token}),signal:AbortSignal.timeout(8000)});
      if(!r.ok||(await r.json()).success!==true)return Response.json({code:'CAPTCHA_INVALID'},{status:403,headers:cors});
    }
    const phone=normalizarTelefonoSms(body.phone,body.country,runtime.settings.sms_paises_permitidos);
    const pepper=Deno.env.get('PHONE_OTP_PEPPER')??'',userId=auth.llamador.userId,id=crypto.randomUUID(),code=nuevoCodigo();
    // Missing IP uses a shared fail-closed bucket. User/phone limits remain
    // authoritative even when a proxy chain cannot identify an address.
    const ip=req.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim()||'unknown';
    const [codeHash,userHash,phoneHash,ipHash]=await Promise.all([hmac(pepper,datosOtp(userId,id,phone.e164,code)),hmac(pepper,'user:'+userId),hmac(pepper,'phone:'+phone.e164),hmac(pepper,'ip:'+ip)]);
    const {data,error}=await client.rpc('issue_phone_challenge',{p_user:userId,p_id:id,p_phone:phone.e164,p_hash:codeHash,p_user_hash:userHash,p_phone_hash:phoneHash,p_ip_hash:ipHash,p_simulated:runtime.settings.sms_modo_prueba,p_channel:channel});
    if(error)throw Error('emision_no_disponible');
    if(!data?.ok)return Response.json(data,{status:['OTP_COOLDOWN','OTP_RATE_LIMIT','OTP_LOCKED'].includes(data?.code)?429:400,headers:cors});
    const sent=await enviarPersistido(client,runtime,{verificationId:id},'otp',phone.e164,plantillaOtp(code),channel,code);
    return Response.json({...data,channel,phone_suffix:phone.e164.slice(-4),delivery:sent.estado}, {status:sent.estado==='fallido'?503:200,headers:cors});
  }catch(error){
    const known=error instanceof Error&&['telefono_invalido','pais_invalido','pais_no_soportado','usa_formato_mexicano_52','peticion_invalida'].includes(error.message)?error.message:null;
    return Response.json({code:known??'OTP_UNAVAILABLE'},{status:known?400:503,headers:cors});
  }
});
