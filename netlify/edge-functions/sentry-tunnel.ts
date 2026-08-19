import { Config } from '@netlify/edge-functions';

export default async (request: Request) => {
  const envelopeBytes = await request.arrayBuffer();

  // Solo decodificamos a texto para leer el header (primera línea).
  // El resto de los bytes se reenvían sin tocar, para no corromper
  // los envelopes binarios de Session Replay.
  const envelopeText = new TextDecoder().decode(envelopeBytes);
  const headerLine = envelopeText.split('\n')[0];
  const header = JSON.parse(headerLine);
  const dsn = new URL(header.dsn);
  const projectId = dsn.pathname.replace('/', '');
  const host = dsn.host;

  const url = `https://${host}/api/${projectId}/envelope/`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
    },
    body: envelopeBytes,
  });

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
