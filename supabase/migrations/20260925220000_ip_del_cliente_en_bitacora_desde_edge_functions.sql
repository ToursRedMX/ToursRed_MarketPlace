-- ============================================================================
-- La bitacora registraba la IP de la Edge Function, no la del usuario.
--
-- QUE ESTABA PASANDO
--
-- `insert_audit_log` deduce la IP de `request.headers` en este orden:
-- cf-connecting-ip, x-real-ip, x-forwarded-for... Cuando el navegador habla
-- directo con PostgREST, `cf-connecting-ip` es la IP del usuario y el orden es
-- correcto. Cuando habla una Edge Function, `cf-connecting-ip` es la IP de la
-- FUNCION (AWS), y gana a la `x-forwarded-for` que la funcion reenvia con la
-- IP real del usuario.
--
-- Se vio el 25-sep-2026 en las primeras filas que una Edge Function logro
-- escribir con origen de usuario (hasta ese dia el gateway las rechazaba, ver
-- entrada 26 de la bitacora): una cancelacion hecha desde 187.190.63.128
-- quedo registrada como 3.145.206.xxx. Un origen que parece bueno y no lo es
-- es peor que ninguno.
--
-- POR QUE NO BASTA CON PREFERIR x-forwarded-for
--
-- Porque desde el navegador directo `x-forwarded-for` la pone quien quiera:
-- cualquiera podria fabricar el origen de sus propias acciones.
--
-- QUE HACE ESTA MIGRACION
--
-- Las Edge Functions mandan la IP del usuario tambien en una cabecera propia,
-- `x-toursred-ip-cliente` (`_shared/contextoAuditoria.ts`). La nueva
-- `ip_de_la_peticion(headers, claims)` la lee PRIMERO, pero solo si el JWT de
-- la peticion es de `service_role`. Ese rol solo lo tiene quien posee la
-- llave secreta —el gateway lo acuna unicamente para ella—, asi que un
-- navegador no puede usar la cabecera para falsificar su origen. En cualquier
-- otro caso el orden es el de siempre.
--
-- LO QUE NO CUBRE
--
-- Los clientes de las Edge Functions que usan la llave anon con el JWT del
-- usuario (27 al 25-sep-2026) tienen role `authenticated`: para ellos la
-- cabecera no cuenta y sus filas siguen con la IP de la funcion. Confiar en
-- ella ahi abriria justo la falsificacion que esto evita.
--
-- `insert_audit_log` se recrea entera (CREATE OR REPLACE reemplaza todos sus
-- atributos) copiada de la definicion viva del 25-sep-2026; lo unico que
-- cambia es el bloque de la IP, que pasa a llamar a ip_de_la_peticion().
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ip_de_la_peticion(p_headers jsonb, p_claims jsonb)
RETURNS inet
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_texto text;
BEGIN
  IF p_headers IS NULL THEN
    RETURN NULL;
  END IF;

  -- La cabecera propia solo vale con JWT de service_role. Ver cabecera.
  IF p_claims->>'role' = 'service_role' THEN
    v_texto := btrim(split_part(coalesce(p_headers->>'x-toursred-ip-cliente', ''), ',', 1));
    IF v_texto <> '' THEN
      BEGIN
        RETURN v_texto::inet;
      EXCEPTION WHEN OTHERS THEN
        NULL; -- basura: se cae al orden de siempre
      END;
    END IF;
  END IF;

  -- Mismo orden de preferencia que `extraerIpDelCliente` en
  -- _shared/contextoAuditoria.ts. `x-forwarded-for` puede venir como
  -- "cliente, proxy1, proxy2": se toma el primero.
  v_texto := coalesce(
    p_headers->>'cf-connecting-ip',
    p_headers->>'x-real-ip',
    p_headers->>'x-forwarded-for',
    p_headers->>'true-client-ip',
    p_headers->>'fastly-client-ip'
  );
  v_texto := btrim(split_part(coalesce(v_texto, ''), ',', 1));

  IF v_texto = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    RETURN v_texto::inet;
  EXCEPTION WHEN OTHERS THEN
    -- Una IP basura no tumba el registro: se queda sin origen y ya.
    RETURN NULL;
  END;
END;
$function$;

COMMENT ON FUNCTION public.ip_de_la_peticion(jsonb, jsonb) IS
  'IP de origen para la bitacora. Con JWT service_role prefiere x-toursred-ip-cliente (la IP del usuario que reenvia la Edge Function); si no, cf-connecting-ip > x-real-ip > x-forwarded-for > true-client-ip > fastly-client-ip.';

-- ----------------------------------------------------------------------------
-- Vectores. Si cambia la regla, esto falla al aplicar la migracion.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  sr   constant jsonb := '{"role":"service_role"}';
  usr  constant jsonb := '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}';
  anon constant jsonb := '{"role":"anon"}';
