import type { Config } from '@netlify/edge-functions';

// Destino publico de VITE_SENTRY_DSN, verificado contra el bundle publicado.
// Si se migra el proyecto Sentry, actualizar esta lista junto con el DSN.
const SENTRY_HOST = 'o4511889357144064.ingest.us.sentry.io';
const SENTRY_PROJECT = '4511889377722368';
const ENVELOPE_URL = `https://${SENTRY_HOST}/api/${SENTRY_PROJECT}/envelope/`;

export default async (request: Request) => {
  const envelopeBytes = await request.arrayBuffer();

  // Solo decodificamos a texto para leer el header (primera línea).
  // El resto de los bytes se reenvían sin tocar, para no corromper
  // los envelopes binarios de Session Replay.
  const envelopeText = new TextDecoder().decode(envelopeBytes);
  const headerLine = envelopeText.split('\n')[0];
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
  try {
    response = await fetch(ENVELOPE_URL, {
      method: 'POST',
      // Una redireccion tampoco puede sacar la peticion del destino autorizado.
      redirect: 'error',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
      },
      body: envelopeBytes,
    });
  } catch {
    return new Response('Sentry upstream unavailable', { status: 502 });
  }

  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
};

export const config: Config = {
  path: '/sentry-tunnel',
};
