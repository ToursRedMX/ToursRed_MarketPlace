-- Arreglo de la migracion 20261023052207 (SMS de cancelacion al viajero): el aviso NUNCA salia.
--
-- Axel probo la cancelacion (reserva TRG-V78OFNZODP9, 22-oct-2026 22:52 hora de Mexico): el SMS de confirmacion llego y el de
-- cancelacion no. La cola lo encolo bien (categoria reserva_cancelada) y el worker lo tomo, pero no quedo NINGUN intento y la fila
-- termino en `resultado_desconocido`: al armar el intento, `begin_sms_attempt` inserta en notification_attempts, un disparador le copia
-- la categoria de la cola y el CHECK `notification_attempts_category_check` NO conocia la categoria nueva. El INSERT fallo, el worker
-- (que traga el error a proposito: «no reintentar a ciegas») dejo el trabajo sin resolver y nada se envio.
--
-- Lo que fallo fue mi busqueda: al agregar la categoria revise las FUNCIONES que la enumeraban y el CHECK de la cola, pero no los
-- CHECK de las OTRAS tablas. Medido ahora contra la base: solo estas dos tablas (cola e intentos) enumeran categorias de SMS, y la
-- cola ya la tenia.
--
-- La fila de la prueba (reserva_cancelada de esa reserva, en `resultado_desconocido`) NO se reintenta: el estado se queda como
-- evidencia y la politica del worker es no reenviar a ciegas. El aviso funcionara con la siguiente cancelacion.

DO $$
DECLARE
  def text;
  veces integer;
  viejo text := '''recordatorio_tour''::text,';
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO def
    FROM pg_constraint c WHERE c.conrelid = 'messaging_private.notification_attempts'::regclass AND c.conname = 'notification_attempts_category_check';
  veces := (length(def) - length(replace(def, viejo, ''))) / length(viejo);
  IF veces <> 1 THEN RAISE EXCEPTION 'notification_attempts_category_check cambio: el fragmento aparece % veces, se esperaba 1', veces; END IF;
  IF def LIKE '%reserva_cancelada%' THEN RETURN; END IF;
  ALTER TABLE messaging_private.notification_attempts DROP CONSTRAINT notification_attempts_category_check;
  EXECUTE 'ALTER TABLE messaging_private.notification_attempts ADD CONSTRAINT notification_attempts_category_check '
          || replace(def, viejo, viejo || ' ''reserva_cancelada''::text,');
END $$;
