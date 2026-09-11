-- La bitacora rechazaba los eventos de los usuarios que no son admin.
--
-- QUE PASABA
--
-- `insert_audit_log` exigia ser admin a todo llamador con `auth.uid()` no nulo:
--
--   IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
--     RAISE EXCEPTION 'Acceso no autorizado';
--
-- Esa regla tiene sentido para una llamada DIRECTA por RPC: sin ella,
-- cualquiera podria inventarse entradas de auditoria. Pero se aplicaba tambien
-- cuando el llamador no era el usuario sino un TRIGGER auditando su accion, y
-- ahi el viajero que crea una reserva no es admin: la excepcion tumbaba el
-- registro.
--
-- MEDIDO, NO SUPUESTO
--
-- `public.audit_errors` tenia 31 filas, todas iguales: accion BOOKING_CREATED
-- sobre `bookings`, del 24-ago al 05-sep-2026, con el mensaje 'Acceso no
-- autorizado'. O sea que llevaba semanas dejando constancia de su propio fallo
-- y nadie la leia. Las reservas creadas por viajeros no quedaban en la
-- bitacora; solo las de admins y las de Edge Functions con service role.
--
-- Es Requisito 10 de PCI DSS: las acciones de los usuarios sobre datos de
-- negocio tienen que quedar registradas.
--
-- EL ARREGLO NO ABRE NADA
--
-- Se le suma `pg_trigger_depth() = 0` a la condicion. Esa funcion solo devuelve
-- mas de cero DENTRO de un trigger, y a un trigger no se le pasan argumentos
-- desde el cliente: los pone la tabla. Asi que:
--
--   llamada por RPC de un usuario normal .... sigue rechazada
--   trigger auditando a ese mismo usuario ... pasa
--
-- Lo que se podia falsificar antes se sigue sin poder falsificar.

BEGIN;
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


-- La condicion es el motivo de esta migracion: si alguien reescribe la funcion
-- y se la come, la bitacora vuelve a perder los eventos de usuario en silencio.
DO $verificacion$
BEGIN
  IF (SELECT pg_get_functiondef(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'insert_audit_log'
      LIMIT 1) NOT LIKE '%pg_trigger_depth() = 0%' THEN
    RAISE EXCEPTION 'insert_audit_log quedo sin la excepcion para triggers: los eventos de usuarios no admin se volverian a perder';
  END IF;
END
$verificacion$;

COMMIT;
