-- Webhooks de entrega y lectura: "leido" de WhatsApp y los eventos de correo de SendGrid y SMTP2GO.
--
-- Pedido de Axel (22-oct-2026): que los proveedores avisen de la entrega y la lectura de cada mensaje.
-- Auditoria previa:
--   * SMS y WhatsApp por Twilio, SMS por LabsMobile y correo por Zoho YA tenian receptor. El estado de
--     entrega de Twilio llega por el StatusCallback que se manda con cada mensaje (no hay nada que configurar
--     en su consola), y el de LabsMobile igual.
--   * Pero `read` de Twilio (WhatsApp con acuse de lectura) se aplastaba en `entregado`, asi que la LECTURA se
--     perdia. Esta migracion agrega el estado `leido` a la cola, a los intentos y a los eventos.
--   * SendGrid y SMTP2GO no tenian receptor: se agregan en las Edge Functions sendgrid-email-webhook y
--     smtp2go-email-webhook, y aqui `bitacora_evento_correo` gana un id de evento unico para que los reintentos
--     del proveedor no dupliquen filas.
--
-- ORDEN DE LOS ESTADOS (Twilio):  aceptado -> enviado -> entregado -> leido.  `fallido` y `leido` ya no cambian.
-- Un aviso fuera de orden nunca baja de estado: `entregado` despues de `leido` no cambia nada, y `leido` antes
-- de `entregado` (puede pasar) llega a `leido` y el `entregado` posterior se ignora.
--
-- record_twilio_status y claim_twilio_reconciliation se reescriben a partir de su definicion en la base y fallan si
-- un fragmento no esta exactamente una vez, para no dejarlas a medio cambiar.

-- 1. El estado nuevo en las tres tablas ----------------------------------------------------------------
ALTER TABLE messaging_private.notification_outbox DROP CONSTRAINT notification_outbox_status_check;
ALTER TABLE messaging_private.notification_outbox ADD CONSTRAINT notification_outbox_status_check
  CHECK (status = ANY (ARRAY['pendiente','procesando','aceptado','enviado','entregado','leido','fallido','resultado_desconocido','cancelado','simulado','vencido']));

ALTER TABLE messaging_private.notification_attempts DROP CONSTRAINT notification_attempts_status_check;
ALTER TABLE messaging_private.notification_attempts ADD CONSTRAINT notification_attempts_status_check
  CHECK (status = ANY (ARRAY['procesando','aceptado','enviado','entregado','leido','fallido','resultado_desconocido','simulado']));

ALTER TABLE messaging_private.notification_events DROP CONSTRAINT notification_events_event_type_check;
ALTER TABLE messaging_private.notification_events ADD CONSTRAINT notification_events_event_type_check
  CHECK (event_type = ANY (ARRAY['aceptado','enviado','entregado','leido','fallido','resultado_desconocido','simulado']));

-- 2. record_twilio_status: acepta `leido` y lo deja avanzar desde `entregado` -------------------------------
DO $$
DECLARE
  d text;
  r text;
  veces integer;
  cambios text[][] := ARRAY[
    -- (1) estados permitidos
    ARRAY['p_state not in (''aceptado'',''enviado'',''entregado'',''fallido'')',
          'p_state not in (''aceptado'',''enviado'',''entregado'',''leido'',''fallido'')'],
    -- (2) cuando ya no se cambia el estado del intento: antes terminaba en entregado/fallido; ahora en leido/fallido,
    --     y entregado solo avanza a leido
    ARRAY['if inserted is null or a.status in (''entregado'',''fallido'') or (a.status=''enviado'' and p_state=''aceptado'') then return true; end if;',
          'if inserted is null or a.status in (''leido'',''fallido'') or (a.status=''entregado'' and p_state<>''leido'') or (a.status=''enviado'' and p_state=''aceptado'') then return true; end if;'],
    -- (3) la cola: igual, y entregado puede pasar a leido
    ARRAY['where id=a.outbox_id and status not in (''entregado'',''fallido'',''cancelado'',''simulado'',''vencido'');',
          'where id=a.outbox_id and (status not in (''entregado'',''leido'',''fallido'',''cancelado'',''simulado'',''vencido'') or (p_state=''leido'' and status=''entregado''));']
  ];
  i integer;
BEGIN
  SELECT pg_get_functiondef('public.record_twilio_status(text,text,text,text,text,numeric,text)'::regprocedure) INTO d;
  r := d;
  FOR i IN 1 .. array_length(cambios, 1) LOOP
    veces := (length(r) - length(replace(r, cambios[i][1], ''))) / length(cambios[i][1]);
    IF veces <> 1 THEN
      RAISE EXCEPTION 'record_twilio_status cambio: el fragmento % aparece % veces, se esperaba 1', i, veces;
    END IF;
    r := replace(r, cambios[i][1], cambios[i][2]);
  END LOOP;
  EXECUTE r;
END $$;

-- 3. claim_twilio_reconciliation: un mensaje leido sin costo tambien se sigue reconciliando ---------------
DO $$
DECLARE
  d text;
  r text;
  viejo text := '(a.status in (''entregado'',''fallido'') and a.cost is null)';
  nuevo text := '(a.status in (''entregado'',''leido'',''fallido'') and a.cost is null)';
  veces integer;
BEGIN
  SELECT pg_get_functiondef('public.claim_twilio_reconciliation(integer)'::regprocedure) INTO d;
  veces := (length(d) - length(replace(d, viejo, ''))) / length(viejo);
  IF veces <> 1 THEN
    RAISE EXCEPTION 'claim_twilio_reconciliation cambio: el fragmento aparece % veces, se esperaba 1', veces;
  END IF;
  r := replace(d, viejo, nuevo);
  EXECUTE r;
END $$;

-- 4. Eventos de correo: un id unico por evento --------------------------------------------------------
-- SendGrid manda sg_event_id (unico); SMTP2GO no, asi que el receptor arma uno con evento + email + destinatario + hora.
-- Los reintentos del proveedor repiten el id y se ignoran (INSERT ... ON CONFLICT DO NOTHING). Los eventos de Zoho
-- siguen sin id (NULL): en un indice unico los NULL nunca chocan entre si.
ALTER TABLE public.bitacora_evento_correo ADD COLUMN IF NOT EXISTS id_evento text;

CREATE UNIQUE INDEX IF NOT EXISTS bitacora_evento_correo_id_evento_uniq
  ON public.bitacora_evento_correo (proveedor, id_evento);

COMMENT ON COLUMN public.bitacora_evento_correo.id_evento IS
  'Identifica el evento para no guardarlo dos veces cuando el proveedor reintenta. SendGrid: sg_event_id. SMTP2GO: evento:email_id:destinatario:hora. Zoho: nulo.';
