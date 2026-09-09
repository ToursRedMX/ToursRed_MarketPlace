import type { Config } from '@netlify/edge-functions';

// Destino publico de VITE_SENTRY_DSN, verificado contra el bundle publicado.
// Si se migra el proyecto Sentry, actualizar esta lista junto con el DSN.
const SENTRY_HOST = 'o4511889357144064.ingest.us.sentry.io';
const SENTRY_PROJECT = '4511889377722368';
const ENVELOPE_URL = `https://${SENTRY_HOST}/api/${SENTRY_PROJECT}/envelope/`;
const MAX_ENVELOPE_BYTES = 20 * 1024 * 1024;
const MAX_HEADER_BYTES = 8 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 15_000;

class BodyTooLarge extends Error {}

// Contar bytes reales: Content-Length puede faltar o ser falso.
async function readLimited(stream: ReadableStream<Uint8Array> | null, limit: number, signal: AbortSignal) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new BodyTooLarge();
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (error) {
    // No esperar a un productor que tampoco termina su cancelacion.
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

export default async (request: Request) => {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  }
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) {
    return new Response('Invalid Content-Length', { status: 400 });
  }
  if (length !== null && Number(length) > MAX_ENVELOPE_BYTES) {
    void request.body?.cancel().catch(() => {});
    return new Response('Envelope too large', { status: 413 });
  }
  const uploadSignal = AbortSignal.timeout(TIMEOUT_MS);
  let envelopeBytes: Uint8Array<ArrayBuffer>;
  try {
    envelopeBytes = await readLimited(request.body, MAX_ENVELOPE_BYTES, uploadSignal);
  } catch (error) {
    return new Response('Unable to read envelope', {
      status: error instanceof BodyTooLarge ? 413 : uploadSignal.aborted ? 408 : 400,
    });
  }

  // Solo decodificamos a texto para leer el header (primera línea).
  // El resto de los bytes se reenvían sin tocar, para no corromper
  // los envelopes binarios de Session Replay.
  const newline = envelopeBytes.indexOf(10);
  const headerLength = newline === -1 ? envelopeBytes.length : newline;
  if (headerLength > MAX_HEADER_BYTES) {
    return new Response('Envelope header too large', { status: 413 });
  }
  const headerLine = new TextDecoder().decode(envelopeBytes.subarray(0, headerLength));
  let dsn: URL;
  try {
    const header: unknown = JSON.parse(headerLine);
    if (!header || typeof header !== 'object' || !('dsn' in header) || typeof header.dsn !== 'string') {
      return new Response('Invalid envelope', { status: 400 });
    }
    dsn = new URL(header.dsn);
  } catch {
    return new Response('Invalid envelope', { status: 400 });
  }

  if (
    dsn.protocol !== 'https:' || dsn.hostname !== SENTRY_HOST || dsn.port !== '' ||
    dsn.pathname !== `/${SENTRY_PROJECT}` || !/^[a-f0-9]+$/i.test(dsn.username) ||
    dsn.password !== '' || dsn.search !== '' || dsn.hash !== ''
  ) {
    return new Response('Unsupported Sentry destination', { status: 400 });
  }

  let response: Response;
  let responseBytes: Uint8Array<ArrayBuffer>;
  const upstreamSignal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    response = await fetch(ENVELOPE_URL, {
      method: 'POST',
      // Una redireccion tampoco puede sacar la peticion del destino autorizado.
      redirect: 'error',
      signal: upstreamSignal,
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
      },
      body: envelopeBytes,
    });
    responseBytes = await readLimited(response.body, MAX_RESPONSE_BYTES, upstreamSignal);
  } catch {
    return new Response('Sentry upstream unavailable', { status: upstreamSignal.aborted ? 504 : 502 });
  }

  const headers = new Headers({ 'Content-Type': 'application/json' });
  // El SDK necesita estos headers para respetar las cuotas de Sentry.
  for (const name of ['Retry-After', 'X-Sentry-Rate-Limits']) {
    const value = response.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response([204, 205, 304].includes(response.status) ? null : responseBytes, {
    status: response.status,
    headers,
  });
};

export const config: Config = {
  path: '/sentry-tunnel',
};
