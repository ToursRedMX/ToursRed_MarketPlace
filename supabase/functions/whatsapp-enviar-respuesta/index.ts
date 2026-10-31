// Responde desde el panel "Mensajes Entrantes de WhatsApp".
//
// Body: { telefono: "+52...", tipo?: "texto" | "plantilla", cuerpo?: string,
//         plantilla_id?: uuid, variables?: { "1": "..." } }
//
// Solo quien tenga permiso sobre la bandeja (`whatsapp_usuario_autorizado`: super_admin,
// admin con la casilla o agente de soporte activo con la casilla). Las reglas de negocio
// (permiso, contacto bloqueado, ventana de 24 h, variables de la plantilla) las decide
// `whatsapp_preparar_envio` en la base: aqui solo se autentica, se llama a Twilio y se
// registra el resultado.
//
// Se inserta la fila ANTES de llamar a Twilio, y si Twilio responde algo
// ambiguo (timeout, 5xx) queda como 'desconocido' en vez de 'fallido': el
// mensaje pudo haber salido y NO se reintenta a ciegas.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { corsHeaders } from '../_shared/cors.ts';
import { requireAdmin } from '../_shared/auth.ts';
import { clasificarEnvio } from '../_shared/mensajeria/whatsappBandeja.ts';

const json = (body: Record<string, unknown>, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const MENSAJES: Record<string, [number, string]> = {
  NO_AUTORIZADO: [403, 'No tienes permiso para usar los mensajes de WhatsApp.'],
  CONTACTO_NO_EXISTE: [404, 'Ese contacto no existe.'],
  CONTACTO_BLOQUEADO: [409, 'Ese número está bloqueado. Desbloquéalo para poder responderle.'],
  VENTANA_CERRADA: [409, 'Pasaron más de 24 horas desde su último mensaje: WhatsApp solo permite enviar una plantilla aprobada.'],
  CUERPO_INVALIDO: [400, 'El mensaje está vacío o supera los 4096 caracteres.'],
  PLANTILLA_NO_DISPONIBLE: [400, 'La plantilla no existe o está desactivada.'],
  VARIABLES_INVALIDAS: [400, 'Faltan variables de la plantilla o son inválidas.'],
  TIPO_INVALIDO: [400, 'Tipo de mensaje inválido.'],
};

Deno.serve(async req => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405, cors);

  const auth = await requireAdmin(req, { recurso: 'whatsapp-enviar-respuesta', cors });
  if (!auth.ok) return auth.response;
  // Una persona, no el service role: queda registrado quien respondio.
  const userId = auth.llamador.userId;
  if (!userId) return json({ error: 'Requiere una sesión de usuario con permiso sobre WhatsApp' }, 403, cors);

  const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
  const { data: autorizado, error: errPermiso } = await client.rpc('whatsapp_usuario_autorizado', { p_user: userId });
  if (errPermiso) return json({ error: 'No se pudo validar el permiso' }, 500, cors);
  if (autorizado !== true) return json({ error: MENSAJES.NO_AUTORIZADO[1] }, 403, cors);

  let entrada: Record<string, unknown>;
  try { entrada = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400, cors); }
  const telefono = typeof entrada.telefono === 'string' ? entrada.telefono : '';
  const tipo = entrada.tipo === 'plantilla' ? 'plantilla' : 'texto';
  if (!/^\+[1-9]\d{7,14}$/.test(telefono)) return json({ error: 'Teléfono inválido' }, 400, cors);
  const plantillaId = typeof entrada.plantilla_id === 'string' && /^[0-9a-f-]{36}$/i.test(entrada.plantilla_id) ? entrada.plantilla_id : null;
  const variables = entrada.variables !== null && typeof entrada.variables === 'object' && !Array.isArray(entrada.variables) ? entrada.variables : null;

  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
  const from = Deno.env.get('TWILIO_WHATSAPP_FROM') ?? '';
  if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid) || !/^[0-9a-fA-F]{32}$/.test(authToken) || !/^whatsapp:\+[1-9]\d{7,14}$/.test(from)) {
    console.error('whatsapp-enviar-respuesta: configuración de Twilio incompleta');
    return json({ error: 'WhatsApp no está configurado en el servidor' }, 503, cors);
  }

  const { data: prep, error: errPrep } = await client.rpc('whatsapp_preparar_envio', {
    p_telefono: telefono, p_tipo: tipo, p_cuerpo: typeof entrada.cuerpo === 'string' ? entrada.cuerpo : null,
    p_plantilla: plantillaId, p_variables: variables, p_usuario: userId,
  });
  if (errPrep || !prep) return json({ error: 'No se pudo preparar el envío' }, 500, cors);
  if (!prep.ok) {
    const [status, mensaje] = MENSAJES[prep.codigo] ?? [400, 'No se pudo enviar.'];
    return json({ ok: false, codigo: prep.codigo, error: mensaje }, status, cors);
  }

  const form = new URLSearchParams({
    To: 'whatsapp:' + prep.telefono_twilio, From: from,
    StatusCallback: new URL('/functions/v1/whatsapp-webhook-entrante?evento=estado', Deno.env.get('SUPABASE_URL')).toString(),
  });
  if (tipo === 'plantilla') {
    form.set('ContentSid', prep.content_sid);
    if (variables) form.set('ContentVariables', JSON.stringify(variables));
  } else {
    form.set('Body', String(entrada.cuerpo));
  }

  let resultado: ReturnType<typeof clasificarEnvio>;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST', headers: { Authorization: `Basic ${btoa(accountSid + ':' + authToken)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(), redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    let cuerpo: unknown = null;
    try { cuerpo = await res.json(); } catch { /* cuerpo ilegible: se clasifica como ambiguo */ }
    resultado = clasificarEnvio(res.status, cuerpo);
  } catch {
    resultado = { estado: 'desconocido', codigo: 'twilio_transporte_ambiguo' };
  }

  await client.rpc('whatsapp_cerrar_envio', {
    p_mensaje: prep.mensaje_id, p_sid: resultado.estado === 'enviando' ? resultado.sid : null,
    p_estado: resultado.estado, p_codigo: resultado.estado === 'enviando' ? null : resultado.codigo,
  });

  if (resultado.estado === 'enviando') return json({ ok: true, mensaje_id: prep.mensaje_id }, 200, cors);
  if (resultado.estado === 'desconocido') {
    return json({ ok: false, mensaje_id: prep.mensaje_id, codigo: resultado.codigo, error: 'No pudimos confirmar el envío. Revisa el hilo antes de reintentar: el mensaje pudo haber salido.' }, 502, cors);
  }
  return json({ ok: false, mensaje_id: prep.mensaje_id, codigo: resultado.codigo, error: 'WhatsApp rechazó el mensaje.' }, 502, cors);
});
