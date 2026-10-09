import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { twilio, clasificarTwilio, estadoTwilio } from '../../supabase/functions/_shared/mensajeria/proveedores/twilio.ts';
import { verifyTwilioSignature, parseTwilioCallback } from '../../supabase/functions/_shared/mensajeria/twilioWebhook.ts';
import { permiteFallback, enrutar } from '../../supabase/functions/_shared/mensajeria/enrutador.ts';
import type { MensajeSms, RoutingSettings } from '../../supabase/functions/_shared/mensajeria/tipos.ts';

const config = { accountSid: 'AC'+'a'.repeat(32), authToken: 'b'.repeat(32), from: '+15005550006' };
const sid = 'SM'+'c'.repeat(32), correlation='d'.repeat(20);
const message: MensajeSms = { destino: '+525512345678', texto: 'Tu codigo es 123456', correlacion: correlation, categoria: 'otp', simulacion: false, urlEstados: 'https://project.supabase.co/functions/v1/sms-webhook-twilio?correlation='+correlation };
const accepted=()=>Response.json({sid,status:'queued'},{status:201});

Deno.test('Twilio REST: form payload, Basic auth, E164 and dedicated callback', async()=>{
  const transport:typeof fetch=async(url,init)=>{
    assert.equal(url,`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`);
    assert.equal(init?.redirect,'error');assert.equal(init?.method,'POST');
    assert.equal(new Headers(init?.headers).get('Authorization'),'Basic '+btoa(config.accountSid+':'+config.authToken));
    const body=new URLSearchParams(String(init?.body));assert.equal(body.get('To'),message.destino);assert.equal(body.get('From'),config.from);
    assert.equal(body.get('StatusCallback'),message.urlEstados);assert.equal(body.get('ValidityPeriod'),'600');assert.equal(body.has('test'),false);
    return accepted();
  };
  assert.deepEqual(await twilio(config,transport).enviar(message),{estado:'aceptado',idProveedor:sid});
});
Deno.test('Messaging Service takes precedence over From',async()=>{
  const service='MG'+'e'.repeat(32);
  const transport:typeof fetch=async(_url,init)=>{const body=new URLSearchParams(String(init?.body));assert.equal(body.get('MessagingServiceSid'),service);assert.equal(body.has('From'),false);return accepted();};
  assert.equal((await twilio({...config,messagingServiceSid:service},transport).enviar(message)).estado,'aceptado');
});
Deno.test('simulation cannot use live transport when test credentials absent',async()=>{
  const transport:typeof fetch=()=>{throw Error('MUST NOT contact live transport');};
  assert.equal((await twilio(config,transport).enviar({...message,simulacion:true})).estado,'simulado');
});
Deno.test('test credentials use isolated account and magic From, never service/callback',async()=>{
  const testAccountSid='AC'+'1'.repeat(32),testAuthToken='2'.repeat(32);
  const transport:typeof fetch=async(url,init)=>{
    assert.ok(String(url).includes(testAccountSid));assert.equal(new Headers(init?.headers).get('Authorization'),'Basic '+btoa(testAccountSid+':'+testAuthToken));
    const body=new URLSearchParams(String(init?.body));assert.equal(body.get('From'),'+15005550006');assert.equal(body.has('MessagingServiceSid'),false);assert.equal(body.has('StatusCallback'),false);return accepted();
  };
  assert.equal((await twilio({...config,testAccountSid,testAuthToken},transport).enviar({...message,simulacion:true})).estado,'simulado');
  assert.equal((await twilio({...config,testAccountSid:config.accountSid,testAuthToken:config.authToken},transport).enviar({...message,simulacion:true})).estado,'fallido');
});
Deno.test('permanent errors, opt-out and fraud restrictions never trigger fallback',()=>{
  for(const [status,code] of [[400,21610],[400,21211],[400,21614],[403,21408],[403,30007],[400,21606]])assert.equal(permiteFallback(clasificarTwilio(status,{code},false)),false);
  assert.equal(permiteFallback(clasificarTwilio(401,{code:20003},false)),true);
  assert.equal(permiteFallback(clasificarTwilio(429,{code:20429},false)),true);
});
Deno.test('5xx, malformed success and transport timeout stay unknown',async()=>{
  for(const [status,body] of [[500,{code:20500}],[201,{}],[201,{sid,status:'invented'}],[200,'bad']])assert.equal(clasificarTwilio(Number(status),body,false).estado,'resultado_desconocido');
  const transport:typeof fetch=async()=>{throw new DOMException('timeout','TimeoutError');};
  const result=await twilio(config,transport).enviar(message);assert.equal(result.estado,'resultado_desconocido');assert.equal(permiteFallback(result),false);
});
Deno.test('all provider delivery states have conservative mappings',()=>{
  for(const state of ['accepted','scheduled','queued','sending'])assert.equal(estadoTwilio(state),'aceptado');
  assert.equal(estadoTwilio('sent'),'enviado');assert.equal(estadoTwilio('delivered'),'entregado');
  for(const state of ['failed','undelivered','canceled'])assert.equal(estadoTwilio(state),'fallido');
  assert.equal(estadoTwilio('read'),null);
  assert.equal(permiteFallback(clasificarTwilio(201,{sid,status:'failed'},false)),false);
});
Deno.test('SDK signature validation binds public URL, query and every POST field',()=>{
  const params={AccountSid:config.accountSid,MessageSid:sid,MessageStatus:'delivered',To:message.destino,NewField:'future'};
  const payload=message.urlEstados+Object.keys(params).sort().map(k=>k+params[k as keyof typeof params]).join('');
  const signature=createHmac('sha1',config.authToken).update(payload).digest('base64');
  assert.equal(verifyTwilioSignature(config.authToken,signature,message.urlEstados,params),true);
  assert.equal(verifyTwilioSignature(config.authToken,signature,message.urlEstados+'&tampered=1',params),false);
  assert.equal(verifyTwilioSignature(config.authToken,signature,message.urlEstados,{...params,To:'+15555555555'}),false);
  assert.equal(verifyTwilioSignature('f'.repeat(32),signature,message.urlEstados,params),false);
  assert.equal(verifyTwilioSignature(config.authToken,'',message.urlEstados,params),false);
});
Deno.test('callback requires matching account, message identity, destination and status',()=>{
  const params={AccountSid:config.accountSid,MessageSid:sid,MessageStatus:'delivered',To:message.destino};
  assert.equal(parseTwilioCallback(params,config.accountSid)?.state,'entregado');
  assert.equal(parseTwilioCallback({...params,AccountSid:'other'},config.accountSid),null);
  assert.equal(parseTwilioCallback({...params,MessageSid:'bad'},config.accountSid),null);
  assert.equal(parseTwilioCallback({...params,To:'whatsapp:'+message.destino},config.accountSid),null);
});
Deno.test('readiness requires active account and an SMS-capable owned sender',async()=>{
  const responses=[{sid:config.accountSid,status:'active'},{incoming_phone_numbers:[{account_sid:config.accountSid,phone_number:config.from,capabilities:{sms:true}}]}];
  const transport:typeof fetch=async(_url,init)=>{assert.equal(init?.method,undefined);return Response.json(responses.shift());};
  assert.equal(await twilio(config,transport).comprobar(),true);
  assert.equal(await twilio(config,async()=>Response.json({sid:config.accountSid,status:'suspended'})).comprobar(),false);
});
Deno.test('reconciliation reads known SID, discards body and retains only actual cost',async()=>{
  const transport:typeof fetch=async(url,init)=>{assert.ok(String(url).endsWith(`/Messages/${sid}.json`));assert.equal(init?.method,undefined);return Response.json({sid,account_sid:config.accountSid,to:message.destino,status:'delivered',price:'-0.12345',price_unit:'usd',body:'MUST NOT persist OTP'});};
  const result=await twilio(config,transport).consultar(sid);assert.equal(result?.cost,0.12345);assert.equal(result?.unit,'USD');assert.equal(result?.state,'entregado');assert.equal(Object.hasOwn(result!,'body'),false);
  assert.equal(await twilio(config,transport).consultar('../invalid'),null);
});
Deno.test('Twilio balance preserves currency and does not become credits',async()=>{
  const transport:typeof fetch=async(url)=>{assert.ok(String(url).endsWith('/Balance.json'));return Response.json({account_sid:config.accountSid,balance:'12.29',currency:'USD'});};
  assert.deepEqual(await twilio(config,transport).saldoMonetario(),{amount:12.29,currency:'USD'});
  assert.equal(await twilio(config,async()=>Response.json({account_sid:'other',balance:'12.29',currency:'USD'})).saldoMonetario(),null);
});
Deno.test('Messaging Service readiness rejects empty or non-SMS sender pools',async()=>{
  const messagingServiceSid='MG'+'e'.repeat(32);
  for(const capabilities of [[],['Voice'],['SMS']]) {
    const responses=[{sid:config.accountSid,status:'active'},{sid:messagingServiceSid,account_sid:config.accountSid},{phone_numbers:[{capabilities}]}];
    assert.equal(await twilio({...config,messagingServiceSid},async()=>Response.json(responses.shift())).comprobar(),capabilities.includes('SMS'));
  }
});
Deno.test('Twilio and LabsMobile switch categories and fallback only on confirmed rejection',async()=>{
  const settings:RoutingSettings={sms_habilitado:true,sms_modo_prueba:false,sms_proveedor_otp:'twilio',sms_proveedor_transaccional:'labsmobile',sms_proveedor_recordatorios:'twilio',sms_proveedor_respaldo:'labsmobile',sms_fallback_habilitado:true};
  for(const code of [20003,21610]){const calls:string[]=[];await enrutar(settings,'otp',async p=>{calls.push(p);return p==='twilio'?clasificarTwilio(code===20003?401:400,{code},false):{estado:'aceptado',idProveedor:'lab-id'};});assert.deepEqual(calls,code===20003?['twilio','labsmobile']:['twilio']);}
});
