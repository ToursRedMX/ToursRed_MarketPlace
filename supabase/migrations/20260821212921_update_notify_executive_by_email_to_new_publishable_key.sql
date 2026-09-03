-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260821212921
--   name:    update_notify_executive_by_email_to_new_publishable_key
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

-- Reemplaza el literal de la anon key legacy (JWT) por la publishable key nueva.
-- Las publishable keys son públicas por diseño, así que hardcodearla no es un
-- riesgo de seguridad -- pero necesitábamos dejar de depender del formato legacy
-- antes de que Supabase lo deprecie (finales de 2026).
CREATE OR REPLACE FUNCTION public.notify_executive_by_email(p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
-- URL y publishable key son públicos (no son secretos)
v_supabase_url TEXT := 'https://huzsedewwzjywcpbkjkm.supabase.co';
v_publishable_key TEXT := 'sb_publishable_YMBQEeaJZaFJAPhfGpsQ7Q_RxFUclLu';
BEGIN
PERFORM net.http_post(
url     := v_supabase_url || '/functions/v1/send-executive-notification',
headers := jsonb_build_object(
'Content-Type', 'application/json',
'apikey',       v_publishable_key
),
body    := p_payload,
timeout_milliseconds := 10000
);
EXCEPTION WHEN OTHERS THEN
RAISE WARNING 'notify_executive_by_email error: %', SQLERRM;
END;
$function$;

;
