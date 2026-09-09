import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compile = s => ts.transpileModule(s.replace(/^import[^\n]*\n/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const source = readFileSync('supabase/functions/process-payment-plan-tour-deadline/index.ts', 'utf8');
const scenarios = [ {}, { denied: true }, { days: 17 }, { planStatus: 'completed' },
  ...['booking_payment_plans', 'booking_payment_plan_installments', 'booking_payment_plan_transactions'].map(tableError => ({ tableError })),
  { tableError: 'cfdi_invoices' }, { invokeError: true }, { invokeThrows: true },
];
for (const test of scenarios) {
  let handler;
  const tasks = [], refunds = [], invoices = [], failures = [];
  const start = new Date(Date.now() + (test.days ?? 16) * 86400000).toISOString();
  const client = {
    from(table) {
      const data = table === 'bookings' ? [{ id: 'booking', user_id: 'user', deposit_amount: 100, service_charge: 10, tours: { name: 'Tour', start_date: start } }]
        : table === 'booking_payment_plans' ? { id: 'plan', status: test.planStatus ?? 'active' }
        : table === 'booking_payment_plan_installments' ? [{ installment_number: 1, amount_paid: 100 }, { installment_number: 2, amount_paid: 50 }]
        : table === 'booking_payment_plan_transactions' ? [{ service_charge: 5 }]
        : table === 'booking_cancellations' ? { id: 'cancellation' }
        : table === 'cfdi_invoices' ? [{ id: 'invoice-one' }, { id: 'invoice-two' }] : null;
      const result = { data, error: test.tableError === table ? { message: 'query failure' } : null };
      const q = { select() { return q; }, eq() { return q; }, in() { return q; }, is() { return q; }, update() { return q; }, insert() { return q; },
        async maybeSingle() { return result; }, async single() { return result; },
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
      }; return q;
    },
    async rpc(name, args) {
      if (name === 'process_cancellation_refund') { refunds.push(args); return { data: { success: true, transaction_id: 'refund' }, error: null }; }
      return { data: 0, error: null };
    },
    functions: { async invoke(name, options) {
      assert.equal(name, 'cancel-cfdi'); invoices.push(options.body);
      if (test.invokeThrows) throw Error('invoke failed');
      return { data: {}, error: test.invokeError ? {} : null };
    } },
  };
  vm.runInNewContext(compile(source), { exports: {}, Response, console: { log() {}, error() {}, warn() {} },
    createClient: () => client,
    Deno: { env: { get: key => key === 'SENTRY_BACKEND_DSN' ? undefined : 'service' }, serve(fn) { handler = fn; } },
    EdgeRuntime: { waitUntil(task) { tasks.push(task); } },
    async registrarFallo(...args) { failures.push(args); },
    async vigilarResultado(result) { if (result.error) failures.push(result.error); },
  });
  const response = await handler(new Request('https://test', { method: 'POST', headers: { Authorization: test.denied ? 'Bearer user' : 'Bearer service' } }));
  await Promise.all(tasks);
  assert.equal(response.status, test.denied ? 401 : 200);
  const blocked = test.denied || test.days || test.planStatus || ['booking_payment_plans', 'booking_payment_plan_installments', 'booking_payment_plan_transactions'].includes(test.tableError);
  assert.equal(refunds.length, blocked ? 0 : 1);
  if (!blocked) { assert.equal(refunds[0].p_refund_amount, 150); assert.equal(invoices.length, test.tableError === 'cfdi_invoices' ? 0 : 2); }
  if (test.tableError || test.invokeError || test.invokeThrows) assert.ok(failures.length > 0);
  for (const invoice of invoices) { assert.equal(invoice.motivo, '03'); assert.equal(invoice.cancellation_id, 'cancellation'); }
}

// The automatic label changes audit text only: the marker never debits money.
let inserts;
const pointsContext = { exports: {}, console, };
vm.runInNewContext(compile(readFileSync('supabase/functions/_shared/pointsTraceability.ts', 'utf8')), pointsContext);
let queryNumber = 0;
await pointsContext.exports.markPointsAsClawedBack({ from() {
  const index = queryNumber++;
  const q = { select() { return q; }, eq() { return q; }, in() { return q; }, limit() { return q; },
    insert(value) { inserts = value; return q; },
    then(resolve, reject) { return Promise.resolve({ data: index === 0 ? [{ charge_reference_id: 'booking', charge_context: 'booking_deposit' }] : index === 1 ? [] : [{ wallet_id: 'wallet', user_id: 'user', reference_id: 'booking', reference_type: 'booking', balance_after: 50 }], error: null }).then(resolve, reject); },
  }; return q;
} }, 'booking', 'cancellation', 'automatica');
assert.equal(inserts[0].amount, 0);
assert.ok(inserts[0].description.includes('automatica'));

let metadataCases = 0;
for (const name of ['create-featured-slot-checkout', 'create-openpay-checkout', 'process-payment-plan-installment', 'purchase-post-booking-extras']) {
  const source = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');
  const line = source.split('\n').find(line => line.includes('.expiry_date ='));
  assert.ok(line);
  for (const due_date of ['2026-10-01T12:00:00-06:00', null, undefined]) {
    const metadata = {};
    const charge = { due_date, payment_method: { type: 'store', reference: 'reference' } };
    vm.runInNewContext(line, { charge, chargeOp: charge, paymentMethodMetadata: metadata, paymentMethodMetadataFs: metadata, paymentMethodMetadataPp: metadata, paymentMethodMetadataOp: metadata });
    assert.equal(metadata.expiry_date, due_date ?? undefined);
    metadataCases++;
  }
}
console.log(`Deadline: ${scenarios.length} handler scenarios; points marker verified; OpenPay: ${metadataCases} metadata cases. No real cancellations or payments.`);
