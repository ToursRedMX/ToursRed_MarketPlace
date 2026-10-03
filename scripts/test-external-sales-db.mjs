/**
 * Integration tests against the REAL restored schema, with all existing triggers.
 * Deliberately targets only a disposable local Docker database. No remote URL accepted.
 * Setup: see docs/ventas-externas.md.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const CONTAINER='toursred-external-tests', DB=process.env.EXTERNAL_SALES_TEST_DB === 'external_sales_replay_test' ? 'external_sales_replay_test' : 'external_sales_test';
const args=['exec','-i','-e','PGOPTIONS=-c timezone=America/Mexico_City',CONTAINER,'psql','-X','-qAt','-U','supabase_admin','-d',DB,'-v','ON_ERROR_STOP=1'];
function sql(query) {const r=spawnSync('docker',args,{input:query,encoding:'utf8',maxBuffer:8e6});if(r.status!==0)throw new Error(r.stderr||r.stdout);return r.stdout.trim().split('\n').filter(Boolean).at(-1)??'';}
function asyncSql(query) {return new Promise(resolve=>{const p=spawn('docker',args);let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('close',code=>resolve({code,out,err}));p.stdin.end(query);});}
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
const json=v=>literal(JSON.stringify(v))+'::jsonb';
function asUser(id,query){return "begin; set local role authenticated; select set_config('request.jwt.claim.sub',"+literal(id)+",true); select set_config('request.jwt.claims',"+json({sub:id,role:'authenticated'}).replace('::jsonb','')+",true);"+query+"; commit;";}
let passed=0;
function test(name,fn){fn();passed++;console.log('ok '+passed+' - '+name);}
function fails(fn,pattern){assert.throws(fn,pattern);}
const owner=randomUUID(),other=randomUUID(),traveler=randomUUID(),staff=randomUUID(),admin=randomUUID(),agency=randomUUID(),agencyB=randomUUID(),tour=randomUUID(),otherTour=randomUUID(),fixedTour=randomUUID(),slot=randomUUID(),slot2=randomUUID(),raceSlot=randomUUID(),staffId=randomUUID();
sql(`insert into auth.users(id,email) values ${[owner,other,traveler,staff,admin].map(id=>'('+literal(id)+','+literal(id+'@example.invalid')+')').join(',')};
insert into public.users(id,role,first_name,last_name,email) values ${[owner,other,traveler,staff,admin].map(id=>'('+literal(id)+','+literal(id===owner||id===other?'agency':id===admin?'admin':'traveler')+",'Test','External',"+literal(id+'@example.invalid')+')').join(',')};
insert into public.agencies(id,user_id,name,contact_email,persona_type) values ('${agency}','${owner}','Test A','a@example.invalid','persona_fisica'),('${agencyB}','${other}','Test B','b@example.invalid','persona_fisica');
insert into public.tours(id,agency_id,name,destination,description,price,deposit_percentage,image_url,start_date,end_date,max_travelers,available_spots,precio_adulto)
values ${[tour,otherTour,fixedTour].map(id=>"('"+id+"','"+(id===otherTour?agencyB:agency)+"','Test Tour','Test','Test',100,50,'https://example.invalid/test.png',current_date,current_date,20,20,100)").join(',')};
insert into public.tour_slots(id,tour_id,agency_id,slot_date,departure_time,capacity,status) values
('${slot}','${tour}','${agency}',current_date,'07:00',20,'activo'),('${slot2}','${tour}','${agency}',current_date,'08:00',5,'activo'),('${raceSlot}','${tour}','${agency}',current_date,'09:00',2,'activo');
insert into public.agency_staff(id,agency_id,user_id,is_active) values('${staffId}','${agency}','${staff}',true);
insert into public.agency_staff_permissions(staff_id,can_view_bookings,can_scan_checkin,can_view_financials) values('${staffId}',true,true,false)
on conflict(staff_id) do update set can_view_bookings=true,can_scan_checkin=true,can_view_financials=false;
`);
function booking(n,which=slot){return `insert into public.bookings(user_id,tour_id,agency_id,slot_id,deposit_amount,commission_amount,total_price,status,booking_date,travelers_count,paid_spots,approval_status,payment_status) values ('${traveler}','${tour}','${agency}',${which?literal(which):'null'},50,15,100,'confirmed',current_date,${n},${n},'approved','pending') returning id;`;}
const bookingId=sql(booking(8));
function payload(which=slot,more={}) {return {tour_id:tour,slot_id:which,source:'whatsapp',primary_traveler_name:'Synthetic Traveler',primary_traveler_email:'external@example.invalid',primary_traveler_phone:'5550000000',total_sale_amount:10000,amount_paid:6000,currency:'MXN',payment_method:'bank_transfer',operational_email_authorized:true,...more};}
function travelers(n){return Array.from({length:n},(_,i)=>({first_name:'Traveler '+i,last_name:'Test',traveler_type:'adulto',is_primary:i===0}));}
function save(n,which=slot,existing=null,version=null,more={},user=owner){return sql(asUser(user,`select public.save_external_sale(${json(payload(which,more))},${json(travelers(n))},${existing?literal(existing):'null'},${version??'null'})`));}
const available=(which=slot)=>Number(sql(`select available_spots from public.get_tour_availability_v2('${tour}',${literal(which)});`));
const financialTables=['bookings','commission_records','payment_transactions','agency_payouts','cfdi_invoices','accounting_entries','financial_transactions','toursred_cash_wallets','toursred_points_wallets','users','notifications','user_notifications'];
function financialSnapshot(){return sql('select jsonb_build_object('+financialTables.map(t=>literal(t)+",(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public."+t+' t)').join(',')+');');}
let sale;
test('creating $10,000 external sale changes no marketplace financial/user/notification rows',()=>{const before=financialSnapshot();sale=save(5);assert.equal(financialSnapshot(),before);});
test('20 capacity - 8 ToursRed - 5 external = 7 public places',()=>assert.equal(available(),7));
test('agency A reads its normalized travelers and pending = total - paid',()=>{assert.equal(Number(sql(asUser(owner,`select count(*) from public.external_sale_travelers where external_sale_id='${sale}'`))),5);assert.equal(Number(sql(asUser(owner,`select amount_pending from public.external_sale_financials where external_sale_id='${sale}'`))),4000);});
test('agency B and regular traveler cannot read external PII/amounts/events',()=>{for(const uid of [other,traveler,admin])for(const table of ['external_sales','external_sale_travelers','external_sale_financials','external_sale_events'])assert.equal(Number(sql(asUser(uid,'select count(*) from public.'+table))),0);});
test('agency B cannot edit/cancel agency A sale or insert own sale on agency A tour',()=>{fails(()=>save(1,slot,sale,1,{},other),/No autorizado/);fails(()=>sql(asUser(other,`select public.cancel_external_sale('${sale}','test',1)`)),/No autorizado/);fails(()=>save(1,slot,null,null,{},other),/No autorizado/);});
test('direct writes are denied, including self-reassigning a sale',()=>{fails(()=>sql(asUser(owner,`update public.external_sales set agency_id='${agencyB}' where id='${sale}'`)),/permission denied/);fails(()=>sql(asUser(owner,`delete from public.external_sales where id='${sale}'`)),/permission denied/);});
test('operational staff can see attendees but cannot read external financials',()=>{assert.equal(Number(sql(asUser(staff,`select count(*) from public.external_sale_travelers where external_sale_id='${sale}'`))),5);assert.equal(Number(sql(asUser(staff,`select count(*) from public.external_sale_financials where external_sale_id='${sale}'`))),0);fails(()=>save(1,slot,null,null,{},staff),/No autorizado/);});
test('overpayment, negative paid and zero travelers rejected atomically',()=>{for(const more of [{amount_paid:11000},{amount_paid:-1},{total_sale_amount:-1}])fails(()=>save(1,slot,null,null,more),/constraint/);fails(()=>save(0),/Cantidad/);assert.equal(available(),7);});
test('unified manifest identifies both sources without money columns',()=>{const rows=JSON.parse(sql(asUser(owner,`select jsonb_agg(m) from public.get_operational_manifest('${tour}','${slot}') m`)));assert.equal(rows.reduce((n,r)=>n+r.people,0),13);assert.deepEqual([...new Set(rows.map(r=>r.origin))].sort(),['Externa','ToursRed']);assert.ok(rows.every(r=>!('total_price' in r)));});
test('cancel 3 external travelers frees 3 places and preserves history',()=>{const id=save(3);assert.equal(available(),4);sql(asUser(owner,`select public.cancel_external_sale('${id}','Cancel test',1)`));assert.equal(available(),7);assert.equal(sql(asUser(owner,`select status from public.external_sales where id='${id}'`)),'cancelled');});
test('change 2 to 4 requires exactly 2 additional places',()=>{const id=save(2);assert.equal(available(),5);save(4,slot,id,1);assert.equal(available(),3);fails(()=>save(8,slot,id,2),/No hay suficientes/);assert.equal(available(),3);sql(asUser(owner,`select public.cancel_external_sale('${id}','Done test',2)`));});
test('moving sale releases original and consumes target atomically',()=>{const id=save(2);save(2,slot2,id,1);assert.equal(available(),7);assert.equal(available(slot2),3);fails(()=>save(6,slot2,id,2),/No hay suficientes/);assert.equal(available(slot2),3);sql(asUser(owner,`select public.cancel_external_sale('${id}','Done test',2)`));});
test('stale version rejected without lost update',()=>fails(()=>save(5,slot,sale,0),/La venta cambio/));
test('foreign tour-slot pair rejected',()=>fails(()=>save(1,slot,null,null,{tour_id:otherTour},other),/Salida no disponible/));
test('active holds reduce external capacity and are guarded on direct insertion',()=>{sql(`select public.hold_seats('${tour}','${slot}','test-session',null,6,'${traveler}',10);`);assert.equal(available(),1);fails(()=>save(2),/No hay suficientes/);fails(()=>sql(`insert into public.seat_holds(tour_id,slot_id,held_count,session_id,user_id,expires_at) values('${tour}','${slot}',2,'other','${traveler}',now()+interval '10 minutes');`),/No hay suficientes/);sql(`delete from public.seat_holds where tour_id='${tour}';`);});
test('agency cannot shrink departure capacity below unified occupancy',()=>fails(()=>sql(`update public.tour_slots set capacity=12 where id='${slot}';`),/capacidad/));
test('QR token is secure, wrong departure/agency rejected, duplicate detected',()=>{const token=sql(asUser(owner,`select public.generate_external_sale_qr('${sale}')`));assert.match(token,/^[a-f0-9]{64}$/);fails(()=>sql(asUser(owner,`select public.checkin_external_sale('${token}','${agency}','${tour}','${slot2}')`)),/QR invalido/);fails(()=>sql(asUser(other,`select public.checkin_external_sale('${token}','${agency}','${tour}','${slot}')`)),/No autorizado/);
const result=JSON.parse(sql(asUser(staff,`select public.checkin_external_sale('${token}','${agency}','${tour}','${slot}')`)));assert.equal(result.checked_in,5);
const again=JSON.parse(sql(asUser(staff,`select public.checkin_external_sale('${token}','${agency}','${tour}','${slot}')`)));assert.equal(again.already_checked_in,true);
assert.equal(Number(sql(`select count(*) from public.external_sale_travelers where external_sale_id='${sale}' and checked_in_by='${staff}' and checked_in_at is not null;`)),5);});
test('cancelled QR and previous rotated token rejected',()=>{const id=save(1);const first=sql(asUser(owner,`select public.generate_external_sale_qr('${id}')`));const second=sql(asUser(owner,`select public.generate_external_sale_qr('${id}')`));assert.notEqual(first,second);fails(()=>sql(asUser(owner,`select public.checkin_external_sale('${first}','${agency}','${tour}','${slot}')`)),/QR invalido/);sql(asUser(owner,`select public.cancel_external_sale('${id}','Cancel QR',1)`));fails(()=>sql(asUser(owner,`select public.checkin_external_sale('${second}','${agency}','${tour}','${slot}')`)),/QR invalido/);});
test('legacy no-slot tour shares inventory without summing other departures',()=>{const id=save(3,null,null,null,{tour_id:fixedTour});assert.ok(id);assert.equal(Number(sql(`select available_spots from public.get_tour_availability('${fixedTour}');`)),17);});
test('anonymous caller cannot query private tables or invoke mutations',()=>{fails(()=>sql('begin; set local role anon; select count(*) from public.external_sales; rollback;'),/permission denied/);fails(()=>sql("begin; set local role anon; select public.generate_external_sale_qr('"+sale+"'); rollback;"),/permission denied/);});
test('audit contains event names/changed field names only, no PII or amounts',()=>{const events=sql(asUser(owner,'select jsonb_agg(e) from public.external_sale_events e'));assert.ok(events.includes('checkin'));assert.ok(!events.includes('external@example.invalid'));assert.ok(!events.includes('10000'));});
const concurrentExternal=asUser(owner,`select public.save_external_sale(${json(payload(raceSlot))},${json(travelers(2))}); select pg_sleep(0.5)`);
const concurrentBooking='begin;'+booking(2,raceSlot)+'select pg_sleep(0.5);commit;';
const results=await Promise.all([asyncSql(concurrentExternal),asyncSql(concurrentBooking)]);
test('concurrent marketplace + external attempts on last 2 places: exactly one commits',()=>{assert.equal(results.filter(r=>r.code===0).length,1,JSON.stringify(results));assert.equal(available(raceSlot),0);assert.equal(Number(sql(`select marketplace+external from toursred_ops.inventory('${tour}','${raceSlot}');`)),2);});

test('external amount edits audit changed field names without financial side effects',()=>{const id=save(1);const before=financialSnapshot();save(1,slot,id,1,{amount_paid:8000});assert.equal(financialSnapshot(),before);assert.ok(sql(asUser(owner,`select changed_fields from public.external_sale_events where external_sale_id='${id}' and event_type='updated'`)).includes('amounts'));sql(asUser(owner,`select public.cancel_external_sale('${id}','Done',2)`));});
test('operational email requires consent, rate limits requests and excludes amounts',()=>{const id=save(1,slot,null,null,{operational_email_authorized:false});fails(()=>sql(asUser(owner,`select public.prepare_external_sale_email('${id}')`)),/autorizacion/);save(1,slot,id,1);const mail=JSON.parse(sql(asUser(owner,`select public.prepare_external_sale_email('${id}')`)));assert.equal(mail.agency.name,'Test A');assert.ok(!('amount_paid' in mail));assert.match(mail.token,/^[a-f0-9]{64}$/);fails(()=>sql(asUser(owner,`select public.prepare_external_sale_email('${id}')`)),/Espera un minuto/);fails(()=>sql(asUser(owner,`select public.finish_external_sale_email('${id}','${owner}',true)`)),/permission denied/);sql(asUser(owner,`select public.cancel_external_sale('${id}','Done',2)`));});
test('public slot API preserves marketplace booked_count used by minimum-price calculations',()=>{const row=JSON.parse(sql(`select to_jsonb(s) from public.get_tour_slots_by_range('${tour}',current_date,current_date) s where id='${slot}';`));assert.equal(row.booked_count,8);assert.equal(row.available_count,7);});
function marketplaceRpc(which) {
 const input={user_id:traveler,tour_id:tour,slot_id:which,travelers_count:2,count_adultos:2,booking_date:sql('select current_date;'),status:'pending',approval_status:'approved',payment_status:'pending',payment_provider:'stripe'};
 return `select public.create_booking_atomic_with_preventa(${json(input)},${json([{nombre:'One',apellido:'Test',email:'one@example.invalid',categoria_viajero:'adulto'},{nombre:'Two',apellido:'Test',email:'two@example.invalid',categoria_viajero:'adulto'}])},'[]'::jsonb,null,null);`;
}
for(const first of ['external','marketplace']){
 const target=randomUUID();
 sql(`insert into public.tour_slots(id,tour_id,agency_id,slot_date,departure_time,capacity,status) values('${target}','${tour}','${agency}',current_date,'${first==='external'?'10:00':'11:00'}',2,'activo');`);
 const ex=asUser(owner,`select public.save_external_sale(${json(payload(target))},${json(travelers(2))});select pg_sleep(0.2)`);
 const mk=asUser(traveler,marketplaceRpc(target)+'select pg_sleep(0.2)');
 const a=asyncSql(first==='external'?ex:mk);await new Promise(r=>setTimeout(r,50));const b=asyncSql(first==='external'?mk:ex);
 const outcome=await Promise.all([a,b]);
 const externalResult=outcome[first==='external'?0:1];
 const marketplaceResult=outcome[first==='external'?1:0];
 const marketplaceSuccess=marketplaceResult.code===0&&marketplaceResult.out.includes('"success": true');
 test('REAL marketplace RPC versus external sale, '+first+' starts first',()=>{assert.equal(Number(externalResult.code===0)+Number(marketplaceSuccess),1,JSON.stringify(outcome));assert.equal(available(target),0);if(first==='marketplace')assert.equal(marketplaceSuccess,true,JSON.stringify(outcome));});
}

console.log('\n'+passed+' integration tests passed on full restored schema; no remote database modified.');
