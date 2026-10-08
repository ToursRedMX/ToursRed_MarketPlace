import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import TurnstileWidget from '../../components/TurnstileWidget';
import { useTurnstileEnabled } from '../../hooks/useTurnstileEnabled';

const messages: Record<string,string> = {
  OTP_INVALID:'El código no es válido. Revisa los seis dígitos.',OTP_EXPIRED:'El código venció. Solicita uno nuevo.',OTP_COOLDOWN:'Espera 60 segundos antes de solicitar otro código.',
  OTP_LOCKED:'Se alcanzó el límite de intentos. Vuelve a intentarlo mañana.',OTP_RATE_LIMIT:'Se alcanzó el límite de solicitudes. Intenta más tarde.',
  PHONE_UNAVAILABLE:'Este teléfono no está disponible para verificar esta cuenta. Usa otro número o contacta a soporte.',
  PHONE_REAUTH_REQUIRED:'Para cambiar el teléfono, cierra sesión y vuelve a iniciar sesión con tu método habitual. Después regresa aquí.',
  OTP_SIMULATION:'El servicio está en simulación. Esta prueba no puede verificar un teléfono real.',SMS_UNAVAILABLE:'El servicio de verificación no está disponible temporalmente. Contacta a soporte.',
  pais_no_soportado:'Ese país todavía no tiene cobertura habilitada. Contacta a soporte para revisar la cobertura; la verificación sigue siendo necesaria.',
  telefono_invalido:'Revisa el número y su código de país.',pais_invalido:'Selecciona un país válido.',usa_formato_mexicano_52:'Para México utiliza +52 y diez dígitos, sin el antiguo 1 adicional.',
  CAPTCHA_REQUIRED:'Completa la verificación de seguridad.',CAPTCHA_INVALID:'Repite la verificación de seguridad.',EMAIL_OR_ACCOUNT_REQUIRED:'Primero verifica tu correo electrónico.',
};
async function invoke(name:string,body:Record<string,unknown>) {
  const {data,error}=await supabase.functions.invoke(name,{body});
  if(error){
    let code='OTP_UNAVAILABLE';
    if(error.context instanceof Response){try{code=(await error.context.json()).code??code;}catch{/* generic message */}}
    throw new Error(messages[code]??'No se pudo completar la solicitud. Intenta más tarde.');
  }
  return data;
}
export default function VerifyPhonePage(){
 const {user,userRole,isLoading,isEmailVerified,phoneVerification,refreshPhoneVerification}=useAuth();
 const navigate=useNavigate(),location=useLocation();
 const [phone,setPhone]=useState(''),[country,setCountry]=useState('MX'),[code,setCode]=useState(''),[challenge,setChallenge]=useState('');
 const [cooldown,setCooldown]=useState(0),[expiry,setExpiry]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [suffix,setSuffix]=useState(''),[captcha,setCaptcha]=useState(''),[captchaKey,setCaptchaKey]=useState(0),[simulation,setSimulation]=useState(false);
 const {turnstileEnabled,loading:captchaLoading}=useTurnstileEnabled();
 const countries=useQuery({queryKey:['sms-supported-countries'],queryFn:async()=>{const {data,error}=await supabase.from('platform_settings').select('sms_paises_permitidos').single();if(error)throw error;return data.sms_paises_permitidos as string[];}});
 useEffect(()=>{const timer=setInterval(()=>{setCooldown(v=>Math.max(0,v-1));setExpiry(v=>Math.max(0,v-1));},1000);return()=>clearInterval(timer);},[]);
 if(isLoading)return <p role="status" className="p-8">Cargando…</p>;
 if(!user)return <Navigate to="/login?redirect=%2Fverificar-telefono" replace/>;
 if(!isEmailVerified&&!['admin','accountant','account_executive'].includes(userRole??''))return <Navigate to="/verify-email" replace/>;
 const request=async()=>{
  setBusy(true);setError('');setMessage('');
  try{const data=await invoke('request-phone-otp',{phone,country,turnstile_token:captcha});setChallenge(data.challenge_id);setSuffix(data.phone_suffix);setCooldown(60);setExpiry(Math.max(0,Math.floor((Date.parse(data.expires_at)-Date.now())/1000)));setSimulation(data.simulated);setCode('');setMessage(data.simulated?'Solicitud simulada: no se enviará un SMS real ni se verificará el teléfono.':data.delivery==='resultado_desconocido'?'La entrega está pendiente de confirmar. Espera antes de solicitar otro código.':'Código solicitado. Revisa tus mensajes SMS.');}
  catch(e){setError(e instanceof Error?e.message:'No se pudo solicitar el código.');}
  finally{setBusy(false);setCaptcha('');setCaptchaKey(k=>k+1);}
 };
 const verify=async()=>{
  setBusy(true);setError('');try{await invoke('verify-phone-otp',{challenge_id:challenge,code});await refreshPhoneVerification();setMessage('Teléfono verificado.');setChallenge('');
   const redirect=new URLSearchParams(location.search).get('redirect');if(redirect?.startsWith('/')&&!redirect.startsWith('//')&&!redirect.includes('\\'))navigate(redirect,{replace:true});
  }catch(e){setError(e instanceof Error?e.message:'No se pudo verificar el código.');}finally{setBusy(false);}
 };
 return <main className="mx-auto max-w-lg px-4 py-12"><h1 className="text-2xl font-bold">Verifica tu teléfono</h1>
  <p className="my-3 text-slate-600">Verificamos el teléfono de quien controla esta cuenta. Si operas una agencia, puede ser distinto de su teléfono comercial.</p>
  {phoneVerification?.verified_at&&<p className="my-3 text-green-700">Teléfono terminado en {phoneVerification.phone_suffix} verificado. Cambiar el número requerirá volver a verificarlo.</p>}
  {countries.isError&&<p role="alert">No se pudo consultar la cobertura. <button type="button" onClick={()=>void countries.refetch()}>Reintentar</button></p>}
  <form onSubmit={e=>{e.preventDefault();void request();}} className="space-y-4">
   <label className="block">País<select className="mt-1 block w-full rounded border p-2" value={country} onChange={e=>setCountry(e.target.value)} disabled={busy}>{(countries.data??['MX']).map(c=><option key={c} value={c}>{c}</option>)}</select></label>
   <label className="block">Teléfono con código de país<input className="mt-1 block w-full rounded border p-2" type="tel" autoComplete="tel" placeholder="+52 55 1234 5678" value={phone} onChange={e=>setPhone(e.target.value)} maxLength={40} required disabled={busy}/></label>
   {turnstileEnabled&&<TurnstileWidget key={captchaKey} onToken={setCaptcha}/>}
   <button className="rounded bg-primary-600 px-4 py-2 text-white disabled:opacity-50" disabled={busy||cooldown>0||countries.isError||countries.isPending||captchaLoading||(turnstileEnabled&&!captcha)}>{cooldown>0?`Reenviar en ${cooldown} s`:challenge?'Solicitar otro código':'Enviar código'}</button>
  </form>
  {challenge&&<form className="mt-6 space-y-3" onSubmit={e=>{e.preventDefault();void verify();}}><p>Código para el teléfono terminado en {suffix}. {expiry>0?`Vence en ${Math.ceil(expiry/60)} min.`:'El código venció.'}</p>
   <label className="block">Código de seis dígitos<input className="mt-1 block w-full rounded border p-2 tracking-widest" inputMode="numeric" autoComplete="one-time-code" value={code} maxLength={6} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} disabled={busy}/></label>
   <button className="rounded bg-primary-600 px-4 py-2 text-white disabled:opacity-50" disabled={busy||code.length!==6||expiry===0||simulation}>Verificar teléfono</button></form>}
  {error&&<p role="alert" className="my-4 text-red-700">{error}</p>}{message&&<p role="status" className="my-4 text-green-700">{message}</p>}
  <details className="mt-6"><summary>Ya no tengo acceso a mi número</summary><p className="my-2">Vuelve a iniciar sesión con correo/contraseña o tu proveedor habitual para confirmar tu acceso. Después registra y verifica el nuevo teléfono. No necesitas recibir un SMS en el número anterior.</p><p>Si tampoco tienes acceso a tu correo o autenticación de dos pasos, contacta a soporte. No podemos acreditar un número por sus últimos dígitos.</p><button type="button" className="underline" onClick={async()=>{await supabase.auth.signOut();navigate('/login?redirect=%2Fverificar-telefono');}}>Cerrar sesión e identificarme otra vez</button></details>
  <div className="mt-6 flex gap-4"><Link className="underline" to="/contact">Contactar a soporte</Link><Link className="underline" to="/profile">Volver a mi perfil</Link></div>
 </main>;
}
