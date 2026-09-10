-- La bitacora registra el origen de la peticion (Req. 10.2 de PCI DSS v4)
--
-- QUE SE MIDIO
--
-- El 10-sep-2026, sobre los 1,400 registros de `audit_logs` desde el 25-jun-2026:
--
--     session_id vacio ......... 1400 / 1400   (100%)
--     correlation_id vacio ..... 1400 / 1400   (100%)
--     ip_address vacia .........  795           = el 100% de los eventos de negocio
--     ip_masked vacia ..........  795
--     user_agent vacio .........  808
--
-- La consulta que lo zanja es que, de 795 eventos de negocio, los que SI traen
-- IP son CERO. Los 605 eventos de autenticacion (LOGIN/LOGOUT/FAILED_LOGIN) si
-- la traen. O sea que la bitacora sabe de donde vino cada login y no sabe de
-- donde vino ni un cobro, ni una cancelacion, ni un cambio de cuenta bancaria.
--
-- El inventario de controles decia que el hueco eran "75 eventos DELETE sin
-- actor ni IP". No son los DELETE: son todos. Y decia que la bitacora captura
-- sesion y correlacion, dos campos que estan en cero absoluto.
--
-- POR QUE PASABA
--
-- No es que faltara la tuberia: `insert_audit_log` acepta los 22 parametros,
-- `p_ip_address`, `p_session_id` y `p_correlation_id` incluidos. Los llamadores
-- simplemente pasaban NULL. Los 8 triggers de auditoria no pueden llenarlos
-- porque no tienen contexto HTTP, y las Edge Functions que lo tienen tampoco lo
-- pasaban — salvo `record-session-event`, la unica que si, y por eso los
-- eventos de autenticacion son los unicos con IP.
--
-- POR QUE EL ARREGLO VA AQUI Y NO EN 21 SITIOS
--
-- `insert_audit_log` es el embudo unico: los 8 triggers y las 13 Edge Functions
-- que escriben bitacora pasan por esta funcion. Resolver el contexto aqui las
-- cubre a todas, y tambien a las que se escriban en el futuro sin que nadie se
-- acuerde de pasarlo.
--
-- POR QUE NO SE USA `set_config`
--
-- El plan original de la auditoria proponia propagar el contexto con
-- `set_config`. Con pooling de conexiones eso es una trampa: un GUC de SESION
-- sobrevive a la peticion y se filtra a la siguiente que reuse esa conexion,
-- con lo que se le atribuiria un borrado a la IP equivocada — peor que no
-- atribuirlo.
--
-- No hace falta: PostgREST ya deja las cabeceras y los claims del JWT como
-- ajustes TRANSACCIONALES de cada peticion. Se leen con
-- `current_setting('request.headers', true)`, que este repo ya usaba en
-- `20260115004042` y `20260219015442`. Al ser transaccionales no se filtran
-- entre peticiones aunque el pool reuse la conexion.
--
-- LO QUE ESTO NO ARREGLA
--
-- 1. Los 1,400 registros existentes. No hay backfill posible: ese dato nunca
--    existio.
-- 2. Las escrituras que llegan DESDE una Edge Function. PostgREST ve entonces
--    las cabeceras de la peticion interna de la funcion, no las del navegador
--    del usuario. Para esos casos la funcion tiene que reenviar el contexto del
--    cliente; de ahi `_shared/contextoAuditoria.ts`, que trae esta misma rama.
-- 3. Las escrituras sin HTTP (cron, service role por conexion directa). Se
--    quedan en NULL, y esta bien que asi sea: inventar un origen seria peor.
--
-- QUE GANA PRIORIDAD SI VIENEN LOS DOS
--
-- El parametro explicito SIEMPRE gana sobre el contexto deducido. Asi
-- `record-session-event`, que ya extrae y normaliza la IP del cliente, sigue
-- mandando ella; y una Edge Function que reenvie contexto tampoco se pisa.

