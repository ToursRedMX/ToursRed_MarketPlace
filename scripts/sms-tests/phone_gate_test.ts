import assert from 'node:assert/strict';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
import { phoneGate, type PhoneContext } from '../../supabase/functions/_shared/mensajeria/phoneGate.ts';
function client(role:string,pending:boolean,error=false){
 const calls:string[]=[];
 const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{role,is_active:true},error:null})};
 return {calls,value:{from:()=>q,rpc:async(_name:string,args:{p_context:string})=>{calls.push(args.p_context);return{data:{pending},error:error?{}:null};}} as unknown as SupabaseClient};
}
for(const role of ['traveler','agency','admin','accountant','account_executive']){
 Deno.test(`phone policy context: ${role}`,async()=>{const c=client(role,true);assert.equal(await phoneGate(c.value,'id','protected'),'pending');assert.equal(c.calls[0],['traveler','agency'].includes(role)?role:'administrative');});
}
Deno.test('effective traveler/agency context cannot use administrative exemption',async()=>{for(const context of ['traveler','agency'] as PhoneContext[]){const c=client('admin',true);assert.equal(await phoneGate(c.value,'id','protected',context),'pending');assert.equal(c.calls[0],context);}});
Deno.test('global policy off or verified account allows access',async()=>{assert.equal(await phoneGate(client('traveler',false).value,'id','protected'),'allowed');});
Deno.test('policy failure closes protected access',async()=>{assert.equal(await phoneGate(client('traveler',false,true).value,'id','protected'),'unavailable');});
Deno.test('verification and email recovery remain reachable',async()=>{for(const resource of ['request-phone-otp','verify-phone-otp','send-verification-email','verify-email-code']){const c=client('traveler',true);assert.equal(await phoneGate(c.value,'id',resource),'allowed');assert.equal(c.calls.length,0);}});
