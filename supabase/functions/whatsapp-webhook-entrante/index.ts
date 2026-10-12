// Webhook de WhatsApp para la bandeja "Mensajes Entrantes de WhatsApp".
//
// Atiende DOS cosas que Twilio manda a la misma URL:
//   - Mensaje entrante (el cliente nos escribio)   -> POST sin query
//   - Callback de estado de un saliente nuestro    -> POST con `?evento=estado`
//
// Configuracion en Twilio: sender de WhatsApp (o su Messaging Service) ->
// "When a message comes in" = https://<proyecto>.supabase.co/functions/v1/whatsapp-webhook-entrante
// El StatusCallback de los salientes lo pone `whatsapp-enviar-respuesta`.
//
// Mismo molde que `sms-webhook-twilio`: verify_jwt=false (Twilio no manda JWT),
// la autenticidad es la firma `X-Twilio-Signature` sobre la URL publica
// construida desde SUPABASE_URL (nunca desde el Host que llega) y TODOS los
// parametros; los parametros duplicados se rechazan.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { corsHeaders } from '../_shared/cors.ts';
import { verifyTwilioSignature } from '../_shared/mensajeria/twilioWebhook.ts';
import {
  BUCKET_MEDIA, MAX_BYTES_MEDIA, MIME_PERMITIDOS, estadoWhatsApp, mimeBase, parsearEntrante, sidValido, telefonoCanonico, urlMediaValida,
} from '../_shared/mensajeria/whatsappBandeja.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const RUTA = '/functions/v1/whatsapp-webhook-entrante';
const twiml = (cors: Record<string, string>) =>
  new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { status: 200, headers: { ...cors, 'Content-Type': 'text/xml' } });

interface Adjunto { id: string; url: string; tipo: string }

type Cliente = ReturnType<typeof createClient>;

/** Baja UN adjunto de Twilio y lo guarda en el bucket privado. Nunca lanza: deja el motivo en la fila. */
async function guardarAdjunto(client: Cliente, adj: Adjunto, telefono: string, mensajeId: string, accountSid: string, authToken: string) {
  const fallar = async (codigo: string, estado: 'fallido' | 'omitido' = 'fallido') => {
    await client.from('whatsapp_adjuntos').update({ estado, codigo_error: codigo }).eq('id', adj.id);
  };
  try {
    if (!urlMediaValida(adj.url, accountSid)) return await fallar('url_invalida');
    // El redirect a la CDN de Twilio se sigue; fetch no reenvia Authorization a otro origen.
    const res = await fetch(adj.url, {
      headers: { Authorization: `Basic ${btoa(accountSid + ':' + authToken)}` }, redirect: 'follow', signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return await fallar(`twilio_media_http_${res.status}`);
    const mime = mimeBase(res.headers.get('content-type')) || mimeBase(adj.tipo);
    const ext = MIME_PERMITIDOS[mime];
    if (!ext) return await fallar('tipo_no_permitido', 'omitido');
    const declarado = Number(res.headers.get('content-length') ?? '0');
    if (declarado > MAX_BYTES_MEDIA) return await fallar('demasiado_grande', 'omitido');
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES_MEDIA) return await fallar('demasiado_grande', 'omitido');
    const ruta = `${telefono.replace('+', '')}/${mensajeId}/${adj.id}.${ext}`;
    const { error } = await client.storage.from(BUCKET_MEDIA).upload(ruta, bytes, { contentType: mime, upsert: true });
    if (error) return await fallar('storage_error');
    await client.from('whatsapp_adjuntos').update({ estado: 'guardado', storage_path: ruta, content_type: mime, tamano_bytes: bytes.byteLength, codigo_error: null }).eq('id', adj.id);
  } catch (e) {
    console.error('whatsapp-webhook-entrante: adjunto', adj.id, e instanceof Error ? e.name : 'error');
    await fallar(e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'descarga_fallida').catch(() => {});
  }
}

Deno.serve(async req => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response('method', { status: 405, headers: cors });
  if (!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return new Response('content-type', { status: 415, headers: cors });
  try {
    const body = await req.text();
    if (body.length > 16384) return new Response('size', { status: 413, headers: cors });
    const params: Record<string, string> = {};
    for (const [key, value] of new URLSearchParams(body)) {
      if (Object.hasOwn(params, key)) return new Response('duplicate', { status: 400, headers: cors });
      params[key] = value;
    }
    const incoming = new URL(req.url);
    const url = new URL(RUTA, Deno.env.get('SUPABASE_URL'));
    url.search = incoming.search;
    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
    if (!verifyTwilioSignature(authToken, req.headers.get('X-Twilio-Signature') ?? '', url.toString(), params)) {
      return new Response('unauthorized', { status: 401, headers: cors });
    }
    if (params.AccountSid !== accountSid) return new Response('invalid', { status: 400, headers: cors });

    const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });

    // --- Callback de estado de un saliente ---
    if (url.searchParams.get('evento') === 'estado') {
      const estado = estadoWhatsApp(params.MessageStatus);
      if (!sidValido(params.MessageSid) || !estado) return new Response('invalid', { status: 400, headers: cors });
      const codigo = /^\d+$/.test(params.ErrorCode ?? '') ? `twilio_${params.ErrorCode}` : null;
      const { data, error } = await client.rpc('whatsapp_registrar_estado', { p_sid: params.MessageSid, p_estado: estado, p_codigo: codigo });
      return new Response(error ? 'retry' : data ? 'ok' : 'ignored', { status: error ? 503 : 200, headers: cors });
    }

    // --- Mensaje entrante ---
    const mensaje = parsearEntrante(params, accountSid, Deno.env.get('TWILIO_WHATSAPP_FROM') ?? '');
    if (!mensaje) return new Response('invalid', { status: 400, headers: cors });

    const { data, error } = await client.rpc('whatsapp_registrar_entrante', {
      p_from: mensaje.from, p_sid: mensaje.sid, p_cuerpo: mensaje.cuerpo, p_nombre: mensaje.nombre,
      p_media: mensaje.media.map(m => ({ sid: m.sid, url: m.url, tipo: m.tipo })),
    });
    if (error || !data) return new Response('retry', { status: 503, headers: cors });
    // Bloqueado o invalido: se responde 200 vacio para que Twilio no reintente; no se guarda nada.
    if (data.estado !== 'ok' && data.estado !== 'duplicado') return twiml(cors);

    const pendientes: Adjunto[] = Array.isArray(data.adjuntos) ? data.adjuntos : [];
    if (pendientes.length > 0) {
      // Twilio da ~15 s para responder; las descargas siguen en segundo plano.
      const trabajo = (async () => {
        for (const adj of pendientes) await guardarAdjunto(client, adj, telefonoCanonico(data.telefono) ?? data.telefono, data.mensaje_id, accountSid, authToken);
      })();
      if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(trabajo); else await trabajo;
    }
    return twiml(cors);
  } catch (e) {
    console.error('whatsapp-webhook-entrante:', e instanceof Error ? e.name : 'error');
    return new Response('unavailable', { status: 503, headers: cors });
  }
});
