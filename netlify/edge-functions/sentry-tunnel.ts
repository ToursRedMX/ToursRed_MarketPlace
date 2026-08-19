import { Config } from '@netlify/edge-functions';

export default async (request: Request) => {
  const body = await request.text();

  const envelopeItems = body.split('\n');
  const header = JSON.parse(envelopeItems[0]);
  const dsn = new URL(header.dsn);
  const projectId = dsn.pathname.replace('/', '');
  const host = dsn.host;

  const url = `https://${host}/api/${projectId}/envelope/`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
    },
    body,
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
