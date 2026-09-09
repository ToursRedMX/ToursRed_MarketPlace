import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual expression from each handler, not a copy of its logic.
function expression(file, marker, waitUntil = false) {
  const source = readFileSync(new URL(`../supabase/functions/${file}/index.ts`, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const matches = [];
  function visit(node) {
    if (waitUntil && ts.isCallExpression(node) && node.expression.getText(ast) === 'EdgeRuntime.waitUntil' && node.getText(ast).includes(marker)) {
      matches.push(node.arguments[0].getText(ast));
    } else if (!waitUntil && ts.isAwaitExpression(node) && node.getText(ast).includes(marker)) {
      matches.push(node.expression.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(matches.length, 1, `${file}: expected one operation`);
  return ts.transpileModule(`globalThis.result = (${matches[0]});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}
const operations = [
  ['cleanup-orphan-agencies', 'exec_sql_get_orphan_agencies', false],
  ['generate-featured-slot-cfdi', 'create_accounting_entry_for_featured_slot', true],
  ['process-payment-plan-tour-deadline', 'supabase.from("notifications")', false],
];
let scenarios = 0;
for (const [file, marker, background] of operations) {
  const code = expression(file, marker, background);
  for (const mode of ['success', 'database-error', 'network-error']) {
    const error = new Error('simulated failure');
    const response = { data: [], error: mode === 'database-error' ? error : null };
    const observed = [];
    const failures = [];
    let executions = 0;
    // Like PostgREST: execution is lazy; no catch method exists on the builder.
    const builder = { then(resolve, reject) {
      executions++;
      return mode === 'network-error' ? Promise.reject(error).then(resolve, reject) : Promise.resolve(response).then(resolve, reject);
    } };
    const supabase = {
      rpc() { return builder; },
      from(table) { assert.equal(table, 'notifications'); return { insert() { return builder; } }; },
    };
    const context = {
      supabase, supabaseAdmin: supabase, slot_id: 'slot',
      booking: { id: 'booking', user_id: 'user', booking_code: 'code' },
      tour: { name: 'tour' }, cancellationRecord: { id: 'cancel' }, refundAmount: 10,
      async vigilarResultado(result) {
        observed.push(result);
        if (result.error) failures.push(result.error);
      },
      async registrarFallo(_context, failure) { failures.push(failure); },
    };
    vm.runInNewContext(code, context);
    const result = await context.result;
    assert.equal(executions, 1, `${file}: operation must execute exactly once`);
    if (file === 'cleanup-orphan-agencies') {
      if (mode === 'network-error') assert.equal(result.error.message, 'rpc_not_found');
      else assert.equal(result, response, 'Preserve the RPC result for fallback selection');
    } else {
      assert.equal(observed.length, mode === 'network-error' ? 0 : 1);
      if (observed.length) assert.equal(observed[0], response, 'Do not discard the database error');
      assert.equal(failures.length, mode === 'success' ? 0 : 1);
    }
    scenarios++;
  }
}
console.log(`PostgREST: ${scenarios} regression cases passed without database mutations.`);
