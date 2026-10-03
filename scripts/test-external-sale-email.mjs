import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync('supabase/functions/_shared/externalSaleEmail.ts','utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const context={exports:{},URL};vm.runInNewContext(code,context);
const html=context.exports.externalEmailHtml({agency:{name:'Agencia <Test>',logo:'javascript:alert(1)',contact_email:'test@example.invalid'},tour_name:'Tour <script>alert(1)</script>',date:'2026-10-10',time:'07:00',travelers_count:3,meeting:'Puerta & entrada'},'https://example.invalid/logo.png');
assert.ok(html.includes('Agencia &lt;Test&gt;'));
assert.ok(html.includes('Powered by ToursRed'));
assert.ok(html.includes('cid:checkin.png'));
assert.ok(html.includes('no recibió el pago'));
assert.ok(!html.includes('<script>'));
assert.ok(!html.includes('javascript:'));
assert.ok(!html.includes('amount_paid'));
assert.ok(!html.includes('Crear cuenta'));
assert.ok(html.includes('Puerta &amp; entrada'));

// ---- Asientos asignados en el correo ----
const load=(file)=>{const c=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const ctx={exports:{},URL};vm.runInNewContext(c,ctx);return ctx.exports;};
const {externalEmailHtml}=context.exports;
const {buildEmailSeats}=load('supabase/functions/_shared/externalSaleSeats.ts');
const base={agency:{name:'Agencia',logo:null,contact_email:'a@example.invalid'},tour_name:'Tour',date:'2026-10-10',time:'07:00',meeting:null};
const mail=(over)=>externalEmailHtml({...base,travelers_count:1,...over},'https://example.invalid/logo.png');
// un viajero, un asiento
assert.ok(mail({seats:[{name:'Ana',seat:7}]}).includes('Asiento asignado: <strong>7</strong>'));
// sin asientos (o campo ausente): el correo sale igual y NO menciona asientos
assert.ok(!mail({}).includes('Asiento'));
assert.ok(!mail({seats:[]}).includes('Asiento'));
// varios viajeros: una linea por viajero con su nombre y su asiento
const group=mail({travelers_count:3,seats:[{name:'Ana López',seat:4},{name:'Beto López',seat:5}]});
assert.ok(group.includes('Asientos asignados:'));
assert.ok(group.includes('Ana López: asiento <strong>4</strong>')&&group.includes('Beto López: asiento <strong>5</strong>'));
// un solo asiento pero un grupo de 3: se dice DE QUIEN es (no un "Asiento asignado: 4" ambiguo)
const partial=mail({travelers_count:3,seats:[{name:'Ana López',seat:4}]});
assert.ok(partial.includes('Ana López: asiento <strong>4</strong>')&&!partial.includes('Asiento asignado:'));
// un nombre hostil no inyecta HTML en el correo
const evil=mail({travelers_count:2,seats:[{name:'<img src=x onerror=alert(1)>',seat:1},{name:'B',seat:2}]});
assert.ok(!evil.includes('<img src=x')&&evil.includes('&lt;img src=x'));
// numeros de asiento invalidos se ignoran (0, negativos, decimales, NaN)
for(const bad of [0,-3,1.5,NaN]) assert.ok(!mail({seats:[{name:'A',seat:bad}]}).includes('Asiento'),'asiento invalido '+bad);
// buildEmailSeats: solo viajeros con asiento, ordenados; ignora filas raras y viajeros ajenos
const travelers=[{id:'t1',first_name:'Ana',last_name:'López'},{id:'t2',first_name:'Beto',last_name:null},{id:'t3',first_name:'Sin',last_name:'Asiento'}];
const rows=[{seat_number:9,external_sale_traveler_id:'t2'},{seat_number:4,external_sale_traveler_id:'t1'},{seat_number:6,external_sale_traveler_id:'otro-viaje'},{seat_number:7,external_sale_traveler_id:null},{seat_number:0,external_sale_traveler_id:'t3'}];
assert.deepEqual(JSON.parse(JSON.stringify(buildEmailSeats(travelers,rows))),[{name:'Ana López',seat:4},{name:'Beto',seat:9}]);
assert.deepEqual(buildEmailSeats([],[]),[]);
// La funcion de correo de verdad consulta los asientos y los pasa a la plantilla (sin esto lo anterior no llega al viajero).
const fn=fs.readFileSync('supabase/functions/send-external-sale-qr/index.ts','utf8');
assert.ok(fn.includes('buildEmailSeats')&&fn.includes('"slot_seat_status"')&&fn.includes('external_sale_traveler_id'));
assert.ok(fn.includes('externalEmailHtml({...prepared,seats}'),'los asientos deben llegar a la plantilla');
assert.ok(fn.indexOf('buildEmailSeats(')<fn.indexOf('externalEmailHtml('),'los asientos se leen ANTES de armar el correo');
// La lectura de asientos nunca bloquea el envio ni filtra datos: va en try/catch y TODO log de la funcion es un texto generico fijo.
const logs=[...fn.matchAll(/console\.(?:log|error|warn)\(([^)]*)\)/g)].map(m=>m[1].trim());
assert.ok(logs.length>=2&&logs.every(a=>/^"external_qr_email_(audit|seats)_failed"$/.test(a)),'logs permitidos: '+JSON.stringify(logs));
assert.ok(/try\{[\s\S]*buildEmailSeats\([\s\S]*\}catch\{console\.error\("external_qr_email_seats_failed"\);\}/.test(fn),'la lectura de asientos va en try/catch');
console.log('assertions passed: agency branding, inline QR, no amounts/marketing, escaped untrusted content, and assigned seats in the email.');
