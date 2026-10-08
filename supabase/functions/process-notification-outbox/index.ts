import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { requireServiceRole } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { cargarRuntime, enviarPersistido } from '../_shared/mensajeria/servicio.ts';
import { plantillaConfirmacion, plantillaRecordatorio } from '../_shared/mensajeria/plantillas.ts';
import type { Categoria } from '../_shared/mensajeria/tipos.ts';

Deno.serve(async req => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const auth = await requireServiceRole(req, { recurso: 'process-notification-outbox', cors });
  if (!auth.ok) return auth.response;
  if (req.method !== 'POST') return new Response('method', { status: 405, headers: cors });
  const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
  try {
    const runtime = await cargarRuntime(client);
    if (!runtime.settings.sms_habilitado || !runtime.processor_ready) return Response.json({ processed: 0, disabled: true }, { headers: cors });
    await client.rpc('record_sms_health', { p_worker: true });
    const { data: jobs, error } = await client.rpc('claim_sms_notifications', { p_limit: 5 });
    if (error) throw error;
    let processed = 0;
    for (const job of jobs ?? []) {
      try {
        // Authoritative business state is read again immediately before dispatch.
        const { data: snapshot, error: preparationError } = await client.rpc('prepare_sms_notification', { p_id: job.id, p_lease: job.lease_token });
        if (preparationError) throw new Error('preparacion_no_disponible');
        if (!snapshot?.allowed) {
          await client.rpc('finish_sms_notification', { p_id: job.id, p_lease: job.lease_token, p_state: 'cancelado' });
          continue;
        }
        const text = job.category === 'reserva_confirmada' ? plantillaConfirmacion(snapshot.folio, runtime.platform_url)
          : plantillaRecordatorio(snapshot.tour, snapshot.meeting_point, snapshot.folio, snapshot.departure_time);
        const result = await enviarPersistido(client, await cargarRuntime(client), { outboxId: job.id, lease: job.lease_token }, job.category as Categoria, snapshot.destination, text);
        if (result.estado === 'fallido' && (result.clase === 'rechazo_confirmado' || result.codigo === 'limite_consumo')) {
          const { data: deferred, error: deferError } = await client.rpc('defer_sms_notification', { p_id: job.id, p_lease: job.lease_token });
          if (deferError) throw deferError;
          if (deferred) continue;
        }
        const { error: finishError } = await client.rpc('finish_sms_notification', { p_id: job.id, p_lease: job.lease_token, p_state: result.estado });
        if (finishError) throw finishError;
        processed++;
      } catch {
        // Ambiguous work retains its lease, then becomes unknown; no blind retry.
        console.error('sms_worker_job_unresolved', { jobId: job.id });
      }
    }
    return Response.json({ processed }, { headers: cors });
  } catch { return Response.json({ error: 'procesador_no_disponible' }, { status: 503, headers: cors }); }
});