-- ---------------------------------------------------------------------------
-- 1. Enmascarado de IP, en un solo lugar
-- ---------------------------------------------------------------------------
-- Misma regla que `maskIp` de `record-session-event/index.ts`: IPv4 pierde el
-- ultimo octeto, IPv6 pierde los dos ultimos grupos si tiene 4 o mas.
--
-- Vive en SQL y NO se duplica en TypeScript a proposito. Dos implementaciones
-- de la misma regla es una promesa de que se desincronicen; este repo ya tuvo
-- que montar `guardia-fiscal` para vigilar justo eso con la formula del IVA.
-- Como `insert_audit_log` deriva `ip_masked` cuando no se lo pasan, ninguna
-- Edge Function necesita enmascarar por su cuenta para la bitacora.
CREATE OR REPLACE FUNCTION public.enmascarar_ip(p_ip text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_ip IS NULL OR btrim(p_ip) = '' THEN NULL
    -- IPv4: el ultimo octeto se va
    WHEN position('.' in p_ip) > 0 THEN regexp_replace(p_ip, '\.[^.]*$', '.xxx')
    -- IPv6: los dos ultimos grupos, solo si hay al menos 4
    WHEN array_length(string_to_array(p_ip, ':'), 1) >= 4
      THEN regexp_replace(p_ip, ':[^:]*:[^:]*$', ':xxx:xxx')
    ELSE p_ip
  END
$$;

COMMENT ON FUNCTION public.enmascarar_ip(text) IS
  'Enmascara una IP para la bitacora: IPv4 pierde el ultimo octeto, IPv6 los dos ultimos grupos. Unica implementacion de la regla; ver 20260910190000.';

-- ---------------------------------------------------------------------------
-- 2. `insert_audit_log` deduce el contexto cuando no se lo pasan
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insert_audit_log(
  p_tenant_type text,
  p_actor_id uuid DEFAULT NULL::uuid,
  p_actor_email text DEFAULT NULL::text,
  p_actor_role text DEFAULT NULL::text,
  p_target_id text DEFAULT NULL::text,
  p_target_table text DEFAULT NULL::text,
  p_action text DEFAULT NULL::text,
  p_old_values jsonb DEFAULT NULL::jsonb,
  p_new_values jsonb DEFAULT NULL::jsonb,
  p_ip_address inet DEFAULT NULL::inet,
  p_ip_masked text DEFAULT NULL::text,
  p_user_agent text DEFAULT NULL::text,
  p_session_id text DEFAULT NULL::text,
  p_correlation_id uuid DEFAULT NULL::uuid,
  p_metadata jsonb DEFAULT NULL::jsonb,
  p_error_message text DEFAULT NULL::text,
  p_created_at timestamp with time zone DEFAULT now(),
  p_country text DEFAULT NULL::text,
  p_country_code text DEFAULT NULL::text,
  p_city text DEFAULT NULL::text,
  p_region text DEFAULT NULL::text,
  p_severity text DEFAULT 'info'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id        uuid := gen_random_uuid();
  v_diff      jsonb;
  v_tenant    tenant_type;
  v_severity  text;
  v_sqlerrm   text;
  v_sqlstate  text;
  -- Contexto de la peticion
  v_headers   jsonb;
  v_claims    jsonb;
  v_ip_texto  text;
  v_ip        inet;
  v_ip_masked text;
  v_ua        text;
  v_session   text;
  v_correl    uuid;
BEGIN
  -- Authorization: if auth.uid() is NULL (service role / edge function), allow.
  -- If auth.uid() is NOT NULL (authenticated user), must be admin.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Acceso no autorizado';
  END IF;

  -- -------------------------------------------------------------------------
  -- Contexto de la peticion HTTP
  -- -------------------------------------------------------------------------
  -- Cada lectura va en su propio bloque con EXCEPTION. Si un cliente manda una
  -- cabecera que no es JSON valido, lo unico que se pierde es el contexto — no
  -- el registro entero. Sin este aislamiento, el EXCEPTION WHEN OTHERS del
  -- final se tragaria el INSERT completo y una cabecera malformada bastaria
  -- para APAGAR la bitacora, que es exactamente el ataque que 10.2 previene.
  BEGIN
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_headers := NULL;
  END;

  BEGIN
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_claims := NULL;
  END;

  -- El parametro explicito manda. Solo si viene NULL se deduce.
  IF p_ip_address IS NOT NULL THEN
    v_ip := p_ip_address;
  ELSIF v_headers IS NOT NULL THEN
    -- Mismo orden de preferencia que `extraerIpDelCliente` en
    -- _shared/contextoAuditoria.ts. `x-forwarded-for` puede venir como
    -- "cliente, proxy1, proxy2": se toma el primero.
    v_ip_texto := coalesce(
      v_headers->>'cf-connecting-ip',
      v_headers->>'x-real-ip',
      v_headers->>'x-forwarded-for',
      v_headers->>'true-client-ip',
      v_headers->>'fastly-client-ip'
    );
    v_ip_texto := btrim(split_part(coalesce(v_ip_texto, ''), ',', 1));

    IF v_ip_texto <> '' THEN
      BEGIN
        v_ip := v_ip_texto::inet;
      EXCEPTION WHEN OTHERS THEN
        -- Una IP basura no tumba el registro: se queda sin origen y ya.
        v_ip := NULL;
      END;
    END IF;
  END IF;

  v_ip_masked := coalesce(p_ip_masked, public.enmascarar_ip(host(v_ip)));
  v_ua        := coalesce(p_user_agent, v_headers->>'user-agent');

  -- El session_id sale del claim del JWT de GoTrue, que es donde vive de
  -- verdad. Estaba en NULL en los 1,400 registros porque nadie lo mandaba en
  -- el cuerpo, ni siquiera `record-session-event`, que lo aceptaba como
  -- parametro opcional.
  v_session := coalesce(p_session_id, v_claims->>'session_id');

  IF p_correlation_id IS NOT NULL THEN
    v_correl := p_correlation_id;
  ELSIF v_headers ? 'x-correlation-id' THEN
    BEGIN
      v_correl := (v_headers->>'x-correlation-id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_correl := NULL;
    END;
  END IF;

  -- Cast tenant_type safely
  BEGIN
    v_tenant := p_tenant_type::tenant_type;
  EXCEPTION WHEN invalid_text_representation THEN
    v_tenant := 'system'::tenant_type;
  END;

  -- Validate severity
  v_severity := CASE WHEN p_severity IN ('info', 'warning', 'critical') THEN p_severity ELSE 'info' END;

  -- Compute diff
  IF p_old_values IS NOT NULL AND p_new_values IS NOT NULL THEN
    SELECT jsonb_object_agg(n.key, n.value)
    INTO v_diff
    FROM jsonb_each(p_new_values) n
    WHERE NOT (p_old_values @> jsonb_build_object(n.key, n.value));
  END IF;

  INSERT INTO audit_logs (
    id, tenant_type, actor_id, actor_email, actor_role,
    target_id, target_table, action,
    old_values, new_values, diff,
    ip_address, ip_masked, user_agent, session_id,
    correlation_id, metadata, error_message, created_at,
    country, country_code, city, region, severity
  ) VALUES (
    v_id, v_tenant, p_actor_id, p_actor_email, p_actor_role,
    p_target_id, p_target_table, p_action,
    p_old_values, p_new_values, v_diff,
    v_ip, v_ip_masked, v_ua, v_session,
    v_correl, p_metadata, p_error_message, p_created_at,
    p_country, p_country_code, p_city, p_region, v_severity
  );

  RETURN v_id;

EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_sqlerrm = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;

  RAISE WARNING 'insert_audit_log failed [%]: % | action=% table=% actor=%',
    v_sqlstate, v_sqlerrm, p_action, p_target_table, p_actor_id;

  BEGIN
    INSERT INTO audit_errors (error_message, sqlstate, raw_payload)
    VALUES (
      v_sqlerrm,
      v_sqlstate,
      jsonb_build_object(
        'action',       p_action,
        'target_table', p_target_table,
        'actor_id',     p_actor_id,
        'actor_email',  p_actor_email,
        'tenant_type',  p_tenant_type
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NULL;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Aserciones: si un supuesto se cae, esta migracion falla en vez de mentir
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- El enmascarado tiene que coincidir con la regla de TypeScript. Estos son
  -- los mismos casos que verifica scripts/test-contexto-auditoria.mjs.
  ASSERT public.enmascarar_ip('192.168.1.42')  = '192.168.1.xxx',
    'enmascarar_ip: IPv4 debe perder el ultimo octeto';
  ASSERT public.enmascarar_ip('2001:db8:85a3:0:0:8a2e:370:7334') = '2001:db8:85a3:0:0:8a2e:xxx:xxx',
    'enmascarar_ip: IPv6 debe perder los dos ultimos grupos';
  ASSERT public.enmascarar_ip('2001:db8::1') = '2001:db8:xxx:xxx',
    'enmascarar_ip: IPv6 comprimida tambien pierde los dos ultimos';
  ASSERT public.enmascarar_ip('::1') = '::1',
    'enmascarar_ip: con menos de 4 grupos se deja igual';
  ASSERT public.enmascarar_ip(NULL) IS NULL,
    'enmascarar_ip: NULL entra, NULL sale';
  ASSERT public.enmascarar_ip('') IS NULL,
    'enmascarar_ip: cadena vacia da NULL';

  -- Las 24 columnas del INSERT tienen que seguir existiendo. Si alguien
  -- renombra una, es mejor fallar aqui que descubrirlo con la bitacora rota.
  ASSERT (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs'
      AND column_name IN ('ip_address','ip_masked','user_agent','session_id','correlation_id')
  ) = 5, 'audit_logs debe conservar las 5 columnas de contexto';
END
$$;
