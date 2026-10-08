import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { requireUser } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { hmac, datosOtp } from '../_shared/mensajeria/seguridad.ts';

Deno.serve(async req=>{
 const cors=corsHeaders(req);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return new Response('method',{status:405,headers:cors});
 const auth=await requireUser(req,{recurso:'verify-phone-otp',cors,phoneContext:'verification'});
 if(!auth.ok)return auth.response;
 const userId=auth.llamador.userId;
 if(!userId)return Response.json({code:'USER_SESSION_REQUIRED'},{status:401,headers:cors});
 try{
  const raw=await req.text();if(raw.length>1024)throw Error('invalid');const body=JSON.parse(raw);
  if(typeof body.code!=='string'||!/^\d{6}$/.test(body.code)||typeof body.challenge_id!=='string'||!/^[a-f0-9-]{36}$/.test(body.challenge_id))return Response.json({code:'OTP_INVALID'},{status:400,headers:cors});
  const client=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{auth:{persistSession:false}});
  const {data:challenge,error}=await client.rpc('get_phone_challenge',{p_user:userId,p_id:body.challenge_id});
  if(error||!challenge||challenge.pepper_version!==1)return Response.json({code:'OTP_INVALID'},{status:400,headers:cors});
  const pepper=Deno.env.get('PHONE_OTP_PEPPER')??'';
  const [hash,userHash]=await Promise.all([hmac(pepper,datosOtp(userId,body.challenge_id,challenge.phone,body.code)),hmac(pepper,'user:'+userId)]);
  const {data,error:verifyError}=await client.rpc('verify_phone_challenge',{p_user:userId,p_id:body.challenge_id,p_hash:hash,p_user_hash:userHash});
  if(verifyError)throw Error('verify');
  return Response.json(data,{status:data?.ok?200:400,headers:cors});
 }catch{return Response.json({code:'OTP_UNAVAILABLE'},{status:503,headers:cors});}
});
