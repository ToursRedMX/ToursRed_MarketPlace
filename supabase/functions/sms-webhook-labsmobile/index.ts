import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { corsHeaders } from '../_shared/cors.ts';
import { interpretarCallback } from '../_shared/mensajeria/proveedores/labsmobile.ts';
import { hmac, verificarFirma } from '../_shared/mensajeria/seguridad.ts';

async function verifyLabsMobileSignature(url: URL): Promise<boolean> {
  return verificarFirma(Deno.env.get('SMS_WEBHOOK_SECRET') ?? '', 'labsmobile-callback:' + (url.searchParams.get('subid') ?? ''), url.searchParams.get('signature') ?? '');
}
Deno.serve(async req => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return new Response('method', { status: 405, headers: cors });
  try {
    const url = new URL(req.url);
    if (!await verifyLabsMobileSignature(url)) return new Response('unauthorized', { status: 401, headers: cors });
    const event = interpretarCallback(url);
    if (!event) return new Response('invalid', { status: 400, headers: cors });
    const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
    const eventKey = await hmac(Deno.env.get('SMS_WEBHOOK_SECRET') ?? '', JSON.stringify([event.correlacion,event.estado,event.codigo,event.timestamp]));
    const { error } = await client.rpc('record_sms_callback', { p_provider: 'labsmobile', p_correlation: event.correlacion,
      p_destination: event.destino, p_state: event.estado, p_code: event.codigo, p_timestamp: event.timestamp, p_event_key: eventKey });
    return new Response(error ? 'retry' : 'ok', { status: error ? 503 : 200, headers: cors });
  } catch { return new Response('unavailable', { status: 503, headers: cors }); }
});
