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
const context = { exports: {}, URL, Response, TextDecoder, fetch: async (url, options) => {
  calls.push({ url, options });
  if (upstreamFailure) throw new TypeError('Network failure or redirect rejected');
  return new Response('{}', { status: upstreamStatus });
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
console.log(`Sentry tunnel: ${invalid.length + 5} cases passed; no real network requests.`);
