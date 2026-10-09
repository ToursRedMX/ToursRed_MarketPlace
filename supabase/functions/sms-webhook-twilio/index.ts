import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { corsHeaders } from '../_shared/cors.ts';
import { verifyTwilioSignature, parseTwilioCallback } from '../_shared/mensajeria/twilioWebhook.ts';

Deno.serve(async req => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response('method', { status: 405, headers: cors });
  if (!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return new Response('content-type', { status: 415, headers: cors });
  try {
    const body = await req.text(); if (body.length > 16384) return new Response('size', { status: 413, headers: cors });
    const values = new URLSearchParams(body), params: Record<string, string> = {};
    for (const [key, value] of values) { if (Object.hasOwn(params, key)) return new Response('duplicate', { status: 400, headers: cors }); params[key] = value; }
    const incoming = new URL(req.url);
    const url = new URL('/functions/v1/sms-webhook-twilio', Deno.env.get('SUPABASE_URL'));
    url.search = incoming.search;
    if (!verifyTwilioSignature(Deno.env.get('TWILIO_AUTH_TOKEN') ?? '', req.headers.get('X-Twilio-Signature') ?? '', url.toString(), params)) return new Response('unauthorized', { status: 401, headers: cors });
    const event = parseTwilioCallback(params, Deno.env.get('TWILIO_ACCOUNT_SID') ?? '');
    const correlation = url.searchParams.get('correlation') ?? '';
    if (!event || !/^[a-f0-9]{20}$/.test(correlation)) return new Response('invalid', { status: 400, headers: cors });
    const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
    const { data, error } = await client.rpc('record_twilio_status', { p_correlation: correlation, p_sid: event.sid, p_destination: event.destination, p_state: event.state, p_code: event.code });
    return new Response(error ? 'retry' : data ? 'ok' : 'ignored', { status: error ? 503 : 200, headers: cors });
  } catch { return new Response('unavailable', { status: 503, headers: cors }); }
});
