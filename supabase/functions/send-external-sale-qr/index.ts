import "jsr:@supabase/functions-js@2.112.4/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import QRCode from "npm:qrcode@1.5.4";
import { requireUser } from "../_shared/auth.ts";
import { externalEmailHtml } from "../_shared/externalSaleEmail.ts";
import type { ExternalEmail } from "../_shared/externalSaleEmail.ts";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info, x-correlation-id"};
const json=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
type Prepared=ExternalEmail&{id:string;actor_id:string;email:string;token:string;tour_id:string;slot_id:string|null};
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS") return new Response(null,{headers:cors});
 if(req.method!=="POST") return json({error:"Método no permitido"},405);
 const guard=await requireUser(req,{recurso:"send-external-sale-qr",cors});
 if(!guard.ok) return guard.response;
 if(!guard.llamador.userId) return json({error:"Se requiere una persona autorizada"},403);
 const url=Deno.env.get("SUPABASE_URL")!;
 const admin=createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
 const user=createClient(url,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:req.headers.get("Authorization")!}}});
 let prepared:Prepared|null=null;
 try{
 const {external_sale_id}=await req.json();
 if(typeof external_sale_id!=="string") return json({error:"Venta requerida"},400);
 // Check settings before rotating a token or consuming the rate limit.
 const settings=await admin.from("email_settings").select("smtp_api_key,contact_email").maybeSingle();
 if(settings.error||!settings.data?.smtp_api_key||!settings.data.contact_email) return json({error:"Correo no configurado"},503);
 const result=await user.rpc("prepare_external_sale_email",{p_id:external_sale_id});
 if(result.error) return json({error:result.error.message},403);
 prepared=result.data as Prepared;
 const qrUrl=new URL("/agency/agenda",Deno.env.get("SITE_URL")||"https://toursred.com");
 qrUrl.searchParams.set("tour",prepared.tour_id);if(prepared.slot_id)qrUrl.searchParams.set("slot",prepared.slot_id);
 qrUrl.hash="external-qr="+prepared.token;
 const png=await QRCode.toDataURL(qrUrl.toString(),{width:360,margin:2});
 const response=await fetch("https://api.smtp2go.com/v3/email/send",{method:"POST",headers:{"Content-Type":"application/json"},
 body:JSON.stringify({api_key:settings.data.smtp_api_key,to:[prepared.email],sender:settings.data.contact_email,
 subject:prepared.agency.name.replace(/[\r\n]/g," ")+" · QR de check-in",
 html_body:externalEmailHtml(prepared,url+"/storage/v1/object/public/images/email-logo.png"),
 custom_headers:[{header:"Reply-To",value:prepared.agency.contact_email.replace(/[\r\n]/g,"")}],
 inlines:[{filename:"checkin.png",fileblob:png.split(",")[1],mimetype:"image/png"}]}),
 signal:AbortSignal.timeout(20000)});
 const resultMail=await response.json();
 const success=response.ok&&!resultMail.data?.error&&Number(resultMail.data?.failed??0)===0&&Number(resultMail.data?.succeeded??0)>0;
 const audit=await admin.rpc("finish_external_sale_email",{p_id:prepared.id,p_actor:prepared.actor_id,p_success:success});
 if(audit.error) return json({error:"El proveedor respondió, pero no se pudo registrar el resultado. Revisa antes de reenviar."},500);
 return success?json({success:true}):json({error:"El proveedor no aceptó el correo. Puedes reintentar en un minuto."},502);
 }catch{
 if(prepared){const {error}=await admin.rpc("finish_external_sale_email",{p_id:prepared.id,p_actor:prepared.actor_id,p_success:false});if(error)console.error("external_qr_email_audit_failed");}
 // Do not log recipient, token, payload, SMTP response or private amounts.
 return json({error:"No se pudo confirmar el envío del correo. Revisa antes de reenviar."},500);
 }
});
