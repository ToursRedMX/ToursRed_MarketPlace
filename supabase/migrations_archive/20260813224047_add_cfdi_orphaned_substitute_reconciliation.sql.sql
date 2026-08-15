/*
# Reconciliacion diaria de CFDIs sustitutos con originales no cancelados

## Propósito
Detectar CFDIs sustitutos (tipo_relacion IS NOT NULL) cuyo CFDI original
referenciado via related_cfdi_invoice_id siga en status='stamped' en vez
de 'cancelled' o 'cancellation_pending'. Esto indica que la cancelacion
del original fallo despues de timbrar el sustituto, dejando ambos CFDIs
vigentes — una exposicion de doble impuesto que requiere correccion manual.

## Cambios
1. Crea la funcion `check_orphaned_cfdi_substitutes()` que:
   - Busca CFDIs con tipo_relacion IS NOT NULL y status='stamped'
   - Verifica que el CFDI original (related_cfdi_invoice_id) tenga status
     en ('cancelled', 'cancellation_pending')
   - Para cada anomalia encontrada, inserta una notificacion a todos los
     usuarios con role='admin' via la funcion create_notification existente
   - Retorna un JSON con el conteo de anomalias detectadas
2. Modifica el cron job `generate-accounting-entries-daily` para que ademas
   de ejecutar generate_accounting_entries_batch, llame a
   check_orphaned_cfdi_substitutes() en la misma ejecucion

## Seguridad
- La funcion es SECURITY DEFINER para poder insertar notificaciones
- Solo ejecuta SELECT e INSERT en notificaciones, no modifica CFDIs
- El cron job ejecuta con privilegios del rol postgres
*/

CREATE OR REPLACE FUNCTION public.check_orphaned_cfdi_substitutes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orphaned RECORD;
  v_count integer := 0;
  v_admin RECORD;
  v_result jsonb;
BEGIN
  FOR v_orphaned IN
    SELECT
      sub.id AS substitute_id,
      sub.uuid_fiscal AS substitute_uuid,
      sub.folio AS substitute_folio,
      sub.serie AS substitute_serie,
      sub.total AS substitute_total,
      sub.booking_id,
      orig.id AS original_id,
      orig.uuid_fiscal AS original_uuid,
      orig.folio AS original_folio,
      orig.serie AS original_serie,
      orig.status AS original_status
    FROM cfdi_invoices sub
    JOIN cfdi_invoices orig ON orig.id = sub.related_cfdi_invoice_id
    WHERE sub.tipo_relacion IS NOT NULL
      AND sub.status = 'stamped'
      AND orig.status = 'stamped'
  LOOP
    v_count := v_count + 1;

    -- Notificar a todos los admins
    FOR v_admin IN
      SELECT id FROM users WHERE role = 'admin' AND is_active = true
    LOOP
      BEGIN
        PERFORM create_notification(
          v_admin.id,
          'cfdi_reconciliation_alert',
          'CFDI sustituto sin cancelacion del original',
          'El CFDI sustituto ' || COALESCE(v_orphaned.substitute_folio, '') ||
          ' (UUID: ' || COALESCE(v_orphaned.substitute_uuid, 'N/A') ||
          ') fue timbrado pero el CFDI original ' ||
          COALESCE(v_orphaned.original_folio, '') ||
          ' (UUID: ' || COALESCE(v_orphaned.original_uuid, 'N/A') ||
          ') sigue vigente (status=stamped). Requiere cancelacion manual inmediata.' ||
          CASE WHEN v_orphaned.booking_id IS NOT NULL
            THEN ' Reserva: ' || v_orphaned.booking_id::text
            ELSE ''
          END,
          null
        );
      EXCEPTION WHEN OTHERS THEN
        -- Si create_notification falla, continuar con el siguiente admin
        RAISE NOTICE 'Failed to notify admin %: %', v_admin.id, SQLERRM;
      END;
    END LOOP;
  END LOOP;

  v_result := jsonb_build_object(
    'orphaned_count', v_count,
    'checked_at', now()
  );

  RAISE NOTICE 'CFDI reconciliation: % orphaned substitutes found', v_count;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_orphaned_cfdi_substitutes() TO postgres;

-- Reschedule the daily cron to include CFDI reconciliation after accounting entries
SELECT cron.unschedule('generate-accounting-entries-daily');
SELECT cron.schedule(
  'generate-accounting-entries-daily',
  '0 4 * * *',
  $$
    SELECT generate_accounting_entries_batch(NULL, NULL);
    SELECT check_orphaned_cfdi_substitutes();
  $$
);
