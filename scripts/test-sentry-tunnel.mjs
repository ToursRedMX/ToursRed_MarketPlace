import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const host = 'o4511889357144064.ingest.us.sentry.io';
const project = '4511889377722368';
const dsn = `https://56d45aeb9ad2c0db00e71eba45b3f0bc@${host}/${project}`;
const source = readFileSync(new URL('../netlify/edge-functions/sentry-tunnel.ts', import.meta.url), 'utf8');
let calls = [];
let upstreamStatus = 200;
let upstreamFailure = false;
let upstreamBody = '{}';
let upstreamWait = false;
let timeoutPhase = 0;
let phase = 0;
const context = { exports: {}, URL, Response, Headers, TextDecoder, AbortSignal: {
  timeout(ms) {
    assert.equal(ms, 15000);
    const controller = new AbortController();
    if (++phase === timeoutPhase) setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), 5);
    return controller.signal;
  },
}, fetch: async (url, options) => {
  calls.push({ url, options });
  if (upstreamFailure) throw new TypeError('Network failure or redirect rejected');
  if (upstreamWait) await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  return new Response(upstreamBody, { status: upstreamStatus, headers: { 'Retry-After': '60', 'X-Sentry-Rate-Limits': '60:error:organization' } });
} };
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const handler = context.exports.default;
const envelope = (header, payload = Buffer.from('{}')) => Buffer.concat([
  Buffer.from(`${JSON.stringify(header)}\n`), payload,
]);
const send = (body) => handler(new Request('https://example.test/sentry-tunnel', { method: 'POST', body }));
const invalid = [
  '', 'not-json', ...[null, [], {}, { dsn: null }, { dsn: 123 }].map(JSON.stringify),
  ...[
    'not-a-url', 'https://abc@127.0.0.1/1', 'https://abc@[::1]/1',
    'https://abc@169.254.169.254/1', 'https://abc@localhost/1',
    `https://abc@${host}.evil.test/${project}`, `https://abc@evil.test/${project}`,
    `https://abc@o123.ingest.us.sentry.io/${project}`, `http://abc@${host}/${project}`,
    `https://abc@${host}:8443/${project}`, `https://abc@${host}/123`,
    `https://abc@${host}/${project}/extra`, `https://abc@${host}/%2e%2e/other`,
    `https://abc@${host}/%2f${project}`, `${dsn}?target=evil`, `${dsn}#fragment`,
    `https://abc:password@${host}/${project}`, `https://${host}/${project}`,
    `https://abc@${host}@evil.test/${project}`, `file:///etc/passwd`,
  ].map(value => JSON.stringify({ dsn: value })),
];
for (const body of invalid) {
  calls = [];
  assert.equal((await send(body)).status, 400, body);
  assert.equal(calls.length, 0, 'Rejected requests must never fetch');
}
// Include non-UTF8 bytes as used by compressed Session Replay envelopes.
const binary = envelope({ dsn }, Buffer.from([0, 255, 128, 10, 13, 1, 254]));
for (const status of [200, 202, 429, 500]) {
  upstreamStatus = status;
  calls = [];
  const response = await send(binary);
  assert.equal(response.status, status);
  assert.equal(await response.text(), '{}');
  assert.equal(response.headers.get('Retry-After'), '60');
  assert.equal(response.headers.get('X-Sentry-Rate-Limits'), '60:error:organization');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://${host}/api/${project}/envelope/`);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/x-sentry-envelope');
  assert.deepEqual(Buffer.from(calls[0].options.body), binary);
}
calls = [];
upstreamFailure = true;
assert.equal((await send(binary)).status, 502);
assert.equal(calls.length, 1, 'No fallback destination or retry');
upstreamFailure = false;
upstreamStatus = 200;
let extra = 0;
for (const method of ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) {
  calls = [];
  const response = await handler(new Request('https://example.test', { method }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'POST');
  assert.equal(calls.length, 0);
  extra++;
}
const max = 20 * 1024 * 1024;
for (const [body, length, expected] of [
  [binary, String(max + 1), 413], [binary, 'bad', 400],
  [Buffer.alloc(max + 1), null, 413], [Buffer.alloc(max + 1), '1', 413],
  [Buffer.alloc(8193, 32), null, 413],
  [envelope({ dsn }, Buffer.alloc(max - envelope({ dsn }, Buffer.alloc(0)).length)), null, 200],
]) {
  calls = [];
  const response = await handler(new Request('https://example.test', {
    method: 'POST', body, headers: length === null ? {} : { 'Content-Length': length },
  }));
  assert.equal(response.status, expected);
  assert.equal(calls.length, expected === 200 ? 1 : 0);
  extra++;
}
// Streams are bounded even without a length header; cancellation stops the producer.
for (const mode of ['oversize', 'broken', 'stalled']) {
  let cancelled = false;
  let reads = 0;
  phase = 0;
  timeoutPhase = mode === 'stalled' ? 1 : 0;
  const stream = new ReadableStream({
    pull(controller) {
      reads++;
      if (mode === 'broken') controller.error(new Error('upload failed'));
      else if (mode === 'oversize') controller.enqueue(new Uint8Array(1024 * 1024));
    },
    cancel() { cancelled = true; },
  });
  calls = [];
  const response = await handler(new Request('https://example.test', { method: 'POST', body: stream, duplex: 'half' }));
  assert.equal(response.status, mode === 'oversize' ? 413 : mode === 'stalled' ? 408 : 400);
  assert.equal(calls.length, 0);
  if (mode !== 'broken') assert.equal(cancelled, true);
  if (mode === 'oversize') assert.ok(reads <= 23);
  extra++;
}
for (const duringBody of [false, true]) {
  phase = 0;
  timeoutPhase = 2;
  upstreamWait = !duringBody;
  upstreamBody = duringBody ? new ReadableStream({ pull() {} }) : '{}';
  assert.equal((await send(binary)).status, 504);
  extra++;
}
timeoutPhase = 0;
upstreamWait = false;
upstreamBody = Buffer.alloc(64 * 1024 + 1);
assert.equal((await send(binary)).status, 502);
extra++;
console.log(`Sentry tunnel: ${invalid.length + 5 + extra} cases passed; no real network requests.`);
