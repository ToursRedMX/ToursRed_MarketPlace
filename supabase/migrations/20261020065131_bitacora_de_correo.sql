-- Bitacora del correo: que acepto cada proveedor y que paso despues.
--
-- POR QUE EXISTE (19-oct-2026): con Zoho como principal y SendGrid como respaldo, los cuatro correos de una
-- reserva llegaron dos veces y no hubo manera de saber, desde la base, por que proveedor salio cada uno ni que
-- codigo devolvio: los registros de las Edge Functions no se pueden consultar desde fuera. Esto deja el rastro
-- en la base, consultable con SQL.
--
--   bitacora_envio_correo   UNA FILA POR INTENTO de envio (el principal y, si lo hay, el respaldo). `id` se manda
--                           al proveedor como referencia propia (client_reference de Zoho, custom_args de SendGrid)
--                           para poder cruzarlo con lo que el proveedor cuenta despues.
--   bitacora_evento_correo  Lo que el proveedor avisa DESPUES por webhook: rebotes, aperturas, clics.
--
-- NO se guarda el cuerpo del correo (puede llevar un codigo o una contrasena temporal). Si se guardan los
-- destinatarios y el asunto, que es lo que hace falta para rastrear un envio; por eso solo un admin las lee y se
-- purgan a los 90 dias.

CREATE TABLE IF NOT EXISTS public.bitacora_envio_correo (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  envio_id     uuid        NOT NULL,                       -- agrupa el intento principal y el de respaldo del MISMO correo
  creado_en    timestamptz NOT NULL DEFAULT now(),
  proveedor    text        NOT NULL,
  es_respaldo  boolean     NOT NULL DEFAULT false,
  aceptado     boolean     NOT NULL,                       -- el proveedor lo acepto (no es lo mismo que entregado)
  clase        text,                                       -- si no se acepto: rechazo_confirmado / no_disponible / no_configurado / incierto
  codigo       text,                                       -- p. ej. zoho_http_201
  http_status  integer,
  id_proveedor text,                                       -- el id que devolvio el proveedor
  destinatarios text[]     NOT NULL,
  asunto       text,
  CONSTRAINT bitacora_envio_correo_proveedor_check CHECK (proveedor IN ('smtp2go', 'sendgrid', 'zoho'))
);

CREATE INDEX IF NOT EXISTS bitacora_envio_correo_creado_idx ON public.bitacora_envio_correo (creado_en DESC);
CREATE INDEX IF NOT EXISTS bitacora_envio_correo_envio_idx ON public.bitacora_envio_correo (envio_id);
CREATE INDEX IF NOT EXISTS bitacora_envio_correo_destinatarios_idx ON public.bitacora_envio_correo USING gin (destinatarios);

CREATE TABLE IF NOT EXISTS public.bitacora_evento_correo (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recibido_en  timestamptz NOT NULL DEFAULT now(),
  proveedor    text        NOT NULL,
  tipo         text        NOT NULL,                       -- hardbounce, softbounce, email_open, email_link_click...
  referencia   uuid,                                       -- bitacora_envio_correo.id, si el evento la trae
  id_proveedor text,
  destinatario text,
  detalle      text,                                       -- motivo del rebote, resumido
  payload      jsonb       NOT NULL,                       -- el mensaje tal como llego, sin IP ni ubicacion
  CONSTRAINT bitacora_evento_correo_proveedor_check CHECK (proveedor IN ('smtp2go', 'sendgrid', 'zoho'))
);

CREATE INDEX IF NOT EXISTS bitacora_evento_correo_recibido_idx ON public.bitacora_evento_correo (recibido_en DESC);
CREATE INDEX IF NOT EXISTS bitacora_evento_correo_referencia_idx ON public.bitacora_evento_correo (referencia);

-- Solo la leen los admin; las escribe el servicio (service_role se salta RLS).
ALTER TABLE public.bitacora_envio_correo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bitacora_evento_correo ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.bitacora_envio_correo FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.bitacora_evento_correo FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bitacora_envio_correo TO authenticated;
GRANT SELECT ON public.bitacora_evento_correo TO authenticated;

DROP POLICY IF EXISTS "Admins leen la bitacora de envios de correo" ON public.bitacora_envio_correo;
CREATE POLICY "Admins leen la bitacora de envios de correo"
  ON public.bitacora_envio_correo FOR SELECT TO authenticated
  USING (public.is_admin_user());

DROP POLICY IF EXISTS "Admins leen la bitacora de eventos de correo" ON public.bitacora_evento_correo;
CREATE POLICY "Admins leen la bitacora de eventos de correo"
  ON public.bitacora_evento_correo FOR SELECT TO authenticated
  USING (public.is_admin_user());

-- Retencion: 90 dias.
CREATE OR REPLACE FUNCTION public.purgar_bitacora_de_correo()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_envios integer;
  v_eventos integer;
BEGIN
  DELETE FROM public.bitacora_envio_correo WHERE creado_en < now() - interval '90 days';
  GET DIAGNOSTICS v_envios = ROW_COUNT;
  DELETE FROM public.bitacora_evento_correo WHERE recibido_en < now() - interval '90 days';
  GET DIAGNOSTICS v_eventos = ROW_COUNT;
  RETURN v_envios + v_eventos;
END;
$$;

REVOKE ALL ON FUNCTION public.purgar_bitacora_de_correo() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purgar_bitacora_de_correo() TO service_role;

-- Todos los dias, 03:40 UTC. Solo donde existe pg_cron (no en la base de pruebas de CI).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purgar-bitacora-de-correo') THEN
      PERFORM cron.unschedule('purgar-bitacora-de-correo');
    END IF;
    PERFORM cron.schedule(
      'purgar-bitacora-de-correo',
      '40 3 * * *',
      $job$SELECT public.purgar_bitacora_de_correo();$job$
    );
  END IF;
END $$;
