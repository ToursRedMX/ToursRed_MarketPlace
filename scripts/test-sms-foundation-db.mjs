/** Fase 1, esquema real restaurado + migración, Docker SIN RED. No URLs remotas. */
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const container = 'toursred-external-tests', database = 'sms_phase1_full';
const inspect = spawnSync('docker', ['inspect', container, '--format', '{{json .NetworkSettings.Networks}}'], { encoding: 'utf8' });
assert.equal(inspect.status, 0, inspect.stderr);
assert.equal(inspect.stdout.trim(), '{}', 'Las pruebas requieren Docker sin red: hay triggers reales');
const args = ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1'];
function sql(q) {
  const r = spawnSync('docker', args, { input: q, encoding: 'utf8', maxBuffer: 4e6 });
  if (r.status !== 0) throw Error(r.stderr || r.stdout);
  return r.stdout.trim().split('\n').filter(Boolean).at(-1) ?? '';
}
function parallel(q) {
  return new Promise(resolve => {
    const child = spawn('docker', args); let out = '', err = '';
    child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
    child.on('close', code => resolve({ code, out, err })); child.stdin.end(q);
  });
}
const lit = v => "'" + String(v).replaceAll("'", "''") + "'";
const json = v => lit(JSON.stringify(v)) + '::jsonb';
const ids = Object.fromEntries(['traveler', 'agency', 'admin', 'superadmin', 'accountant', 'executive', 'denied', 'inactive', 'staff'].map(r => [r, randomUUID()]));
function auth(id, q, aal = 'aal1') {
  return `begin; set local role authenticated; select set_config('request.jwt.claim.sub','${id}',true); select set_config('request.jwt.claims',${lit(JSON.stringify({ sub: id, role: 'authenticated', aal }))},true); ${q}; commit;`;
}
function service(q) { return `begin; set local role service_role; ${q}; commit;`; }
let passed = 0;
function test(name, fn) { fn(); console.log(`ok ${++passed} - ${name}`); }
const reject = (fn, pattern) => assert.throws(fn, pattern);
sql(`insert into auth.users(id,email,last_sign_in_at) values ${Object.values(ids).map(id => `('${id}','${id}@example.invalid',now())`).join(',')};
insert into public.users(id,email,first_name,last_name,role,is_active,is_super_admin,email_verified,phone_number) values
${Object.entries(ids).map(([role,id],i) => `('${id}','${id}@example.invalid','SMS','Test','${({ superadmin:'admin',denied:'admin',inactive:'admin',staff:'traveler',executive:'account_executive' })[role] ?? role}',${role !== 'inactive'},${role === 'superadmin'},true,'+52550000${String(i).padStart(4,'0')}')`).join(',')};
insert into public.admin_permissions(user_id,can_manage_settings) values('${ids.admin}',true),('${ids.inactive}',true)
on conflict(user_id) do update set can_manage_settings=true;
insert into public.platform_settings(id,pac_provider,accounting_provider) select gen_random_uuid(),'facturapi','internal' where not exists(select 1 from public.platform_settings);
update public.platform_settings set phone_verification_required=false,phone_verification_travelers_required=true,phone_verification_agencies_required=true,sms_habilitado=false,sms_modo_prueba=true,mfa_required_for_admins=false;
`);
const config = () => JSON.parse(sql(auth(ids.admin, 'select public.get_sms_settings()')));
const version = () => config().settings.sms_config_version;
const patch = (values, expected = version(), who = ids.admin, aal = 'aal1') => JSON.parse(sql(auth(who, `select public.update_sms_settings(${json(values)},${expected})`, aal)));
const policy = (who, context) => JSON.parse(sql(service(`select public.phone_verification_policy('${who}',${lit(context)})`)));
test('defaults: global/SMS off, roles on, simulation on', () => {
  const s = config().settings;
  assert.equal(s.phone_verification_required,false); assert.equal(s.sms_habilitado,false);
  assert.equal(s.phone_verification_travelers_required,true); assert.equal(s.phone_verification_agencies_required,true); assert.equal(s.sms_modo_prueba,true);
});
test('RLS and grants deny every private table to anon/authenticated', () => {
  const tables = JSON.parse(sql("select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='messaging_private' and c.relkind='r'"));
  assert.ok(tables.length >= 8);
  for (const t of tables) { assert.equal(t.rls,true); for (const role of ['anon','authenticated']) reject(() => sql(`begin; set local role ${role}; select * from messaging_private.${t.name}; rollback;`),/permission denied/); }
});
test('traveler, agency, executive, accountant, admin without permission and inactive admin cannot manage SMS', () => {
  for (const key of ['traveler','agency','executive','accountant','denied','inactive']) {
    reject(() => sql(auth(ids[key],'select public.get_sms_settings()')),/No autorizado/);
    reject(() => patch({sms_limite_diario:99},version(),ids[key]),/No autorizado/);
  }
});
test('superadmin may configure but cannot bypass provider readiness', () => {
  assert.equal(patch({sms_limite_diario:100},version(),ids.superadmin).settings.sms_limite_diario,100);
  reject(() => patch({sms_proveedor_otp:'twilio'},version(),ids.superadmin),/Proveedor no implementado/);
});
test('direct UPDATE cannot bypass RPC, even privileged admin', () => {
  for(const who of [ids.admin,ids.superadmin]) reject(() => sql(auth(who,'update public.platform_settings set sms_habilitado=true')),/Usa update_sms_settings/);
});
test('global activation and SMS cannot be enabled before implementation', () => {
  reject(() => patch({phone_verification_required:true}),/obligatoriedad requiere/);
  reject(() => patch({sms_habilitado:true}),/Motor SMS aun no disponible/);
});
test('strict config fields/types, country codes, bounds and fallback', () => {
  for (const value of [{service_charge_percentage:20},{sms_config_version:9},{sms_habilitado:'false'},{sms_modo_prueba:null},{sms_paises_permitidos:[]},{sms_paises_permitidos:['MX','MX']},{sms_paises_permitidos:['MEX']},{sms_limite_diario:2000},{sms_hora_recordatorio_local:22},{sms_fallback_habilitado:true}]) reject(() => patch(value),/Campo no permitido|Tipo invalido|Paises invalidos|limite mensual|constraint|Respaldo invalido/);
});
test('optimistic version prevents lost admin changes', () => {
  const old = version(); patch({sms_limite_diario:99},old);
  reject(() => patch({sms_limite_diario:98},old),/configuracion cambio/);
  assert.equal(config().settings.sms_limite_diario,99);
});
test('existing MFA requirement also applies to RPC', () => {
  const v=version(); sql('update public.platform_settings set mfa_required_for_admins=true;');
  reject(() => sql(auth(ids.admin,'select public.get_sms_settings()')),/MFA AAL2/);
  assert.equal(patch({sms_limite_diario:100},v,ids.admin,'aal2').settings.sms_limite_diario,100);
  sql('update public.platform_settings set mfa_required_for_admins=false;');
});
test('all service RPCs deny authenticated EXECUTE', () => {
  const functions=JSON.parse(sql("select jsonb_agg(oid::regprocedure::text) from pg_proc where pronamespace='public'::regnamespace and proname in ('phone_verification_policy','enqueue_sms_notification','claim_sms_notifications','consume_sms_rate_limit','purge_sms_private_data')"));
  for(const f of functions) assert.equal(sql(`select has_function_privilege('authenticated',${lit(f)},'execute') or has_function_privilege('anon',${lit(f)},'execute')`),'f');
});
test('self status has no selector for someone else and hides full phone', () => {
  const own=JSON.parse(sql(auth(ids.traveler,'select public.get_my_phone_verification_status()')));
  assert.equal(own.traveler.required,false); assert.equal(own.phone_suffix,null);
  reject(() => sql('begin; set local role anon; select public.get_my_phone_verification_status(); rollback;'),/permission denied/);
});
test('unverified users cannot self-verify through UPDATE', () => {
  reject(() => sql(auth(ids.traveler,`update public.users set phone_verified_at=now(),phone_verified_e164=phone_number where id='${ids.traveler}'`)),/solo puede acreditarla/);
  reject(() => sql(auth(ids.superadmin,`update public.users set phone_verified_at=now(),phone_verified_e164=phone_number where id='${ids.superadmin}'`)),/solo puede acreditarla/);
});
test('INSERT cannot forge a verified profile either', () => {
  const id=randomUUID(); sql(`insert into auth.users(id,email,last_sign_in_at) values('${id}','${id}@example.invalid',now())`);
  reject(() => sql(auth(id,`insert into public.users(id,email,first_name,last_name,role,phone_number,phone_verified_at,phone_verified_e164) values('${id}','${id}@example.invalid','Test','Insert','traveler','+525599999999',now(),'+525599999999')`)),/solo puede acreditarla/);
});
test('normalizer preserves known formats, rejects ambiguous input and does not rewrite legacy +521', () => {
  for (const [input,expected] of [['55 1234 5678','+525512345678'],['+1 (212) 555-1234','+12125551234'],['+44 20 7946 0958','+442079460958'],['+5215512345678','+5215512345678'],['invalid','NULL'],['+525512345678 ext9','NULL']])
    assert.equal(sql(`select coalesce(public.normalizar_telefono(${lit(input)}),'NULL')`),expected);
});
test('trusted verification must match current number and paired timestamp', () => {
  reject(() => sql(`update public.users set phone_verified_at=now() where id='${ids.traveler}'`),/users_phone_verification_pair/);
  reject(() => sql(`update public.users set phone_verified_at=now(),phone_verified_e164='+525511111111' where id='${ids.traveler}'`),/users_phone_verification_pair/);
  sql(`update public.users set phone_verified_at=now(),phone_verified_e164=phone_number where id='${ids.traveler}'`);
});
test('cosmetic phone edits preserve verified state; real changes clear it and invalidate OTP', () => {
  const phone=sql(`select phone_number from public.users where id='${ids.traveler}'`);
  sql(auth(ids.traveler,`update public.users set phone_number=${lit(phone.slice(0,3)+' '+phone.slice(3))} where id='${ids.traveler}'`));
  assert.equal(sql(`select phone_verified_at is not null from public.users where id='${ids.traveler}'`),'t');
  sql(`insert into messaging_private.phone_verifications(user_id,phone_e164,code_hash,pepper_version,expires_at) values('${ids.traveler}',${lit(phone)},repeat('a',64),1,now()+interval '10 minutes')`);
  sql(auth(ids.traveler,`update public.users set phone_number='+525577777777' where id='${ids.traveler}'`));
  assert.equal(sql(`select phone_verified_at is null and phone_verified_e164 is null from public.users where id='${ids.traveler}'`),'t');
  assert.equal(sql(`select status from messaging_private.phone_verifications where user_id='${ids.traveler}'`),'invalidado');
});
test('simulation can never be a verified challenge, OTP hash is enforced', () => {
  reject(() => sql(`insert into messaging_private.phone_verifications(user_id,phone_e164,code_hash,pepper_version,expires_at,status,is_simulated) values('${ids.traveler}','+525577777777',repeat('a',64),1,now()+interval '10 minutes','verificado',true)`),/constraint/);
  reject(() => sql(`insert into messaging_private.phone_verifications(user_id,phone_e164,code_hash,pepper_version,expires_at) values('${ids.traveler}','+525577777777','123456',1,now()+interval '10 minutes')`),/constraint/);
});
// These writes simulate COMPLETED future phases only in this networkless test DB.
sql("update messaging_private.runtime_capabilities set processor_ready=true,otp_enforcement_ready=true; update messaging_private.provider_capabilities set adapter_ready=true,supports_otp=true,supports_transactional=true,configured_until=now()+interval '1 hour' where provider='labsmobile';");
test('SMS may operate while obligation remains off', () => {
  patch({sms_habilitado:true,sms_modo_prueba:false}); assert.equal(policy(ids.traveler,'traveler').required,false);
});
test('global on covers every traveler/agency context, including exempt roles acting there', () => {
  patch({phone_verification_required:true});
  for(const key of ['traveler','agency','staff','admin','superadmin','accountant','executive']) for(const context of ['traveler','agency']) assert.equal(policy(ids[key],context).required,true);
  for(const key of ['admin','superadmin','accountant','executive']) assert.equal(policy(ids[key],'administrative').required,false);
  reject(() => policy(ids.traveler,'administrative'),/no autorizado/);
});
test('per-context toggles and global precedence have no cohort or country exemption', () => {
  patch({phone_verification_travelers_required:false}); assert.equal(policy(ids.traveler,'traveler').required,false); assert.equal(policy(ids.staff,'agency').required,true);
  patch({phone_verification_travelers_required:true,phone_verification_agencies_required:false}); assert.equal(policy(ids.traveler,'traveler').required,true); assert.equal(policy(ids.agency,'agency').required,false);
  patch({phone_verification_agencies_required:true});
});
test('cannot disable SMS or simulate while obligation is active', () => {
  reject(() => patch({sms_habilitado:false}),/obligatoriedad requiere/);
  reject(() => patch({sms_modo_prueba:true}),/obligatoriedad requiere/);
});
test('global rollback is immediate and preserves prior verifications', () => {
  sql(`update public.users set phone_verified_at=now(),phone_verified_e164=phone_number where id='${ids.agency}'`);
  patch({phone_verification_required:false,sms_habilitado:false});
  assert.equal(policy(ids.traveler,'traveler').pending,false); assert.equal(policy(ids.agency,'agency').verified,true);
  patch({sms_habilitado:true,phone_verification_required:true}); assert.equal(policy(ids.agency,'agency').pending,false); assert.equal(policy(ids.traveler,'traveler').pending,true);
});
const key=randomUUID();
const enqueue=(k=key,category='reserva_confirmada') => `select public.enqueue_sms_notification('${ids.traveler}',null,'+525577777777','MX',${lit(category)},${lit(k)},now(),now()+interval '1 hour')`;
test('outbox accepts only transactional categories, never recoverable OTP payload', () => {
  reject(() => sql(service(enqueue(randomUUID(),'otp'))),/constraint/);
  const columns=sql("select string_agg(column_name,',') from information_schema.columns where table_schema='messaging_private' and table_name='notification_outbox'");
  for(const forbidden of ['texto','message_body','code_hash','otp_code','payload']) assert.ok(!columns.includes(forbidden));
});
let outbox;
test('idempotent enqueue returns original logical message', () => {
  outbox=sql(service(enqueue())); assert.equal(sql(service(enqueue())),outbox);
  assert.equal(sql(`select count(*) from messaging_private.notification_outbox where idempotency_key='${key}'`),'1');
});
const claims=await Promise.all([parallel(service('select id from public.claim_sms_notifications(1); select pg_sleep(0.3)')),parallel(service('select id from public.claim_sms_notifications(1)'))]);
test('concurrent SKIP LOCKED workers never claim same logical message', () => {
  assert.ok(claims.every(r=>r.code===0),JSON.stringify(claims)); assert.equal(claims.filter(r=>r.out.includes(outbox)).length,1);
});
test('abandoned lease becomes unknown, never automatically pending again', () => {
  sql(`update messaging_private.notification_outbox set lease_until=now()-interval '1 minute' where id='${outbox}'`);
  sql(service('select count(*) from public.claim_sms_notifications(100)'));
  assert.equal(sql(`select status from messaging_private.notification_outbox where id='${outbox}'`),'resultado_desconocido');
});
test('expired jobs are not claimed', () => {
  const id=sql(service(`select public.enqueue_sms_notification('${ids.traveler}',null,'+525577777777','MX','recordatorio_tour','${randomUUID()}',now()-interval '2 hours',now()-interval '1 hour')`));
  sql(service('select count(*) from public.claim_sms_notifications(100)'));
  assert.equal(sql(`select status from messaging_private.notification_outbox where id='${id}'`),'vencido');
});
const hash=randomUUID().replaceAll('-','').repeat(2);
const limit=`select public.consume_sms_rate_limit('otp_user','${hash}',date_trunc('day',now()),date_trunc('day',now())+interval '1 day',1)`;
const rates=await Promise.all([parallel(service(limit)),parallel(service(limit))]);
test('atomic abuse counter allows only one concurrent final unit', () => {
  assert.ok(rates.every(r=>r.code===0)); assert.equal(rates.filter(r=>r.out.trim()==='t').length,1);
});
const samePhone='+525588888888';
sql(`update public.users set phone_number='${samePhone}' where id in ('${ids.traveler}','${ids.staff}')`);
const verifies=await Promise.all([ids.traveler,ids.staff].map(id=>parallel(`begin; update public.users set phone_verified_e164=phone_number,phone_verified_at=now() where id='${id}'; select pg_sleep(0.2); commit;`)));
test('unique partial index rejects simultaneous verification of same number', () => {
  assert.equal(verifies.filter(r=>r.code===0).length,1,JSON.stringify(verifies)); assert.ok(verifies.some(r=>r.err.includes('users_verified_phone_unique')));
});
test('SMS settings changes are covered by existing audit trigger', () => {
  assert.equal(sql("select exists(select 1 from public.audit_logs where target_table='platform_settings' and new_values ? 'sms_config_version')"),'t');
});
test('retention removes PII but preserves idempotency tombstones', () => {
  sql(`update messaging_private.notification_outbox set status='entregado',updated_at=now()-interval '91 days' where id='${outbox}'`);
  sql(service('select public.purge_sms_private_data()'));
  assert.equal(sql(`select destination_e164 is null and user_id is null from messaging_private.notification_outbox where id='${outbox}'`),'t');
  assert.equal(sql(service(enqueue())),outbox);
});
// Leave the local defaults safe, including on reruns. Never changes remote state.
patch({phone_verification_required:false,sms_habilitado:false,sms_modo_prueba:true});
test('disabled service does not claim queued work', () => {
  const id=sql(service(enqueue(randomUUID())));
  assert.equal(sql(service('select count(*) from public.claim_sms_notifications(100)')),'0');
  assert.equal(sql(`select status from messaging_private.notification_outbox where id='${id}'`),'pendiente');
});
sql('update messaging_private.runtime_capabilities set processor_ready=false,otp_enforcement_ready=false; update messaging_private.provider_capabilities set adapter_ready=false,configured_until=null;');
console.log(`\n${passed} tests passed on restored schema; no network or real SMS.`);
