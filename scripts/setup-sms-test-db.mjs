/** Restore a CURRENT schema-only dump locally. Never accepts a remote URL. */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
const baseline = process.argv[2];
if (!baseline || !path.isAbsolute(baseline)) throw Error('Pass absolute path to schema-only dump');
const content = readFileSync(baseline,'utf8');
for(const required of ['audit_users_change','audit_platform_settings_change','toursred_ops','create_booking_atomic_with_preventa']) {
  if (!content.includes(required)) throw Error('Incomplete baseline: '+required);
}
const container='toursred-external-tests', db='sms_phase1_full';
function docker(args,input) {
  const r=spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:8e6});
  if(r.status!==0)throw Error(r.stderr||r.stdout);
  return r.stdout.trim();
}
if(docker(['inspect',container,'--format','{{json .NetworkSettings.Networks}}'])!=='{}') throw Error('Test container must have NO network');
// This database is disposable and hard-coded; other databases remain intact.
docker(['exec',container,'dropdb','-U','supabase_admin','--if-exists',db]);
docker(['exec',container,'createdb','-U','supabase_admin','-T','template0',db]);
const sql=q=>docker(['exec','-i',container,'psql','-X','-q','-1','-U','supabase_admin','-d',db,'-v','ON_ERROR_STOP=1'],q);
sql('CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto SCHEMA extensions; CREATE EXTENSION pg_trgm SCHEMA extensions; CREATE EXTENSION unaccent SCHEMA extensions; CREATE EXTENSION "uuid-ossp" SCHEMA extensions; CREATE EXTENSION pg_net SCHEMA extensions; CREATE EXTENSION supabase_vault; CREATE EXTENSION postgis SCHEMA extensions;');
sql(content);
for(const file of readdirSync('supabase/migrations').filter(f=>/sms_otp_foundation|sms_delivery_engine|phone_otp_enforcement|sms_booking_notifications|agency_onboarding_email_verified_only_if_provider|sms_twilio_provider/.test(f)).sort()) sql(readFileSync('supabase/migrations/'+file,'utf8'));
console.log('Restored real schema and SMS migration locally, all original triggers active.');
