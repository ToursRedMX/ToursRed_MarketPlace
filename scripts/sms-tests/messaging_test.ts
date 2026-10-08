import assert from 'node:assert/strict';
import { segmentosSms, plantillaOtp, plantillaConfirmacion, plantillaRecordatorio } from '../../supabase/functions/_shared/mensajeria/plantillas.ts';
import { normalizarTelefonoSms } from '../../supabase/functions/_shared/mensajeria/telefono.ts';
import { clasificarRespuesta, interpretarCallback, labsmobile } from '../../supabase/functions/_shared/mensajeria/proveedores/labsmobile.ts';
import { mock } from '../../supabase/functions/_shared/mensajeria/proveedores/mock.ts';
import { enrutar, permiteFallback } from '../../supabase/functions/_shared/mensajeria/enrutador.ts';
import { hmac, verificarFirma, datosOtp, nuevoCodigo, nuevaCorrelacion } from '../../supabase/functions/_shared/mensajeria/seguridad.ts';
import type { MensajeSms, ResultadoEnvio, RoutingSettings } from '../../supabase/functions/_shared/mensajeria/tipos.ts';
const message: MensajeSms = { destino: '+525512345678', texto: 'Test', correlacion: 'a'.repeat(20), categoria: 'otp', simulacion: true, urlEstados: 'https://example.invalid/callback' };
const settings: RoutingSettings = { sms_habilitado:true,sms_modo_prueba:true,sms_proveedor_otp:'labsmobile',sms_proveedor_transaccional:'mock',sms_proveedor_recordatorios:'labsmobile',sms_proveedor_respaldo:'mock',sms_fallback_habilitado:true };
Deno.test('GSM septets include extension table and concatenation', () => {
  assert.equal(segmentosSms('a'.repeat(160)).segments,1); assert.equal(segmentosSms('a'.repeat(161)).segments,2);
  assert.equal(segmentosSms('^'.repeat(80)).segments,1); assert.equal(segmentosSms('^'.repeat(81)).segments,2);
  assert.equal(segmentosSms('ñé€').units,4); assert.equal(segmentosSms('á').encoding,'Unicode');
});
Deno.test('Unicode measures UTF16 units including surrogate pairs', () => {
  assert.equal(segmentosSms('漢'.repeat(70)).segments,1); assert.equal(segmentosSms('漢'.repeat(71)).segments,2);
  assert.equal(segmentosSms('😀'.repeat(36)).units,72); assert.equal(segmentosSms('😀'.repeat(36)).segments,2);
});
Deno.test('worst-case templates fit one segment; links use real authenticated route', () => {
  for(const text of [plantillaOtp('012345'),plantillaConfirmacion('X'.repeat(100),'https://toursredmx.netlify.app'),plantillaRecordatorio('á😀'.repeat(100),'P'.repeat(100),'F'.repeat(100))]) {
    assert.equal(segmentosSms(text).encoding,'GSM-7'); assert.equal(segmentosSms(text).segments,1);
  }
  assert.ok(plantillaConfirmacion('TR1','https://toursred.com').includes('/traveler/bookings'));
  assert.throws(()=>plantillaConfirmacion('TR1','http://example.invalid'));
});
Deno.test('international normalization distinguishes countries and rejects unsupported ones', () => {
  assert.deepEqual(normalizarTelefonoSms('55 1234 5678','MX',['MX']),{e164:'+525512345678',country:'MX'});
  assert.equal(normalizarTelefonoSms('+1 416 555 0123','US',['US','CA']).country,'CA');
  assert.equal(normalizarTelefonoSms('+44 20 7946 0958','GB',['GB']).e164,'+442079460958');
  assert.throws(()=>normalizarTelefonoSms('+44 20 7946 0958','MX',['MX']),/pais_no_soportado/);
  assert.throws(()=>normalizarTelefonoSms('+5215512345678','MX',['MX']),/formato_mexicano/);
  assert.throws(()=>normalizarTelefonoSms('call 5512345678','MX',['MX']));
});
Deno.test('provider accepted is not delivered; test is always simulated', () => {
  assert.equal(clasificarRespuesta(200,{code:'0',subid:'ABC'},false).estado,'aceptado');
  assert.equal(clasificarRespuesta(200,{code:0,subid:'ABC'},true).estado,'simulado');
});
Deno.test('invalid payload is permanent; credit/auth reject allows fallback', () => {
  for(const code of ['20','21','23','24','27','28']) assert.equal(permiteFallback(clasificarRespuesta(200,{code},false)),false);
  for(const status of [401,402,403,429]) assert.equal(permiteFallback(clasificarRespuesta(status,null,false)),true);
  assert.equal(permiteFallback(clasificarRespuesta(200,{code:'35'},false)),true);
});
Deno.test('500, malformed body, JSON 30 and missing subid are unknown', () => {
  for(const result of [clasificarRespuesta(500,null,false),clasificarRespuesta(200,{code:'30'},false),clasificarRespuesta(200,{},false),clasificarRespuesta(200,{code:'0'},false)]) assert.equal(result.estado,'resultado_desconocido');
});
Deno.test('LabsMobile REST payload and test flag, no real transport', async () => {
  let calls=0;
  const transport: typeof fetch = async (url,init) => {
    calls++; assert.equal(url,'https://api.labsmobile.com/json/send'); assert.equal(init?.redirect,'error');
    assert.equal(new Headers(init?.headers).get('authorization'),'Basic '+btoa('user:token'));
    const body=JSON.parse(String(init?.body)); assert.equal(body.test,1); assert.equal(body.recipient[0].msisdn,'525512345678');
    assert.equal(body.subid,message.correlacion); assert.equal(body.ackurl,message.urlEstados);
    return Response.json({code:0,subid:body.subid});
  };
  assert.equal((await labsmobile('user','token','ToursRed',transport).enviar(message)).estado,'simulado'); assert.equal(calls,1);
});
Deno.test('transport timeout cannot trigger fallback', async () => {
  const transport: typeof fetch = async ()=>{ throw new DOMException('timeout','TimeoutError'); };
  const result=await labsmobile('user','token','ToursRed',transport).enviar(message);
  assert.equal(result.estado,'resultado_desconocido'); assert.equal(permiteFallback(result),false);
});
Deno.test('fallback tries exactly once only after confirmed refusal', async () => {
  const cases: ResultadoEnvio[]=[{estado:'aceptado',idProveedor:'a'},{estado:'resultado_desconocido',codigo:'timeout'},{estado:'fallido',clase:'permanente',codigo:'invalid'},{estado:'fallido',clase:'rechazo_confirmado',codigo:'lm_35'}];
  for(const initial of cases){ const calls:string[]=[]; await enrutar(settings,'otp',async(p)=>{calls.push(p);return calls.length===1?initial:{estado:'simulado',idProveedor:'b'};}); assert.equal(calls.length,permiteFallback(initial)?2:1); }
});
Deno.test('different category providers and disabled service require no deployment', async () => {
  const calls:string[]=[]; const send=async(p:string):Promise<ResultadoEnvio>=>{calls.push(p);return {estado:'simulado',idProveedor:'test'};};
  await enrutar(settings,'reserva_confirmada',send); await enrutar(settings,'recordatorio_tour',send); await enrutar({...settings,sms_habilitado:false},'otp',send);
  assert.deepEqual(calls,['mock','labsmobile']);
});
Deno.test('mock cannot claim live delivery', async () => {
  assert.equal((await mock.enviar(message)).estado,'simulado'); assert.equal((await mock.enviar({...message,simulacion:false})).estado,'fallido');
});
Deno.test('callbacks distinguish operator from handset; reject invalid correlation/number', () => {
  const url=new URL('https://example.invalid/?subid=ABC&msisdn=525512345678&acklevel=operator&status=ok&desc=DELIVRD');
  assert.equal(interpretarCallback(url)?.estado,'enviado'); url.searchParams.set('acklevel','handset'); assert.equal(interpretarCallback(url)?.estado,'entregado');
  url.searchParams.set('status','ko'); assert.equal(interpretarCallback(url)?.estado,'fallido'); url.searchParams.set('msisdn','invalid'); assert.equal(interpretarCallback(url),null);
});
Deno.test('cryptographic OTP and HMAC are bound to challenge/user/number', async () => {
  const secret='x'.repeat(32),value=datosOtp('user','challenge','+525512345678','012345'); const signature=await hmac(secret,value);
  assert.ok(await verificarFirma(secret,value,signature)); assert.equal(await verificarFirma(secret,datosOtp('other','challenge','+525512345678','012345'),signature),false);
  assert.equal(await verificarFirma(secret,value,'0'.repeat(64)),false);
  for(let i=0;i<100;i++){assert.match(nuevoCodigo(),/^\d{6}$/);assert.match(nuevaCorrelacion(),/^[a-f0-9]{20}$/);}
});