BEGIN
  -- El caso que motivo esto: Edge Function con llave de servicio.
  ASSERT public.ip_de_la_peticion(
    '{"cf-connecting-ip":"3.145.206.17","x-forwarded-for":"187.190.63.128","x-toursred-ip-cliente":"187.190.63.128"}', sr
  ) = '187.190.63.128'::inet, 'service_role: gana la IP del usuario, no la de la funcion';

  -- Un navegador con sesion NO puede fabricar su origen con la cabecera.
  ASSERT public.ip_de_la_peticion(
    '{"cf-connecting-ip":"201.141.10.20","x-toursred-ip-cliente":"1.2.3.4"}', usr
  ) = '201.141.10.20'::inet, 'authenticated: la cabecera propia se ignora';

  ASSERT public.ip_de_la_peticion(
    '{"cf-connecting-ip":"201.141.10.20","x-toursred-ip-cliente":"1.2.3.4"}', anon
  ) = '201.141.10.20'::inet, 'anon: la cabecera propia se ignora';

  ASSERT public.ip_de_la_peticion(
    '{"cf-connecting-ip":"201.141.10.20","x-toursred-ip-cliente":"1.2.3.4"}', NULL
  ) = '201.141.10.20'::inet, 'sin claims: la cabecera propia se ignora';

  -- service_role sin la cabecera (cron, pg_net): el orden de siempre.
  ASSERT public.ip_de_la_peticion('{"cf-connecting-ip":"3.145.206.17"}', sr)
    = '3.145.206.17'::inet, 'service_role sin cabecera propia: orden de siempre';

  -- Basura en la cabecera propia: se cae al orden de siempre, no revienta.
  ASSERT public.ip_de_la_peticion(
    '{"cf-connecting-ip":"3.145.206.17","x-toursred-ip-cliente":"no-es-ip"}', sr
  ) = '3.145.206.17'::inet, 'cabecera propia basura: orden de siempre';

  -- El orden de siempre, intacto.
  ASSERT public.ip_de_la_peticion('{"x-real-ip":"2.2.2.2","x-forwarded-for":"3.3.3.3"}', usr)
    = '2.2.2.2'::inet, 'x-real-ip gana a x-forwarded-for';
  ASSERT public.ip_de_la_peticion('{"x-forwarded-for":"3.3.3.3, 10.0.0.1"}', usr)
    = '3.3.3.3'::inet, 'x-forwarded-for: el primero de la lista';
  ASSERT public.ip_de_la_peticion('{"x-forwarded-for":"basura"}', usr) IS NULL,
    'IP basura: NULL, no error';
  ASSERT public.ip_de_la_peticion('{}', sr) IS NULL, 'sin cabeceras de IP: NULL';
  ASSERT public.ip_de_la_peticion(NULL, sr) IS NULL, 'sin request.headers: NULL';
END;
$$;

-- ----------------------------------------------------------------------------
-- insert_audit_log: igual que la version viva, salvo el bloque de la IP.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insert_audit_log(p_tenant_type text, p_actor_id uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT NULL::text, p_actor_role text DEFAULT NULL::text, p_target_id text DEFAULT NULL::text, p_target_table text DEFAULT NULL::text, p_action text DEFAULT NULL::text, p_old_values jsonb DEFAULT NULL::jsonb, p_new_values jsonb DEFAULT NULL::jsonb, p_ip_address inet DEFAULT NULL::inet, p_ip_masked text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_session_id text DEFAULT NULL::text, p_correlation_id uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT NULL::jsonb, p_error_message text DEFAULT NULL::text, p_created_at timestamp with time zone DEFAULT now(), p_country text DEFAULT NULL::text, p_country_code text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_region text DEFAULT NULL::text, p_severity text DEFAULT 'info'::text)
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
  v_ip        inet;
  v_ip_masked text;
  v_ua        text;
  v_session   text;
  v_correl    uuid;
BEGIN
  -- Quien puede escribir en la bitacora.
  --
  -- Service role y Edge Functions (auth.uid() NULL): si.
  -- Un admin llamando por RPC: si.
  -- Un usuario normal llamando por RPC: NO — es lo que impide que alguien
  --   se invente entradas de auditoria, y se conserva.
  -- Un usuario normal cuyo TRIGGER audita su propia accion: si, y esto es
  --   lo que faltaba. `pg_trigger_depth() > 0` solo es cierto dentro de un
  --   trigger, donde el argumento no lo pone el usuario sino la tabla.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() AND pg_trigger_depth() = 0 THEN
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

  -- El parametro explicito manda. Solo si viene NULL se deduce, y la regla
  -- vive en ip_de_la_peticion() (ver la cabecera de esta migracion).
  IF p_ip_address IS NOT NULL THEN
    v_ip := p_ip_address;
  ELSE
    v_ip := public.ip_de_la_peticion(v_headers, v_claims);
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
